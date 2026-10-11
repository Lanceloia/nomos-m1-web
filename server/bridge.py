"""Local M1 transport. C0/K0 alone owns all world transitions and player visibility."""
from __future__ import annotations

import copy
import argparse
import json
import logging
import mimetypes
import threading
from time import perf_counter
import uuid
from collections import OrderedDict
from dataclasses import fields as data_fields, is_dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

if __package__:
    from .share_access import ShareAccess, WELCOME
    from .m1_policy import M1Policy
    from .policy_execution import PolicyError
    from .player_information import PlayerInformation
    from .runtime import ENGINE_ROOT, WORLD_ROOT, WORLD_BUNDLE, install_roots, provenance
else:
    from share_access import ShareAccess, WELCOME
    from m1_policy import M1Policy
    from policy_execution import PolicyError
    from player_information import PlayerInformation
    from runtime import ENGINE_ROOT, WORLD_ROOT, WORLD_BUNDLE, install_roots, provenance
install_roots()
from server.authored_appraisal import AuthoredAppraisal
from server.play_report import PlayLedger, ScoreRules

from nomos_c0.author_contract_v1 import C0BindingError
from nomos_c0.source_bundle_v1 import read_source_bundle, compile_source_bundle
from nomos_examples import everflame_bundle_path
from nomos_c0.program_runtime_v1 import C0ControlCommand
from nomos_kernel._settlement_outcome_abi import K0NotAdmitted, K0Published
if __package__:
    from .player_result import player_result
    from .projection import MOVEMENTS, ICE_MOVEMENTS, observations, offer_forecasts, action_feedback, scalar_records, passage_warning, heard_escort_replies
else:
    from player_result import player_result
    from projection import MOVEMENTS, ICE_MOVEMENTS, observations, offer_forecasts, action_feedback, scalar_records, passage_warning, heard_escort_replies


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        self.status, self.message = status, message


def compile_m1():
    selected = everflame_bundle_path().resolve()
    if selected != WORLD_BUNDLE.resolve():
        raise RuntimeError('M1 bundle is not from the selected release checkout')
    bundle = read_source_bundle(selected)
    program = compile_source_bundle(bundle)
    return program, bundle.assets.to_data(), provenance(bundle)


def display(value, terms):
    """Format only seat-visible values, without serializing internal references."""
    if value is None:
        return ""
    if type(value) is str:
        return terms.get(value, value)
    if type(value) in (int, bool):
        return str(value)
    if type(value).__module__.startswith("nomos_kernel"):
        return ""
    if is_dataclass(value):
        return " · ".join(filter(None, (
            display(getattr(value, item.name), terms)
            for item in data_fields(value)
            if item.name not in ("ref", "owner", "seed", "occurrence")
        )))
    if isinstance(value, tuple):
        return "; ".join(display(item, terms) for item in value)
    # Opaque identities are never player-facing prose.
    return ""


def label(offer, terms):
    return "".join(terms.get(text, text) if translate else text
                   for text, translate in offer.label_fragments) if offer.label_fragments else offer.label


FIELD_KEYS = {
    "location": "adventurer.site",
    "everflameCharges": "adventurer.known_everflame_charges",
    "carriedReservoirCharges": "adventurer.known_reservoir_charges",
    "coldCondition": "adventurer.cold_state",
    "movementSpeed": "adventurer.current_movement_speed",
    "maxMovementSpeed": "adventurer.max_movement_speed",
    "ritualSigns": "adventurer.ritual_notice",
    "chandelierClue": "adventurer.chandelier_sighting.notice",
    "life": "adventurer.vital.life",
    "endurance": "adventurer.vital.endurance",
    "maxEndurance": "adventurer.vital.max_endurance",
    "gold": "adventurer.gold",
    "rescueElapsed": "adventurer.vital.rescue_episode.elapsed_cold",
    "lastPersonThawed": "adventurer.last_thawed",
    "lastIceRoll": "adventurer.last_cross_roll",
    "lastColdRoll": "adventurer.last_cold_roll",
}
NUMERIC_FIELDS = {"everflameCharges", "carriedReservoirCharges", "movementSpeed", "lastIceRoll", "lastColdRoll"}
NUMERIC_FIELDS.update({'endurance', 'maxEndurance', 'gold', 'rescueElapsed', 'maxMovementSpeed'})
ENDING_TITLES = {"departed_palace": "结局 · 离开宫殿", "rescue_window_expired": "结局 · 救援窗口关闭", "adventurer_dead": "结局 · 旅人死亡"}


