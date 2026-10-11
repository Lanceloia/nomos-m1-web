"""Personality preferences over current public M1 opportunities, not a plot."""
from pathlib import Path
from copy import copy
import json

import yaml

from .authored_appraisal import AuthoredAppraisal, Local, Opportunity
from .play_report import ScoreFacts, ScoreRules
from .public_planner import PublicPlanner, distances

if __package__:
    from .policy_execution import Candidate, PolicyError, PolicyRun, ScoredCandidate, idle_snapshot
else:
    from policy_execution import Candidate, PolicyError, PolicyRun, ScoredCandidate, idle_snapshot


def load_profiles(path=Path(__file__).parent / "policies/m1_personalities_v2.yaml", features=None):
    features = set(features if features is not None else dict(AuthoredAppraisal().compiled.features))
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if (type(data) is not dict or set(data) != {"version", "profiles"}
            or type(data["version"]) is not int or data["version"] != 2):
        raise ValueError("Invalid personality policy asset")
    profiles = data["profiles"]
    if type(profiles) is not dict or not profiles or any(type(name) is not str or not name for name in profiles):
        raise ValueError("Invalid personality profiles")
    for row in profiles.values():
        if type(row) is not dict or set(row) != {"label", "description", "max_actions", "weights"}:
            raise ValueError("Invalid personality profile fields")
        if any(type(row[key]) is not str or not row[key].strip() for key in ("label", "description")):
            raise ValueError("Invalid personality text")
        if type(row["max_actions"]) is not int or not 1 <= row["max_actions"] <= 128:
            raise ValueError("Invalid delegation safety cap")
        weights = row["weights"]
        if type(weights) is not dict or set(weights) != features or any(
                type(value) is not int or not -1000 <= value <= 1000 for value in weights.values()):
            raise ValueError("Invalid personality weights")
    return profiles


