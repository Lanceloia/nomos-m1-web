"""Finite destination estimates over the player's public graph, not future worlds."""
from collections import deque
from copy import deepcopy
from dataclasses import dataclass, fields, replace
import hashlib
import json
from pathlib import Path

from .play_report import DIMENSIONS, ScoreFacts
from .runtime import install_roots


UNCERTAINTY = '已知通路的收益估计；下一步仍需实际结算'
ROUTE_KINDS = frozenset({'path', 'ice', 'bridge', 'door'})
MOVEMENT_KINDS = frozenset({'walk', 'ice', 'bridge', 'door'})
BINARY_FACTS = frozenset({'ritualDisrupted', 'departed', 'failed'})


@dataclass(frozen=True)
class PlanningKnowledge:
    ritual_active: bool
    ritual_disrupted: bool
    ritual_dangerous: bool = False


@dataclass(frozen=True)
class Plan:
    goal: str
    site: str
    route: tuple[str, ...]
    estimated_actions: int
    gain: int
    value: float
    feature: str
    # Authored intent utility is not a forecasted achievement or an awarded score.
    preference: int = 0

    def snapshot(self, frame):
        """Render this selected estimate only; never select or invent an offer."""
        labels = (frame.get('scene') or {}).get('siteLabels') or {}
        return {'goal': self.goal, 'targetSite': self.site,
                'route': [{'site': site, 'label': labels.get(site, site)} for site in self.route],
                'estimatedActions': self.estimated_actions, 'estimatedGain': self.gain,
                'value': self.value, 'preference': self.preference, 'uncertainty': UNCERTAINTY}


def _when_ports():
    from nomos_c0.composable_value_v1 import C0ValuePorts
    roots = {'progress': ScoreFacts, 'knowledge': PlanningKnowledge}
    reads = {carrier: frozenset(field.name for field in fields(carrier))
             for carrier in roots.values()}
    paths = frozenset(root + '.' + field for root, carrier in roots.items()
                      for field in reads[carrier])
    return C0ValuePorts(roots, paths, paths, reads, reads, {}, {}, {}, {}, {}, {'active': bool})


def _text(value):
    return type(value) is str and bool(value.strip())


def _validate_goal(goal, row, gain_fields):
    if (not _text(goal) or type(row) is not dict
            or set(row) != {'label', 'selector', 'when', 'gains', 'feature', 'preferences'}
            or not _text(row['label']) or not _text(row['feature'])
            or type(row['when']) not in (bool, str)
            or type(row['when']) is str and not _text(row['when'])
            or type(row['gains']) is not dict
            or any(name not in gain_fields or type(delta) is not int or delta < 0
                   for name, delta in row['gains'].items())):
        raise ValueError('Malformed public planning goal: ' + str(goal))
    preferences = row['preferences']
    if (type(preferences) is not dict or set(preferences) != set(DIMENSIONS)
            or any(type(value) is not int or not -1000 <= value <= 1000
                   for value in preferences.values())):
        raise ValueError('Planning preferences need all three bounded dimensions: ' + goal)
    selector = row['selector']
    if type(selector) is not dict or len(selector) != 1:
        raise ValueError('Planning selector needs exactly one form: ' + goal)
    if set(selector) == {'sites'}:
        sites = selector['sites']
        valid = (type(sites) is list and bool(sites) and all(_text(site) for site in sites)
                 and len(set(sites)) == len(sites))
    elif set(selector) == {'observation'}:
        observation = selector['observation']
        valid = type(observation) is dict and observation == {'kind': 'person', 'state': 'frozen'}
    elif set(selector) == {'frontier'}:
        frontier = selector['frontier']
        valid = (type(frontier) is dict and set(frontier) in ({'exclude_sites'}, {'only_sites'}))
        sites = next(iter(frontier.values())) if valid else None
        valid = (valid and type(sites) is list and all(_text(site) for site in sites)
                 and len(set(sites)) == len(sites))
    else:
        valid = False
    if not valid:
        raise ValueError('Malformed public planning selector: ' + goal)


def _public_graph(frame, rated_movements):
    origin = (frame.get('fields') or {}).get('locationId')
    if not _text(origin):
        return None, {}
    scene = frame.get('scene') or {}
    observations = frame.get('observations') or ()
    offers = frame.get('offers') or ()
    known = {origin}
    known.update(site for site in scene.get('knownSites', ()) if _text(site))
    known.update(row['site'] for row in observations if _text(row.get('site')))
    known.update(row['destination'] for row in offers if _text(row.get('destination')))
    graph = {site: set() for site in known}
    for row in scene.get('routes', ()):
        start, end = row.get('start'), row.get('end')
        if row.get('kind', 'path') in ROUTE_KINDS and start in graph and end in graph:
            graph[start].add(end)
    for offer in offers:
        destination = offer.get('destination')
        if (offer.get('entry') in rated_movements and destination in graph
                and ('movementKind' not in offer or offer['movementKind'] in MOVEMENT_KINDS)):
            graph[origin].add(destination)
    return origin, graph