class Game:
    def __init__(self, program, assets, appraisal=None, score_rules=None):
        self.program, self.assets = program, assets
        self.appraisal = appraisal
        self.score_rules = score_rules or ScoreRules(program=program)
        self.lock = threading.Lock()
        self.session_id = uuid.uuid4().hex
        self.revision = 0
        self.policy_revision = -1
        self.completed = OrderedDict()
        self.reset()

    def reset(self):
        self.session = self.program.start(self.assets)
        humans = self.session.human_seats()
        if len(humans) != 1:
            raise ValueError("M1 bridge requires exactly one human seat")
        self.seat = humans[0]
        self.presentation = next(s.presentation for s in self.program.seats if s.symbol == self.seat)
        if self.presentation is None:
            raise ValueError("M1 human seat requires authored presentation")
        self.terms = dict(self.presentation.terms)
        self.labels = dict(self.presentation.fields)
        self.journal = []
        self.feedback = None
        self.action_record = None
        self.finish_entry = None
        self.display_history = {}
        self.display_sequence = 0
        self.observation_ids = {}
        self.player_information = PlayerInformation()
        if self.appraisal is None:
            self.appraisal = AuthoredAppraisal(program=self.program, seat=self.seat)
        elif self.appraisal.program is not self.program or self.appraisal.seat != self.seat:
            raise ValueError("Appraisal belongs to another Program or seat")
        self.policy = M1Policy(appraisal=self.appraisal, score_rules=self.score_rules)
        self.policy_revision += 1
        self.faulted = False
        self.engine_frame = self.session.continue_form(self.seat)
        self.entry("system", self.presentation.opening or self.presentation.title)
        self.remember_visible(self.engine_frame.view.fields, self.engine_frame.time)
        self.capture_information(self.engine_frame.view.fields, self.engine_frame.time, self.revision)
        self.frame = self.render()
        self.play_ledger = PlayLedger(self.frame, self.score_rules)
        self.policy.observe_episode(self.frame, self.play_ledger)

    def remember_visible(self, visible, time, displayed_paths=None):
        if not hasattr(self, "display_history"):
            self.display_history, self.display_sequence = {}, 0
        for entry, paths in getattr(self.presentation, "finish_fields", ()):
            if displayed_paths is not None and not set(paths).issubset(displayed_paths):
                continue
            rows = scalar_records(paths, visible, self.presentation, self.terms)
            if not any("value" in row for row in rows) and entry not in self.display_history:
                continue
            history = self.display_history.setdefault(entry, {"records": [], "truncated": False})
            if history["records"] and history["records"][-1]["fields"] == rows:
                continue
            self.display_sequence += 1
            history["records"].append({"sequence": self.display_sequence, "time": time, "fields": rows})
            if len(history["records"]) > 64:
                del history["records"][0]
                history["truncated"] = True

    def entry(self, kind, text):
        self.journal.append({"id": len(self.journal) + 1, "kind": kind, "text": text})

    def identify_observation(self, identity):
        if identity not in self.observation_ids:
            self.observation_ids[identity] = f'seen-{len(self.observation_ids) + 1}'
        return self.observation_ids[identity]

    def capture_information(self, fields, time, revision, prior=None):
        visible = dict(fields)
        identify = self.identify_observation
        surfaces = self.player_information.capture_surface(visible, identify, self.terms)
        # The authored singleton observation and the live target denote one Object.
        for surface in surfaces:
            if surface['kind'] == 'chandelier':
                self.observation_ids['observation:chandelier'] = surface['id']
        records = observations(visible, self.terms, identify,
                               lambda identity: self.player_information.person_label(identity, identify, self.terms))
        discoveries = self.player_information.capture(records + surfaces,
                                                       visible.get('adventurer.ritual_notice'), time, revision)
        discoveries.extend(self.player_information.capture_movements(
            visible.get('adventurer.conversations.visible_motions'), identify, self.terms, time, revision))
        discoveries.extend(self.player_information.capture_replies(
            heard_escort_replies(visible), identify, self.terms, time, revision,
            heard_escort_replies(prior or {})))
        return discoveries

    def render(self):
        visible = dict(self.engine_frame.view.fields)
        observed = self.player_information.observations()
        observed_ids = {item['id'] for item in observed}
        detail_terms = {**self.terms, **{
            subject: self.player_information.person_label(subject, self.identify_observation, self.terms)
            for subject in self.player_information.person_subjects}}
        game_fields = {}
        for name, key in FIELD_KEYS.items():
            value = visible.get(key)
            game_fields[name] = value if name in NUMERIC_FIELDS else (display(value, self.terms) or None)
        game_fields["locationId"] = visible.get("adventurer.site")
        game_fields["protection"] = [
            {"site": self.terms.get(site, site), "siteId": site,
             "now": self.terms.get(dict(cells)["status"], dict(cells)["status"]),
             "afterSpendOne": self.terms.get(dict(cells)["after_spend_one"], dict(cells)["after_spend_one"])}
            for site, cells in visible.get("known_site_protection", ())
        ]
        mapped = set(FIELD_KEYS.values()) | {"known_site_protection"}
        structured = ('adventurer.person_sighting', 'adventurer.known_residents',
                      'adventurer.known_bar_bears', 'adventurer.conversations.prison.contacts',
                      'adventurer.resources.chest', 'adventurer.resources.balloon',
                      'adventurer.drink_sighting', 'adventurer.prison_access.bars',
                      'adventurer.prison_access.line', 'adventurer.elemental_sighting',
                      'adventurer.floor_sighting', 'adventurer.treasure_receipt',
                      'adventurer.conversations.movement_attempt',
                      'adventurer.conversations.heard_escort_replies',
                      'adventurer.chandelier_sighting', 'adventurer.known_climbs',
                      'adventurer.conversations.visible_motions',
                      'adventurer.known_walls', 'adventurer.known_paths', 'adventurer.known_crossings',
                      'adventurer.known_bridge_paths', 'adventurer.vital')
        game_fields["details"] = [
            {"label": self.labels[key], "value": display(value, detail_terms)}
            for key, value in visible.items()
            if key not in mapped and not any(key == prefix or key.startswith(prefix + '.') for prefix in structured)
            and not any(key.startswith(parent + '.') and parent not in mapped and visible[parent] is not None
                        and self.labels.get(parent) is not None for parent in visible if parent != key)
            and self.labels.get(key) is not None and value is not None and display(value, self.terms)
        ]
        # Semantic codes are separate from localized HUD text for control decisions.
        game_fields['lifeState'] = visible.get('adventurer.vital.life')
        game_fields['coldState'] = visible.get('adventurer.cold_state')
        # Only actual movement entries receive destinations; escort requests and carry
        # interventions are not interchangeable with moving the adventurer alone.
        crossings = {c.key: c.intended for c in visible.get("adventurer.known_crossings", ())}
        offers = []
        for index, offer in enumerate(self.engine_frame.offers, 1):
            item = {"index": index, "entry": offer.entry, "label": label(offer, self.terms)}
            item['forecasts'] = offer_forecasts(offer, getattr(self, 'presentation', None), self.terms)
            payload = dict(offer.payload)
            authored = self.policy.appraisal.project(offer.entry, payload, crossings,
                                                    self.observation_ids, observed_ids)
            if authored is not None:
                item.update(authored)
            else:
                # Existing manual-only UI projection is not an appraisal input.
                destination = (crossings.get(payload.get('crossing')) if offer.entry in ICE_MOVEMENTS
                               else payload.get('destination') if offer.entry in MOVEMENTS else None)
                if destination is not None:
                    item["destination"] = destination
                    item['movementKind'] = MOVEMENTS[offer.entry]
            # Presentation targets also apply when appraisal has no target feature.
            targets = [self.observation_ids[value] for key, value in payload.items()
                       if key in {'person', 'victim', 'patient', 'target', 'recipient', 'resident',
                                  'item', 'chest', 'container', 'drink', 'balloon', 'fox', 'bars', 'door', 'floor_key',
                                  'chandelier', 'reservoir', 'torch', 'wall'}
                       and value in self.observation_ids and self.observation_ids[value] in observed_ids]
            if targets:
                item['targetIds'] = sorted(set(item.get('targetIds', ())) | set(targets))
            warning = passage_warning(offer, visible, enumerate(self.engine_frame.offers, 1))
            if warning is not None:
                item['passageWarning'] = warning
            offers.append(item)
        current_site = visible["adventurer.site"]
        known = {current_site}
        known.update(item["destination"] for item in offers if "destination" in item)
        known.update(item.site for item in visible.get("adventurer.known_sites", ()))
        routes = []
        route_keys = set()
        def add_route(start, end, kind):
            key = (start, end, kind)
            if key not in route_keys:
                route_keys.add(key)
                routes.append({"start": start, "end": end, "kind": kind})
            known.update((start, end))

        for path in visible.get("adventurer.known_paths", ()):
            add_route(path.start, path.end, "path")
        for crossing in visible.get("adventurer.known_crossings", ()):
            add_route(crossing.start, crossing.intended, "ice")
        for path in visible.get("adventurer.known_bridge_paths", ()):
            add_route(path.start, path.end, "bridge")
        for climb in visible.get('adventurer.known_climbs', ()):
            add_route(climb.route.start, climb.route.end, 'climb')
        known.update(item['site'] for item in observed if item['site'])
        known.update(site for site, _ in visible.get("known_site_protection", ()))
        # No author_snapshot, hidden NPC positions, private dice seeds or guessed rescues.
        scene = {"playerSite": current_site, "knownSites": sorted(known),
                 "siteLabels": {site: self.terms.get(site, site) for site in sorted(known)},
                 "routes": routes,
                 "tokens": [
                     {"id": "player", "kind": "player", "label": "你 · Adventurer",
                      "site": current_site, "state": visible.get('adventurer.vital.life')
                      if visible.get('adventurer.vital.life') in ('dead', 'incapacitated') else
                      "frozen" if visible.get("adventurer.cold_state") == "frozen" else "normal"}
                 ] + [{**{key: item[key] for key in ('id', 'label', 'site', 'state')},
                       'kind': 'npc' if item['kind'] == 'person' else 'antagonist' if item['kind'] == 'elemental' else 'item',
                       'appearance': item['kind'], 'observed': True, 'layer': 'memory'}
                      for item in observed if item['site']]}
        ending = None
        if self.engine_frame.finished:
            outcome = self.engine_frame.outcome
            if outcome not in ENDING_TITLES:
                raise ValueError(f"Unsupported M1 outcome: {outcome}")
            engine_text = next((text for entry, result, text in self.presentation.finish_on_action
                                if result == outcome and entry == getattr(self, "finish_entry", None)), None)
            ending = {"id": outcome, "title": ENDING_TITLES[outcome], "engineText": engine_text,
                      "recap": copy.deepcopy(getattr(self, "display_history", {}).get(getattr(self, "finish_entry", None), {"records": [], "truncated": False})),
                      "entry": getattr(self, "finish_entry", None),
                      "narrationZh": "你离开了宫殿。离开本身不能证明其他人的命运。" if outcome == "departed_palace"
                      else "旅人已经死亡。本次旅程结束。" if outcome == 'adventurer_dead'
                      else "救援窗口已关闭。本次会话结束；这不表示角色死亡。"}
        return {"time": self.engine_frame.time,
                "briefing": getattr(self.presentation, 'opening', ''),
                "fields": game_fields, "offers": offers,
                "ending": ending, "scene": scene, 'observations': observed,
                'information': self.player_information.snapshot(),
                "actionRecord": copy.deepcopy(getattr(self, "action_record", None)),
                "history": copy.deepcopy(getattr(self, "display_history", {})),
                'feedback': getattr(self, 'feedback', None)}

    def response(self):
        return {"sessionId": self.session_id, "revision": self.revision,
                "frame": self.frame, "entries": list(self.journal),
                "intentOffers": self.policy.offers(self.frame), "policy": self.policy.snapshot(self.frame),
                "policyRevision": self.policy_revision,
                "playReport": self.play_ledger.snapshot(self.frame)}

    def advice(self, body):
        if self.faulted:
            raise ApiError(409, '引擎无法继续此局，请重新开始。')
        if (type(body.get('revision')) is not int or body['revision'] != self.revision
                or type(body.get('policyRevision')) is not int
                or body['policyRevision'] != self.policy_revision):
            raise ApiError(409, '行动列表已变化，请同步后重新查看建议。')
        intent_id = body.get('intentId')
        if type(intent_id) is not str or intent_id not in self.policy.profiles:
            raise ApiError(400, '请选择当前人格倾向。')
        unexpected = body.get('stopOnUnexpected')
        if type(unexpected) is not bool:
            raise ApiError(400, '请提供意外交还控制设置。')
        if self.policy.run and self.policy.run.status == 'running':
            raise ApiError(409, '请先停止当前代行。')
        return {'sessionId': self.session_id, 'revision': self.revision,
                'policyRevision': self.policy_revision,
                **self.policy.advice(self.frame, intent_id, stop_on_unexpected=unexpected)}

    def mutate(self, operation, body, *, _delegated=False):
        request_id = body.get("requestId")
        if not isinstance(request_id, str) or not 1 <= len(request_id) <= 100:
            raise ApiError(400, "请求缺少有效 requestId。")
        signature = json.dumps({"operation": operation, "body": body}, sort_keys=True)
        if request_id in self.completed:
            prior_signature, result = self.completed[request_id]
            if prior_signature != signature:
                raise ApiError(409, "请求标识已被另一项操作使用，请重新同步。")
            return result
        if type(body.get("revision")) is not int or body["revision"] != self.revision:
            raise ApiError(409, "行动列表已变化。请重新同步后选择当前行动。")
        if not _delegated and self.policy.run and self.policy.run.status == 'running':
            raise ApiError(409, "意图正在执行，请先停止，再自行选择行动或重新开始。")
        if operation == "restart":
            self.reset()
        else:
            if self.faulted:
                raise ApiError(409, "引擎结算失败，请重新开始此局。")
            index = body.get("index")
            if type(index) is not int or not 1 <= index <= len(self.engine_frame.offers):
                raise ApiError(400, "请选择当前可用行动。")
            offer = self.engine_frame.offers[index - 1]
            before_frame = self.frame
            appraisal_key, merits = self.policy.action_merits(before_frame, index)
            before = dict(self.engine_frame.view.fields)
            engine_started = perf_counter()
            refusal_code = None
            try:
                result = self.session.apply_control(C0ControlCommand("submit", self.seat, offer=offer)).result
            except C0BindingError:
                # A refused submission costs no host-invented time.
                result = None
                refusal_code = 'C0_BINDING_REJECTED'
            submit_ms = (perf_counter() - engine_started) * 1000
            immediate_started = perf_counter()
            continue_ms = 0.0
            published = isinstance(result, K0Published)
            if not published and refusal_code is None:
                refusal_code = ('K0_NOT_ADMITTED' if isinstance(result, K0NotAdmitted)
                                else 'UNPUBLISHED_RESULT')
            if published and offer.entry == 'offer_escort_adventurer':
                self.player_information.record_invitation()
            instant = before
            immediate_discoveries = []
            later_discoveries = []
            action_record = None
            instant_time = before_frame['time']
            if published:
                current = self.session.form_frame(self.seat)
                instant_time = current.time
                instant = dict(current.view.fields)
                paths = dict(getattr(self.presentation, "published_fields", ())).get(offer.entry, ())
                if paths:
                    action_record = {"entry": offer.entry, "actionLabel": label(offer, self.terms),
                                     "fields": scalar_records(
                                         paths, current.view.fields, self.presentation, self.terms,
                                         lambda identity: self.player_information.person_label(
                                             identity, self.identify_observation, self.terms))}
                    self.remember_visible(current.view.fields, current.time, set(paths))
            feedback = action_feedback(offer, self.presentation, self.terms, published)
            if refusal_code is not None:
                # Report the actual rejection boundary, never an inferred private guard.
                feedback['refusal'] = {'code': refusal_code}
                if refusal_code == 'UNPUBLISHED_RESULT':
                    feedback['text'] = '本次提交未取得可识别的结算结果。请同步当前状态后核对。'
            self.entry("choice", "> " + label(offer, self.terms))
            if isinstance(result, K0Published):
                immediate_discoveries = self.capture_information(instant, current.time, self.revision + 1, before)
                self.finish_entry = offer.entry if current.finished and any(
                    entry == offer.entry and outcome == current.outcome
                    for entry, outcome, _ in self.presentation.finish_on_action) else None
                immediate_ms = (perf_counter() - immediate_started) * 1000
                continue_started = perf_counter()
                self.engine_frame = current if current.finished else self.session.continue_form(self.seat)
                continue_ms = (perf_counter() - continue_started) * 1000
            else:
                self.engine_frame = self.session.form_frame(self.seat)
                immediate_ms = (perf_counter() - immediate_started) * 1000
            engine_ms = (perf_counter() - engine_started) * 1000
            presentation_started = perf_counter()
            after = dict(self.engine_frame.view.fields)
            if published:
                later_discoveries = self.capture_information(after, self.engine_frame.time, self.revision + 1, instant)
            receipt_paths = ('adventurer.conversations.movement_attempt',
                             'adventurer.conversations.heard_escort_replies')
            for key, value in after.items():
                if (self.labels.get(key) is not None and key != 'known_site_protection'
                        and not any(key == path or key.startswith(path + '.') for path in receipt_paths)
                        and ((value != before.get(key)) or (key.endswith("_roll") and after.get(key[:-4] + "ref") != before.get(key[:-4] + "ref")))):
                    rendered = display(value, self.terms)
                    if rendered:
                        self.entry("roll" if key in ("adventurer.last_cross_roll", "adventurer.last_cold_roll") else "engine",
                                   f"{self.labels[key]}: {rendered}")
            feedback["result"] = player_result(offer, before, instant, after, published)
            if published:
                attempt = feedback['result'].get('movementAttempt')
                if attempt and attempt['outcome'] == 'blocked':
                    feedback['text'] = '你确实尝试了通行，但没有通过，仍停在出发处。行动已发布；时间与消耗以实际回执为准，受阻的具体原因尚不清楚。'
                feedback['result']['elapsed'] = {'action': instant_time - before_frame['time'],
                    'subsequent': self.engine_frame.time - instant_time}
                feedback['result']['discoveries'] = immediate_discoveries
                feedback['result']['laterDiscoveries'] = later_discoveries
            self.entry("system", feedback['text'])
            self.feedback = feedback
            self.action_record = action_record
            self.remember_visible(self.engine_frame.view.fields, self.engine_frame.time)
            self.frame = self.render()
            public_offer = next(row for row in before_frame['offers'] if row['index'] == index)
            thawed_id = self.observation_ids.get(instant.get('adventurer.last_thawed')) if published else None
            # Match the actual seat-local result to the already public selected target.
            if thawed_id not in public_offer.get('targetIds', ()):
                thawed_id = None
            # Published receipts alone award style; refused or repeated requests cannot.
            self.play_ledger.record(before=before_frame, after=self.frame, entry=offer.entry,
                label=label(offer, self.terms), publication=result if published else None,
                instant=instant, personality=self.policy.run.intent_id if _delegated else None,
                appraisal_key=appraisal_key, merits=merits, thawed_target_id=thawed_id)
            self.policy.observe_episode(self.frame, self.play_ledger, public_offer, before_frame, published)
            if self.frame["ending"]:
                ending = self.frame["ending"]
                self.entry("ending", ending["engineText"] or ending["title"])
            logging.info('M1 action timing: settlement_pipeline=%.1f ms (submit=%.1f, immediate_projection=%.1f, continue=%.1f), final_presentation=%.1f ms',
                         engine_ms, submit_ms, immediate_ms, continue_ms,
                         (perf_counter() - presentation_started) * 1000)
        self.revision += 1
        response = self.response()
        if not _delegated:
            self.completed[request_id] = (signature, copy.deepcopy(response))
        while len(self.completed) > 32:
            self.completed.popitem(last=False)
        return response

    def control_policy(self, operation, body):
        request_id = body.get('requestId')
        if type(request_id) is not str or not 1 <= len(request_id) <= 100:
            raise ApiError(400, '请求缺少有效 requestId。')
        signature = json.dumps({'operation': 'policy/' + operation, 'body': body}, sort_keys=True)
        if request_id in self.completed:
            prior_signature, response = self.completed[request_id]
            if signature != prior_signature:
                raise ApiError(409, '请求标识已被另一项操作使用，请重新同步。')
            return copy.deepcopy(response)
        if type(body.get('revision')) is not int or body['revision'] != self.revision:
            raise ApiError(409, '行动列表已变化，请重新同步。')
        if type(body.get('policyRevision')) is not int or body['policyRevision'] != self.policy_revision:
            raise ApiError(409, '意图授权已变化，请重新同步。')
        if self.faulted:
            raise ApiError(409, '引擎无法继续此局，请重新开始。')
        try:
            if operation == 'start':
                if 'maxActions' in body and body['maxActions'] is None:
                    raise PolicyError('推进步数不能为null，请输入1至128的整数。')
                self.policy.start(self.frame, body.get('intentId'), max_actions=body.get('maxActions'),
                                  stop_on_unexpected=body.get('stopOnUnexpected', True))
            elif operation in {'step', 'cancel'}:
                run = self.policy.run
                if run is None or type(body.get('policyId')) is not str or body['policyId'] != run.id:
                    raise PolicyError('意图标识已变化，请重新同步。')
                if operation == 'cancel':
                    if run.status == 'running':
                        self.policy.halt(self.frame, 'cancelled', '已停止按此倾向行动，接下来由你选择。')
                elif run.status != 'running':
                    raise PolicyError('这次意图已经停止。')
                else:
                    selected = self.policy.select(self.frame)
                    if selected is not None:
                        before, revision = self.frame, self.revision
                        self.mutate('actions', {'requestId': uuid.uuid4().hex, 'revision': revision,
                                               'index': selected.candidate.index}, _delegated=True)
                        self.policy.record(selected, before, self.frame, revision, self.revision)
            else:
                raise PolicyError('未知意图操作。')
        except PolicyError as error:
            raise ApiError(409, str(error)) from None
        self.policy_revision += 1
        response = copy.deepcopy(self.response())
        self.completed[request_id] = (signature, response)
        while len(self.completed) > 32:
            self.completed.popitem(last=False)
        return copy.deepcopy(response)