class M1Policy:
    def __init__(self, profiles=None, appraisal=None, score_rules=None):
        self.appraisal = AuthoredAppraisal() if appraisal is None else appraisal
        self.feature_labels = dict(self.appraisal.compiled.features)
        self.profiles = load_profiles(features=self.feature_labels) if profiles is None else profiles
        self.run = None
        self.planner = PublicPlanner(score_rules or ScoreRules())
        if any(row['feature'] not in self.feature_labels for row in self.planner.goals.values()):
            raise ValueError('Public planning refers to an undeclared appraisal feature')
        self.facts = ScoreFacts()
        self.visited, self.places, self.handled_targets, self.blocked = set(), set(), set(), set()
        self.route_attempts = {}
        self.failed_attempts = set()
        self.choice_evidence = {}
        self.checked_contexts = {}
        self.unsupported_goals = set()
        self.navigation, self.site_labels = set(), {}

    def movement_entries(self):
        return {entry for entry, row in self.appraisal.inputs.items()
                if row['movement_kind'] in {'walk', 'bridge', 'door', 'ice'}}

    def plans(self, frame, intent_id, *, include_unsupported=False):
        return [plan for plan in self.planner.plans(self.planning_frame(frame), intent_id, self.facts,
            self.places | {frame['fields']['locationId']}, self.handled_targets, self.movement_entries())
            if include_unsupported or (plan.site, plan.feature) not in self.unsupported_goals]

    def remember_navigation(self, frame):
        """Past public offers are route hypotheses, never present admission grants."""
        scene = frame.get('scene') or {}
        self.site_labels.update(scene.get('siteLabels', {}))
        for row in scene.get('routes', ()):
            if row.get('kind', 'path') in {'path', 'bridge', 'ice', 'door'}:
                self.navigation.add((row['start'], row['end'], row.get('kind', 'path')))
        for offer in frame['offers']:
            if offer['entry'] in self.movement_entries() and type(offer.get('destination')) is str:
                kind = 'path' if offer.get('movementKind') == 'walk' else offer.get('movementKind')
                self.navigation.add((frame['fields']['locationId'], offer['destination'], kind))

    def planning_frame(self, frame):
        scene = frame.get('scene') or {}
        routes = [dict(start=start, end=end, kind=kind) for start, end, kind in sorted(self.navigation)]
        return {**frame, 'scene': {**scene,
            'knownSites': sorted(set(scene.get('knownSites', ())) | {site for edge in self.navigation for site in edge[:2]}),
            'siteLabels': {**self.site_labels, **scene.get('siteLabels', {})},
            'routes': [*scene.get('routes', ()), *routes]}}

    def observe_episode(self, frame, ledger, offer=None, before=None, published=False):
        """Manual and delegated receipts share episode memory, not world authority."""
        if (offer is not None and before is not None and not published
                and (frame.get('feedback') or {}).get('status') == 'rejected'):
            self.remember_refusal(before, offer)
        if offer is not None and before is not None and published:
            key = self.key(before, offer)
            attempt = ((frame.get('feedback') or {}).get('result') or {}).get('movementAttempt')
            if (key is not None and offer['entry'] == 'move_adventurer' and attempt
                    and attempt.get('outcome') == 'blocked'
                    and attempt.get('start') == before['fields']['locationId']
                    and attempt.get('destination') == offer.get('destination')
                    and attempt.get('landing') == attempt.get('start')):
                self.failed_attempts.add((offer['entry'], key, self.attempt_context(before)))
            if key is not None:
                self.visited.add(key)
                self.remember_choice(before, frame, key)
            if ledger.facts.peopleThawed > self.facts.peopleThawed:
                self.handled_targets.update(offer.get('targetIds', ()))
        if before is not None:
            self.remember_navigation(before)
        self.remember_navigation(frame)
        self.facts = ledger.facts
        self.places = set(ledger.places)

    def remember_refusal(self, frame, offer):
        key = self.key(frame, offer)
        if key is not None:
            self.blocked.add((offer['entry'], key, self.public_state(frame)))

    def remember_choice(self, before, after, key):
        self.choice_evidence[key] = self.observation_context(after, key)
        # Remember both sides: another check can replace detail with an old surface.
        self.checked_contexts.setdefault(key, set()).update((
            self.observation_context(before, key), self.choice_evidence[key]))

    def key(self, frame, offer):
        row = self.appraisal.inputs.get(offer['entry'])
        return None if row is None else (frame['fields']['locationId'], row['scope'],
            offer.get('destination', ''), tuple(sorted(offer.get('targetIds', ()))))

    @staticmethod
    def attempt_context(frame):
        """A paid failure is not new evidence: omit clock, fuel and price changes."""
        return json.dumps({
            'site': frame['fields'].get('locationId'),
            'life': frame['fields'].get('lifeState'),
            'cold': frame['fields'].get('coldState'),
            'floors': sorted(({name: row.get(name) for name in ('id', 'site', 'state', 'facts')}
                for row in frame.get('observations', ()) if row.get('kind') == 'floor'),
                key=lambda row: json.dumps(row, sort_keys=True)),
            'routes': sorted(frame.get('scene', {}).get('routes', ()),
                key=lambda row: json.dumps(row, sort_keys=True)),
            'passages': sorted(({'entry': row.get('entry'), 'destination': row.get('destination'),
                'kind': row.get('movementKind'),
                'floor': row.get('passageWarning', {}).get('floorState', 'unknown')}
                for row in frame.get('offers', ()) if row.get('movementKind')),
                key=lambda row: json.dumps(row, sort_keys=True)),
        }, sort_keys=True)

    def failed_attempt(self, frame, offer):
        return bool(self.failed_attempts) and (
            offer['entry'], self.key(frame, offer), self.attempt_context(frame)) in self.failed_attempts

    @staticmethod
    def public_state(frame):
        # Revision and clock alone are not progress; old candidates cannot reset a loop.
        return json.dumps({
            'fields': {name: frame['fields'].get(name) for name in (
                'locationId', 'life', 'endurance', 'movementSpeed', 'coldCondition',
                'everflameCharges', 'carriedReservoirCharges', 'gold')},
            'observations': sorted((
                {name: row.get(name) for name in ('id', 'kind', 'site', 'state', 'facts')}
                for row in frame.get('observations', ())), key=lambda row: row['id']),
            'routes': sorted(frame.get('scene', {}).get('routes', ()),
                             key=lambda row: (row['start'], row['end'], row.get('kind', ''))),
            'ritual': frame.get('information', {}).get('ritual', {}).get('phase'),
            'visible': sorted(({name: row.get(name) for name in ('id', 'kind', 'site', 'state')}
                for row in frame.get('information', {}).get('visibleEntities', ())),
                key=lambda row: json.dumps(row, sort_keys=True)),
            'offers': sorted(({name: row.get(name) for name in
                              ('entry', 'destination', 'movementKind', 'targetIds', 'forecasts')}
                              for row in frame.get('offers', ())),
                             key=lambda row: json.dumps(row, sort_keys=True)),
        }, sort_keys=True, ensure_ascii=True)

    @staticmethod
    def observation_context(frame, key):
        """Reopen completed checks only for changed public evidence, not time or fuel."""
        site = frame['fields']['locationId']
        scope, targets = key[1], key[3]
        route_scope = scope in {'ground_routes', 'climbs', 'travel', 'ice_travel'}
        floor_scope = scope in {'floor', 'floor_thaw'}
        observations = [row for row in frame.get('observations', ())
                        if (row['id'] in targets if targets else
                            row.get('site') == site and row.get('kind') == ('floor' if floor_scope else 'person'))]
        names = (('id', 'kind', 'site', 'state', 'facts') if targets else
                 ('id', 'kind', 'site', 'state') if floor_scope else ('id', 'kind', 'site'))
        route_kinds = {'climb'} if scope == 'climbs' else {'path', 'bridge', 'ice', 'door'}
        return json.dumps({
            'observations': sorted(({name: row.get(name) for name in names}
                for row in observations if not route_scope),
                key=lambda row: row['id']),
            'routes': sorted((row for row in (frame.get('scene') or {}).get('routes', ())
                              if row['start'] == site and route_scope
                              and row.get('kind', 'path') in route_kinds),
                             key=lambda row: json.dumps(row, sort_keys=True)),
            'visible': sorted(({name: row.get(name) for name in ('id', 'kind', 'site')}
                               for row in frame.get('information', {}).get('visibleEntities', ())
                               if not targets and not floor_scope and not route_scope),
                              key=lambda row: json.dumps(row, sort_keys=True)),
        }, sort_keys=True)

    def snapshot(self, frame=None):
        result = self.run.snapshot() if self.run else idle_snapshot()
        if frame is not None and result["status"] == "stopped":
            result["stopDetail"]["choices"] = ([] if result["stopDetail"]["code"] == "fault"
                                               else self.decision_choices(frame))
        return result

    def decision_choices(self, frame):
        offers = [] if frame.get("ending") else frame["offers"]
        manual = {offer["entry"] for offer in offers} - set(self.appraisal.compiled.bindings)
        ordered = sorted(offers, key=lambda offer: (offer["entry"] not in manual, offer["index"]))
        return [{"index": row["index"], "label": row["label"]} for row in ordered[:5]]

    def halt(self, frame, code, message):
        self.run.stop(message, code=code, choices=self.decision_choices(frame))

    def candidates(self, frame, intent_id, visited=()):
        if intent_id not in self.profiles:
            return []
        local = self._candidates_for_plans(frame, intent_id, visited, [])
        site = frame['fields']['locationId']
        self.unsupported_goals.difference_update({(site, feature)
            for row in local for feature, value in row.features.items() if value > 0})
        self.unsupported_goals.difference_update({(plan.site, plan.feature)
            for plan in self.plans(frame, intent_id, include_unsupported=True)
            if any(self.supports_plan(frame, row, plan) for row in local)})
        plans = self.plans(frame, intent_id)
        while plans:
            candidates = self._candidates_for_plans(frame, intent_id, visited, plans)
            goal = plans[0]
            if any(not self.reserves_charge(frame, row)
                   and self.supports_plan(frame, row, goal) for row in candidates):
                return candidates
            # A remembered destination is not an executable opportunity here.
            if goal.site == site and not any(row.features.get(goal.feature, 0) > 0 for row in local):
                self.unsupported_goals.add((site, goal.feature))
            plans = plans[1:]
        return local

    def supports_plan(self, frame, candidate, plan):
        if candidate.key[0] == plan.site:
            if candidate.features.get(plan.feature, 0) > 0:
                return True
            # Resolve a visible person's unknown condition before proposing relief.
            if plan.feature in {'interrupt', 'help'} and candidate.expectations['inspection']:
                visible = {row['id'] for row in frame.get('information', {}).get('visibleEntities', ())
                           if row.get('kind') == 'person' and row.get('site') == plan.site}
                targets = {target for offer in frame['offers']
                           if plan.feature in self.appraisal.feature_ports.get(offer['entry'], ())
                           for target in offer.get('targetIds', ())}
                if plan.feature == 'help':
                    targets &= {row['id'] for row in frame.get('observations', ())
                                if row.get('kind') == 'person' and row.get('state') == 'frozen'
                                and row.get('site') == plan.site and row['id'] not in self.handled_targets}
                return bool(candidate.key[3]) and set(candidate.key[3]).issubset(visible & targets)
        return (len(plan.route) > 1 and candidate.expectations['movement']
                and candidate.key[2] == plan.route[1])

    def reserves_charge(self, frame, candidate):
        charge = frame['fields'].get('everflameCharges')
        return (self.run is not None and self.run.status == 'running'
                and self.run.stop_on_unexpected and candidate.expectations['torch_spend'] > 0
                and (type(charge) is not int or charge - candidate.expectations['torch_spend'] < 2))

    def _candidates_for_plans(self, frame, intent_id, visited, plans, *, all_goals=False):
        fields, scene = frame["fields"], frame.get("scene") or {}
        site = fields["locationId"]
        observations = frame.get("observations", [])
        records = {row["id"]: row for row in observations}
        known_sites = {row.get("site") for row in observations} | {site}
        visited = set(visited) | self.visited
        seen_sites = self.places | ({site} if all_goals else
            self.run.sites if self.run and self.run.intent_id == intent_id else {site})
        rated_movements = self.movement_entries()
        # Returning is instrumental to the best current goal, not to every frontier.
        # Otherwise two old sites can keep pointing at different unvisited branches.
        goal_distances = [distances(self.planning_frame(frame), plan.site, rated_movements)
                          for plan in (plans if all_goals else plans[:1])]
        state = self.public_state(frame)
        # This synchronous pass sees one frame; never reuse evidence across actions.
        failed_context = self.attempt_context(frame) if self.failed_attempts else None
        failed_keys = {(entry, key) for entry, key, _ in self.failed_attempts}
        needs = [distances(frame, row["site"], rated_movements) for row in observations
                 if row["kind"] == "person" and row.get("site") and row.get("state") == "frozen"]
        charge, reservoir = fields.get("everflameCharges"), fields.get("carriedReservoirCharges")
        local = Local(charge, reservoir,
                      any(row["kind"] == "floor" and row.get("site") == site for row in observations),
                      any(row["kind"] == "floor" and row.get("site") == site
                          and row.get("state") == "frozen" for row in observations),
                      any(row["start"] == site for row in scene.get("routes", [])),
                      any(row["kind"] == "person" and row.get("site") == site
                          and row.get("detailRecordedAt") for row in observations),
                      frame.get('information', {}).get('ritual', {}).get('phase') in {'preparing', 'gathering', 'critical'},
                      any(row['kind'] == 'person' and records.get(row['id'], {}).get('state') != 'dead'
                          for row in frame.get('information', {}).get('visibleEntities', ())))
        candidates = []
        crossing_destinations = {
            offer.get('destination') for offer in frame['offers']
            if offer.get('movementKind') == 'ice'
            and offer.get('entry') in self.appraisal.compiled.bindings
            and (offer['entry'], self.key(frame, offer), state) not in self.blocked
            and self.route_attempts.get((offer['entry'], self.key(frame, offer), state), 0) < 2
        }
        for offer in frame["offers"]:
            entry, destination = offer.get("entry", ""), offer.get("destination")
            if entry not in self.appraisal.compiled.bindings:
                continue
            targets = tuple(sorted(offer.get("targetIds", [])))
            # Authored scope distinguishes checks without depending on entry spelling.
            key = self.key(frame, offer)
            attempt = (entry, key, state)
            if (attempt in self.blocked or (entry, key, failed_context) in self.failed_attempts
                    or self.route_attempts.get(attempt, 0) >= 2):
                continue
            evidence_changed = (key in self.choice_evidence
                and self.choice_evidence[key] != self.observation_context(frame, key))
            if (entry, key) in failed_keys:
                evidence_changed = True
            observation = Opportunity(
                key in visited and not evidence_changed,
                bool(targets), len(targets), bool(targets) and all(
                    bool(records.get(target, {}).get("detailRecordedAt")) for target in targets),
                sum(records.get(target, {}).get("state") == "frozen" for target in targets),
                bool(targets) and all(records.get(target, {}).get("kind") == "floor" for target in targets),
                destination not in seen_sites, destination not in known_sites,
                any(site in route and destination in route and route[destination] < route[site]
                    for route in needs), offer.get("movementKind") == "ice",
                type(destination) is str and destination != site,
                any(site in route and destination in route and route[destination] < route[site]
                    for route in goal_distances), evidence_changed,
                offer.get('movementKind') == 'walk' and destination in crossing_destinations)
            values = self.appraisal.evaluate(entry, local, observation)
            information = frame.get('information', {})
            if values is not None and (values['inspection'] or values['interruption']) and targets and information.get('visibility') == 'provided':
                visible = {row['id'] for name in ('visibleEntities', 'nearbyEntities') for row in information.get(name, ())}
                if any(records.get(target, {}).get('kind') == 'person' and target not in visible for target in targets):
                    continue
            if (values is not None and values['inspection']
                    and self.observation_context(frame, key) in self.checked_contexts.get(key, ())):
                continue
            if values is not None:
                features = {name: values[name] for name in self.feature_labels if values[name]}
                expectations = {name: value for name, value in values.items() if name not in self.feature_labels}
                candidates.append(Candidate(offer["index"], entry, offer["label"], key, features,
                                            self.appraisal.compiled.bindings[entry], expectations))
        return candidates

    def offers(self, frame):
        if frame.get("ending"):
            return []
        return [{"id": name, "label": row["label"], "description": row["description"],
                 "maxActions": row["max_actions"]} for name, row in self.profiles.items()]

    def action_merits(self, frame, index):
        """Grade the same public action against every profile, regardless of controller."""
        merits, key = {}, None
        for name in self.profiles:
            # Grade public meanings, not the controller's consent or current plan.
            plans = self.planner.plans(self.planning_frame(frame), name, self.facts,
                self.places | {frame['fields']['locationId']}, self.handled_targets, self.movement_entries())
            candidates = self._candidates_for_plans(frame, name, (), plans, all_goals=True)
            utilities = {row.index: sum(value * self.profiles[name]['weights'][feature]
                                        for feature, value in row.features.items()) for row in candidates}
            candidate = next((row for row in candidates if row.index == index), None)
            if candidate is not None:
                key = candidate.key
                # Each profile has the same 0..10 scale relative to its current best alternative.
                best = max(utilities.values(), default=0)
                merits[name] = max(0, round(10 * utilities[index] / best)) if best > 0 else 0
            else:
                merits[name] = 0
        # New evidence makes a repeated check meaningful; the same evidence cannot farm points.
        return ((key, self.observation_context(frame, key)), merits) if key is not None else (None, None)

    def start(self, frame, intent_id, *, max_actions=None, stop_on_unexpected=True):
        if self.run and self.run.status == "running":
            raise PolicyError("请先停止当前倾向。")
        offer = next((row for row in self.offers(frame) if row["id"] == intent_id), None)
        if offer is None:
            raise PolicyError("此人格倾向不在当前列表中。")
        limit = offer['maxActions'] if max_actions is None else max_actions
        if type(limit) is not int or not 1 <= limit <= 128 or type(stop_on_unexpected) is not bool:
            raise PolicyError('推进步数须为1至128的整数；意外交还控制须为勾选设置。')
        self.run = PolicyRun(intent_id, offer["label"], limit, stop_on_unexpected)
        self.places.add(frame['fields']['locationId'])
        self.run.sites.add(frame["fields"]["locationId"])

    def advice(self, frame, intent_id, *, stop_on_unexpected=True):
        """Evaluate a fresh delegation decision without changing episode/control state."""
        terminal = self.terminal_reason(frame)
        if terminal:
            return {'intentId': intent_id, 'label': self.profiles[intent_id]['label'],
                    'choice': None, 'plan': None, 'reason': terminal[1],
                    'stopOnUnexpected': stop_on_unexpected}
        preview = copy(self)
        preview.run = None
        preview.places = set(self.places)
        preview.unsupported_goals = set(self.unsupported_goals)
        preview.start(frame, intent_id, stop_on_unexpected=stop_on_unexpected)
        selected = preview.select(frame)
        return {
            'intentId': intent_id, 'label': preview.run.label,
            'stopOnUnexpected': stop_on_unexpected,
            'choice': None if selected is None else {
                'index': selected.candidate.index, 'entry': selected.candidate.entry,
                'label': selected.candidate.label, 'score': selected.score,
                'reason': selected.reason,
            },
            'plan': preview.run.plan,
            'reason': preview.run.reason,
        }

    def select(self, frame):
        run = self.run
        if run is None or run.status != "running":
            raise PolicyError("当前没有运行中的人格倾向。")
        terminal = self.terminal_reason(frame)
        if terminal:
            run.plan = None
            self.halt(frame, *terminal)
            return None
        if len(run.steps) >= run.limit:
            self.halt(frame, "safety_limit", f"已完成你设置的 {run.limit} 次行动。这不是风险停机；可手动行动或继续代行。")
            return None
        candidates = self.candidates(frame, run.intent_id, run.visited)
        plans = self.plans(frame, run.intent_id)
        run.plan = None
        weights = self.profiles[run.intent_id]['weights']
        goal_available = any(not self.reserves_charge(frame, candidate)
                             and any(self.supports_plan(frame, candidate, plan) for plan in plans)
                             for candidate in candidates)
        urgent = frame.get('information', {}).get('ritual', {}).get('phase') == 'critical'
        ice_available = any(row.expectations['movement'] and row.features.get('ice', 0) > 0
                            for row in candidates)
        ranked = []
        reserved = False
        planned = {}
        ground_check_available = any(row.expectations['inspection'] and row.key[1] == 'ground_routes'
                                     for row in candidates)
        for candidate in candidates:
            if self.reserves_charge(frame, candidate):
                reserved = True
                continue
            score = sum(value * weights[name] for name, value in candidate.features.items())
            forecasts = []
            for plan in plans:
                if self.supports_plan(frame, candidate, plan):
                    forecasts.append(plan)
            forecast = max(forecasts, key=lambda item: item.value, default=None)
            # Keep safety checks, but leave unrelated surveys to manual exploration.
            safety_check = (candidate.features.get('floor', 0) > 0
                            or candidate.features.get('routes', 0) > 0 and candidate.key[1] != 'climbs')
            # Resolve navigation before a general survey; targeted checks can still
            # establish a person's condition or support an existing public goal.
            if (ground_check_available and forecast is None
                    and candidate.expectations['inspection'] and not safety_check
                    and not candidate.key[3]):
                continue
            if (goal_available and forecast is None and candidate.expectations['inspection']
                    and run.intent_id in {'helpful_rescuer', 'decisive_explorer'} and not safety_check):
                continue
            if (run.intent_id == 'helpful_rescuer' and forecast is None
                    and candidate.expectations['torch_spend'] > 0
                    and any(not self.reserves_charge(frame, row)
                            and self.supports_plan(frame, row, plan)
                            for row in candidates for plan in plans if plan.feature in {'help', 'interrupt'})):
                continue
            if forecast:
                score += round(forecast.value)
                planned[candidate.key] = forecast
            if score > 0:
                favorable = [self.feature_labels[name] for name, value in candidate.features.items()
                             if value * weights[name] > 0]
                unfavorable = [self.feature_labels[name] for name, value in candidate.features.items()
                               if value * weights[name] < 0]
                explanation = '；'.join(filter(None, [
                    f'朝「{forecast.goal}」前进，预计还需约{forecast.estimated_actions}次行动' if forecast else '',
                    '符合这项倾向：' + '、'.join(favorable) if favorable else '',
                    '仍需留意：' + '、'.join(unfavorable) if unfavorable else '']))
                ranked.append(ScoredCandidate(candidate, score, explanation))
        # An ambiguous target cannot block an unrelated, identifiable alternative.
        if run.intent_id == 'cautious_investigator' and ice_available and not urgent:
            floor_checks = [row for row in ranked if row.candidate.features.get('floor', 0) > 0]
            if floor_checks:
                ranked = [ScoredCandidate(row.candidate, row.score,
                          '先核对脚下冰面，再考虑通行。' + row.reason) for row in floor_checks]
        unique = [row for row in ranked if sum(peer.score == row.score
            and peer.candidate.key == row.candidate.key for peer in ranked) == 1]
        active_plan = next((plan for plan in plans if any(
            self.supports_plan(frame, row.candidate, plan) for row in unique)), None)
        if active_plan is not None and run.intent_id in {'helpful_rescuer', 'decisive_explorer'}:
            unique = [row for row in unique if not row.candidate.expectations['movement']
                      or self.supports_plan(frame, row.candidate, active_plan)]
        selected = min(unique, key=lambda row: (-row.score, row.candidate.key, row.candidate.entry), default=None)
        if urgent and frame['fields']['locationId'] == 'ritual_ring' and not any(
                self.supports_plan(frame, row.candidate, plan)
                for row in unique for plan in plans if plan.feature == 'interrupt'):
            self.halt(frame, 'manual_decision', '仪式接近完成，但当前没有可代行的中断或人物核对机会。请查看眼前人物的行动，亲自决定。')
            return None
        if selected and selected.candidate.key in planned:
            run.plan = planned[selected.candidate.key].snapshot(self.planning_frame(frame))
        if selected and urgent and run.intent_id == 'cautious_investigator' and selected.candidate.key in planned:
            selected = ScoredCandidate(selected.candidate, selected.score,
                '已经察觉仪式接近完成，这次优先寻找应对机会，再做一般检查。' + selected.reason)
        if not unique and ranked:
            self.halt(frame, 'ambiguous', '这些行动的公开目标无法区分，请你选择。')
            return None
        if selected is None:
            if reserved:
                self.halt(frame, 'resource_reserve', '可代行的行动需要动用保留的永焰充能，等待你决定。')
                return None
            code = 'no_candidate'
            if code == "no_candidate" and any(offer["entry"] not in self.appraisal.compiled.bindings
                                              for offer in frame["offers"]):
                code = "manual_decision"
            state = self.public_state(frame)
            if any(self.route_attempts.get((row['entry'], self.key(frame, row), state), 0) >= 2
                   for row in frame['offers'] if row['entry'] in self.appraisal.compiled.bindings):
                code = 'retry_budget'
            messages = {
                'manual_decision': '当前未找到可代行的检查或通行；其他走法、交谈或搬运需要你亲自选择。打开“全部行动”查看当前选项。',
                'retry_budget': '相同局面下的重复尝试已达到上限，其他行动仍可亲自选择。',
                'no_candidate': '当前行动未符合这项倾向的评价条件，可亲自选择或换一种倾向。',
            }
            self.halt(frame, code, messages[code])
        return selected

    def record(self, selected, before, after, before_revision, after_revision):
        run, candidate = self.run, selected.candidate
        if (after.get("feedback") or {}).get("status") != "published":
            self.remember_refusal(before, {'entry': candidate.entry,
                'destination': candidate.key[2], 'targetIds': candidate.key[3]})
            code = (after.get('feedback') or {}).get('refusal', {}).get('code')
            if code in {'C0_BINDING_REJECTED', 'UNPUBLISHED_RESULT'}:
                self.halt(after, 'submission_failed', '提交未完成，已停止代行。请同步当前行动列表。')
            elif run.stop_on_unexpected:
                self.halt(after, "not_admitted", "这项行动未被世界接纳，已交还控制。")
            else:
                self.select(after)
            return
        attempt = (candidate.entry, candidate.key, self.public_state(before))
        self.route_attempts[attempt] = self.route_attempts.get(attempt, 0) + 1
        run.visited.add(candidate.key)
        self.remember_choice(before, after, candidate.key)
        run.sites.add(after["fields"]["locationId"])
        explanation = selected.reason
        run.steps.append({"entry": candidate.entry, "label": candidate.label, "index": candidate.index,
                          "meaning": candidate.meaning, "appraisalDigest": self.appraisal.digest,
                          "score": selected.score, "reason": explanation,
                          "beforeRevision": before_revision, "afterRevision": after_revision,
                          "beforeSite": before["fields"]["locationId"], "afterSite": after["fields"]["locationId"],
                          "beforeTime": before["time"], "afterTime": after["time"]})
        reason = self.stop_reason(candidate, before, after)
        fatal = self.terminal_reason(after)
        if reason and (run.stop_on_unexpected or fatal):
            run.plan = None
            self.halt(after, *reason)
        else:
            self.select(after)

    def stop_reason(self, candidate, before, after):
        terminal = self.terminal_reason(after)
        if terminal:
            return terminal
        old, new = before["fields"], after["fields"]
        result = (after.get("feedback") or {}).get("result") or {}
        changes = result.get("changes", []) + result.get("laterChanges", [])
        if result.get('movementAttempt', {}).get('outcome') == 'blocked':
            return 'movement_blocked', '通行尝试已经发生但受阻，仍停在出发处；已交还控制。'
        if old.get("life") != new.get("life") or any(row["field"] == "life" for row in changes):
            return "life_changed", "生命状态发生变化，请检查当前状况。"
        if (type(old.get("endurance")) is int and type(new.get("endurance")) is int
                and new["endurance"] < old["endurance"]) or any(
                row["field"] == "endurance" and type(row.get("before")) is int
                and type(row.get("after")) is int and row["after"] < row["before"] for row in changes):
            return "injury", "耐力受损，已停下来等待你的决定。"
        if (old.get("coldCondition") != new.get("coldCondition") or
                (type(old.get("movementSpeed")) is int and type(new.get("movementSpeed")) is int
                 and new["movementSpeed"] < old["movementSpeed"])):
            return "cold_changed", "寒冷或行动能力发生变化，已交还控制。"
        if candidate.expectations.get("movement") and (new["locationId"] != candidate.key[2]
                or result.get("landing", candidate.key[2]) != candidate.key[2]):
            return "landing_changed", "实际落点偏离了目标，已交还控制。"
        for field in ("everflameCharges", "carriedReservoirCharges", "gold"):
            expected_delta = {"everflameCharges": candidate.expectations["torch_gain"] - candidate.expectations["torch_spend"],
                              "carriedReservoirCharges": -candidate.expectations["reservoir_spend"], "gold": 0}[field]
            if old.get(field) == new.get(field) and expected_delta == 0:
                continue
            delta = new[field] - old[field] if type(old.get(field)) is int and type(new.get(field)) is int else None
            expected = ((delta is not None and delta == expected_delta)
                        or (candidate.expectations["reveals_reservoir"] and field == "carriedReservoirCharges"
                            and type(new.get(field)) is int and new[field] >= 0
                            and (old.get(field) is None or type(old[field]) is int and new[field] >= old[field])))
            if not expected:
                return "resource_changed", "资源发生了预期之外的变化，请核对后继续。"
        ritual = ((after.get("information") or {}).get("ritual") or {}).get("phase")
        if ritual == "completed" and ((before.get('information') or {}).get('ritual') or {}).get('phase') != 'completed':
            return "ritual_changed", "仪式出现重大变化，已交还控制。"
        return None

    @staticmethod
    def terminal_reason(frame):
        ending = frame.get('ending') or {}
        fields = frame['fields']
        if ending.get('id') == 'adventurer_dead' or fields.get('lifeState') == 'dead':
            return 'death', '旅人已经死亡，自动行动已停止。本次旅程结束；可查看最后的伤害与结算。'
        if ending:
            return 'ending', ending.get('narrationZh') or '本次旅程已经结束。'
        if fields.get('lifeState') == 'incapacitated':
            return 'incapacitated', '旅人已失去行动能力，自动行动已停止，需要他人照料。'
        if fields.get('coldState') == 'frozen':
            return 'frozen', '旅人已被冻结，自动行动已停止。'
        return None