def _shortest_routes(origin, graph):
    """Sorted BFS enqueues each known node once, even on cyclic graphs."""
    routes, pending = {origin: (origin,)}, deque([origin])
    while pending:
        start = pending.popleft()
        for end in sorted(graph[start]):
            if end not in routes:
                routes[end] = routes[start] + (end,)
                pending.append(end)
    return routes


def distances(frame, goal, rated_movements):
    """Reverse distances on the same public edge contract used by the planner."""
    _, graph = _public_graph(frame, rated_movements)
    if goal not in graph:
        return {}
    reverse = {site: set() for site in graph}
    for start, ends in graph.items():
        for end in ends:
            reverse[end].add(start)
    result, pending = {goal: 0}, deque([goal])
    while pending:
        end = pending.popleft()
        for start in sorted(reverse[end]):
            if start not in result:
                result[start] = result[end] + 1
                pending.append(start)
    return result


class PublicPlanner:
    def __init__(self, score_rules, document=None):
        install_roots()
        from nomos_c0.author_document_v1 import parse_author_document
        from nomos_c0.composable_value_v1 import compile_value_program
        digest = None
        if document is None:
            path = Path(__file__).parent / 'policies/m1_public_goals_v1.yaml'
            parsed = parse_author_document(path.read_text(encoding='utf-8'),
                                           file=str(path), format='yaml')
            document, digest = parsed.to_data(), parsed.digest
        if (type(document) is not dict or set(document) != {'schema', 'goals'}
                or document['schema'] != 'm1.public_planning.v1'
                or type(document['goals']) is not dict or not document['goals']):
            raise ValueError('Malformed public planning contract')
        gain_fields = {field.name for field in fields(ScoreFacts)} - {'publishedActions'}
        for goal, row in document['goals'].items():
            _validate_goal(goal, row, gain_fields)
        self.digest = digest if digest is not None else hashlib.sha256(
            json.dumps(document, sort_keys=True, separators=(',', ':')).encode('utf-8')).hexdigest()
        self.score_rules, self.goals = score_rules, deepcopy(document['goals'])
        ports = _when_ports()
        self.conditions = {goal: compile_value_program(json.dumps({
            'schema': 'c0.value.v1', 'bindings': [], 'guard': True,
            'outputs': {'active': row['when']}}), ports,
            admission_outputs=frozenset({'active'})) for goal, row in self.goals.items()}

    def plans(self, frame, personality, facts: ScoreFacts, visited_places: set,
              handled_targets: set, rated_movements: set) -> list[Plan]:
        if personality not in DIMENSIONS:
            raise ValueError('Unknown public planning personality')
        if frame.get('ending'):
            return []
        origin, graph = _public_graph(frame, rated_movements)
        if origin is None:
            return []
        phase = ((frame.get('information') or {}).get('ritual') or {}).get('phase')
        knowledge = PlanningKnowledge(phase in {'preparing', 'gathering', 'critical'},
                                      phase == 'disrupted', phase in {'critical', 'completed', 'erupted'})
        routes = _shortest_routes(origin, graph)
        scores = self.score_rules.evaluate(facts)
        baseline = scores['common'] + scores[personality] - scores['cost']
        result = []
        for goal, row in self.goals.items():
            active = self.conditions[goal].evaluate_admission_outputs(
                {'progress': facts, 'knowledge': knowledge})
            if not active['active']:
                continue
            selector = row['selector']
            frontier = 'frontier' in selector
            if 'sites' in selector:
                targets = set(selector['sites']) & graph.keys()
            elif frontier:
                targets = graph.keys() - visited_places - {origin}
                selection = selector['frontier']
                if 'only_sites' in selection:
                    targets &= set(selection['only_sites'])
                else:
                    targets -= set(selection['exclude_sites'])
            else:
                targets = {item['site'] for item in frame.get('observations', ())
                           if item.get('kind') == 'person' and item.get('state') == 'frozen'
                           and _text(item.get('id')) and item['id'] not in handled_targets
                           and item.get('site') in graph}
            for site in sorted(targets):
                route = routes.get(site)
                if route is None:
                    continue
                estimated_actions = len(route) - 1 + (not frontier)
                deltas = dict(row['gains'])
                for name in BINARY_FACTS & deltas.keys():
                    deltas[name] = min(deltas[name], max(0, 1 - getattr(facts, name)))
                if knowledge.ritual_disrupted and 'ritualDisrupted' in deltas:
                    deltas['ritualDisrupted'] = 0
                if site == origin or site in visited_places:
                    deltas['visitedPlaces'] = 0
                deltas['publishedActions'] = estimated_actions
                predicted = replace(facts, **{name: getattr(facts, name) + delta
                                              for name, delta in deltas.items()})
                scores = self.score_rules.evaluate(predicted)
                gain = scores['common'] + scores[personality] - scores['cost'] - baseline
                preference = row['preferences'][personality]
                # A frontier may cost points before it reveals any useful opportunity.
                # Keep its real negative estimate as a fallback, not a promised reward.
                if gain + preference > 0 or frontier:
                    result.append(Plan(row['label'], site, route, estimated_actions,
                                       gain, (gain + preference) / estimated_actions, row['feature'], preference))
        return sorted(result, key=lambda plan: (-plan.value, plan.site, plan.goal))