class Bridge:
    def __init__(self, program, assets, max_games=128):
        if type(max_games) is not int or not 1 <= max_games <= 128:
            raise ValueError('max_games must be from 1 to 128')
        self.max_games = max_games
        self.program, self.assets = program, assets
        self.appraisal = None
        self.score_rules = None
        self.state = "ready" if program is not None else "loading"
        self.runtime_info = None
        self.compile_count = 0
        self.games = {}
        self.creations = {}
        self.lock = threading.Lock()

    def create(self, request_id):
        if self.state != "ready":
            raise ApiError(503, "宫殿正在载入，请稍后重新连接。" if self.state == "loading" else "宫殿载入失败，请查看服务终端。")
        if not isinstance(request_id, str) or not 1 <= len(request_id) <= 100:
            raise ApiError(400, "请求缺少有效 requestId。")
        with self.lock:
            if request_id in self.creations:
                return self.games[self.creations[request_id]].response()
            if len(self.games) >= self.max_games:
                raise ApiError(503, "本地会话数量已达上限，请重启服务。")
            if self.appraisal is None:
                humans = [row["seat"] for row in self.assets["controllers"] if row["mode"] == "human_prompt"]
                if len(humans) != 1:
                    raise ValueError("Appraisal needs the single human seat")
                self.appraisal = AuthoredAppraisal(program=self.program, seat=humans[0])
            if self.score_rules is None:
                self.score_rules = ScoreRules(program=self.program)
            game = Game(self.program, self.assets, appraisal=self.appraisal, score_rules=self.score_rules)
            self.games[game.session_id] = game
            self.creations[request_id] = game.session_id
            return game.response()

    def game(self, session_id):
        with self.lock:
            game = self.games.get(session_id)
        if game is None:
            raise ApiError(404, "此会话已失效。服务重启后请重新开始。")
        return game


def make_handler(bridge: Bridge, static_root: Path | None = None, share: ShareAccess | None = None):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            logging.info(fmt, *args)

        def send_json(self, status, value, cookie=None):
            content = json.dumps(value, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Content-Type-Options", "nosniff")
            if cookie is not None:
                self.send_header('Set-Cookie', cookie)
            self.end_headers()
            self.wfile.write(content)

        def route(self):
            parsed = urlparse(self.path)
            parts = parsed.path.strip("/").split("/")
            if share is not None:
                if self.command == 'GET' and parsed.path == '/api/health':
                    return self.send_json(200, {'ok': bridge.state == 'ready', 'status': bridge.state,
                                               'engine': 'NomosEngine2', 'compileCount': bridge.compile_count})
                if self.command == 'POST' and not share.accepts_origin(self.headers.get('Origin')):
                    raise ApiError(403, '请从本次试玩链接进入游戏。')
                if self.command == 'POST' and parsed.path == '/api/access':
                    if self.headers.get_content_type() != 'application/json':
                        raise ApiError(415, '请求必须使用 JSON。')
                    try:
                        length = int(self.headers.get('Content-Length', '0'))
                        if not 0 < length <= 512:
                            raise ValueError()
                        invitation = json.loads(self.rfile.read(length))
                    except (ValueError, UnicodeDecodeError):
                        raise ApiError(400, '邀请码格式无效。') from None
                    if not isinstance(invitation, dict) or not share.accepts_token(invitation.get('invite')):
                        raise ApiError(401, '邀请码无效，请使用分享者提供的完整链接。')
                    return self.send_json(200, {'ok': True}, share.cookie())
                if not share.authorized(self.headers.get('Cookie')):
                    if self.command == 'GET' and parsed.path == '/':
                        content = WELCOME.encode()
                        self.send_response(200)
                        self.send_header('Content-Type', 'text/html; charset=utf-8')
                        self.send_header('Content-Length', str(len(content)))
                        self.send_header('Cache-Control', 'no-store')
                        self.send_header('Referrer-Policy', 'no-referrer')
                        self.send_header('X-Content-Type-Options', 'nosniff')
                        self.end_headers()
                        self.wfile.write(content)
                        return
                    raise ApiError(401, '请先打开完整试玩邀请链接。')
            if self.command == "GET" and parsed.path == "/api/health":
                return self.send_json(200, {"ok": bridge.state == "ready", "status": bridge.state,
                                            "engine": "NomosEngine2", "compileCount": bridge.compile_count,
                                            **(bridge.runtime_info or {"engineRoot": str(ENGINE_ROOT), "worldRoot": str(WORLD_ROOT)})})
            if parts[:2] != ["api", "sessions"]:
                if self.command == "GET" and static_root is not None:
                    candidate = (static_root / parsed.path.lstrip("/")).resolve()
                    if not candidate.is_relative_to(static_root):
                        raise ApiError(404, "未找到页面。")
                    if not candidate.is_file():
                        candidate = static_root / "index.html"
                    content = candidate.read_bytes()
                    self.send_response(200)
                    self.send_header("Content-Type", mimetypes.guess_type(candidate)[0] or "application/octet-stream")
                    self.send_header("Content-Length", str(len(content)))
                    self.end_headers()
                    self.wfile.write(content)
                    return
                raise ApiError(404, "未找到接口。")
            body = None
            if self.command == "POST":
                origin = self.headers.get("Origin")
                if share is None and origin and urlparse(origin).hostname not in ("localhost", "127.0.0.1", "::1"):
                    raise ApiError(403, "本地会话只接受本机页面请求。")
                if self.headers.get_content_type() != "application/json":
                    raise ApiError(415, "请求必须使用 JSON。")
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 0 < length <= 16_384:
                        raise ValueError()
                    body = json.loads(self.rfile.read(length))
                    if type(body) is not dict:
                        raise ValueError()
                except (ValueError, UnicodeDecodeError):
                    raise ApiError(400, "请求内容无效。") from None
            if self.command == "POST" and len(parts) == 2:
                return self.send_json(201, bridge.create(body.get("requestId")))
            if len(parts) not in (3, 4, 5):
                raise ApiError(404, "未找到接口。")
            game = bridge.game(parts[2])
            with game.lock:
                if self.command == "GET" and len(parts) == 3:
                    if game.faulted:
                        raise ApiError(409, "引擎无法继续此局，请重新开始。服务终端保留错误详情。")
                    return self.send_json(200, game.response())
                if self.command == 'POST' and len(parts) == 4 and parts[3] == 'advice':
                    return self.send_json(200, game.advice(body))
                if self.command == "POST" and len(parts) == 4 and parts[3] in ("actions", "restart"):
                    try:
                        response = game.mutate(parts[3], body)
                    except ApiError:
                        raise
                    except Exception:
                        game.faulted = True
                        raise
                    return self.send_json(200, response)
                if self.command == 'POST' and len(parts) == 5 and parts[3] == 'policy' and parts[4] in {'start', 'step', 'cancel'}:
                    try:
                        response = game.control_policy(parts[4], body)
                    except ApiError:
                        raise
                    except Exception:
                        game.faulted = True
                        if game.policy.run:
                            game.policy.run.stop('结算发生异常，已停止执行。请重新同步。', code='fault')
                        raise
                    return self.send_json(200, response)
            raise ApiError(404, "未找到接口。")

        def dispatch(self):
            try:
                self.route()
            except ApiError as error:
                self.send_json(error.status, {"error": error.message})
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception:
                logging.exception("M1 bridge request failed")
                self.send_json(500, {"error": "引擎无法完成本次结算。请重新同步或重新开始；服务终端保留错误详情。"})

        do_GET = dispatch
        do_POST = dispatch

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8791)
    parser.add_argument("--static", type=Path)
    parser.add_argument('--public-origin')
    parser.add_argument('--share-token-file', type=Path)
    parser.add_argument('--share-lifetime', type=int, default=7200)
    parser.add_argument('--max-games', type=int, default=128)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.info("Compiling current M1 from %s", ENGINE_ROOT)
    if bool(args.public_origin) != bool(args.share_token_file):
        parser.error('--public-origin and --share-token-file must be provided together')
    if not 900 <= args.share_lifetime <= 86400:
        parser.error('--share-lifetime must be from 900 to 86400 seconds')
    share = ShareAccess(args.public_origin, args.share_token_file.read_text().strip(), args.share_lifetime) if args.public_origin else None
    if share and args.static is None:
        parser.error('Sharing requires the built --static directory')
    bridge = Bridge(None, None, args.max_games)
    static_root = args.static.resolve() if args.static else None
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(bridge, static_root, share))
    server.daemon_threads = True
    def initialize():
        try:
            bridge.compile_count += 1
            bridge.program, bridge.assets, bridge.runtime_info = compile_m1()
            humans = [row["seat"] for row in bridge.assets["controllers"] if row["mode"] == "human_prompt"]
            if len(humans) != 1:
                raise ValueError("Appraisal needs the single human seat")
            bridge.appraisal = AuthoredAppraisal(program=bridge.program, seat=humans[0])
            bridge.score_rules = ScoreRules(program=bridge.program)
            bridge.runtime_info["appraisalDigest"] = bridge.appraisal.digest
            bridge.runtime_info["appraisalBindings"] = len(bridge.appraisal.compiled.bindings)
            bridge.runtime_info["scoreRulesDigest"] = bridge.score_rules.digest
            bridge.state = "ready"
            logging.info("Palace ready; one Program reused across sessions")
        except Exception:
            bridge.state = "error"
            logging.exception("Palace failed to load")
    threading.Thread(target=initialize, daemon=True).start()
    logging.info("M1 session service: http://127.0.0.1:%s", args.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
