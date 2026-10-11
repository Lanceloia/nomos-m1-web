"""Self-contained public graph contracts; no Session or world execution."""
from copy import deepcopy
from dataclasses import FrozenInstanceError, replace
import hashlib
import json
import unittest
from unittest.mock import patch

from server.play_report import DIMENSIONS, ScoreFacts, ScoreRules
from server.public_planner import Plan, PublicPlanner


def score_document(common=None, helpful=0, cost='facts.publishedActions * 2'):
    scores = dict.fromkeys(('common', *DIMENSIONS, 'cost'), 0)
    scores.update(common=(common if common is not None else
                          'facts.visitedPlaces * 10 + facts.peopleThawed * 30 '
                          '+ facts.ritualDisrupted * 80 + facts.departed * 60'),
                  helpful_rescuer=helpful, cost=cost)
    return {'schema': 'm1.play_score.v1', 'scores': scores, 'thaw_entries': []}


def goal(selector=None, gains=None, when=True, label='Exit', feature='depart'):
    return {'label': label, 'selector': {'sites': ['exit']} if selector is None else selector,
            'when': when, 'gains': {'departed': 1} if gains is None else gains, 'feature': feature,
            'preferences': dict.fromkeys(DIMENSIONS, 0)}


def planning_document(**goals):
    return {'schema': 'm1.public_planning.v1', 'goals': goals or {'exit': goal()}}


def public_frame(edges=(), *, origin='a', known=None, offers=(), observations=(), phase='unknown'):
    routes = [{'start': start, 'end': end} for start, end in edges]
    sites = {origin, *(site for edge in edges for site in edge)} if known is None else set(known)
    return {'fields': {'locationId': origin}, 'scene': {'knownSites': sorted(sites),
            'siteLabels': {site: site.upper() for site in sites}, 'routes': routes},
            'offers': list(offers), 'observations': list(observations),
            'information': {'ritual': {'phase': phase}}, 'ending': None}


class PublicPlannerTests(unittest.TestCase):
    def test_selected_frontier_can_find_an_exit_direction_without_revealing_exit(self):
        row = goal(selector={'frontier': {'only_sites':['b','hidden_exit']}},
                   gains={'visitedPlaces':1},feature='explore')
        planner = self.planner(planning_document(find_exit=row))
        plans = self.plans(planner,public_frame([('a','b'),('a','c')]))
        self.assertEqual([plan.site for plan in plans],['b'])
        self.assertEqual(plans[0].estimated_actions,1)
        self.assertEqual(self.plans(planner,public_frame([('a','b')]),visited={'a','b'}),[])

    def test_preference_is_a_total_goal_bonus_amortized_over_the_route(self):
        row = goal(selector={'frontier': {'exclude_sites': []}},gains={'visitedPlaces':1},feature='explore')
        row['preferences']['cautious_investigator'] = 50
        planner = self.planner(planning_document(explore=row))
        plans = self.plans(planner,public_frame([('a','b'),('b','c')]),personality='cautious_investigator')
        by_site = {plan.site:plan for plan in plans}
        self.assertEqual(by_site['b'].value,(by_site['b'].gain+50)/1)
        self.assertEqual(by_site['c'].value,(by_site['c'].gain+50)/2)
        self.assertEqual(by_site['c'].preference,50)
        costly = self.planner(planning_document(exit=goal()),ScoreRules(score_document(cost='facts.publishedActions * 100')))
        self.assertEqual(self.plans(costly,public_frame([('a','exit')])),[])

    @classmethod
    def setUpClass(cls):
        cls.rules = ScoreRules(score_document())

    def planner(self, document=None, rules=None):
        return PublicPlanner(self.rules if rules is None else rules,
                             planning_document() if document is None else document)

    def plans(self, planner, frame, *, facts=ScoreFacts(), visited=None, handled=(), rated=('walk',),
              personality='helpful_rescuer'):
        return planner.plans(frame, personality, facts,
                             {frame['fields']['locationId']} if visited is None else set(visited),
                             set(handled), set(rated))

    def test_changed_public_graph_changes_route_without_fixed_sequence(self):
        planner = self.planner()
        first = public_frame([('a', 'b'), ('b', 'exit')])
        second = public_frame([('a', 'c'), ('c', 'd'), ('d', 'exit')])
        before = deepcopy(first)
        self.assertEqual(self.plans(planner, first)[0].route, ('a', 'b', 'exit'))
        self.assertEqual(self.plans(planner, second)[0].route, ('a', 'c', 'd', 'exit'))
        self.assertEqual(first, before)

    def test_sorted_bfs_is_directed_and_bounded_on_cycles(self):
        planner = self.planner()
        edges = [('a', 'c'), ('a', 'b'), ('b', 'a'), ('c', 'a'),
                 ('c', 'exit'), ('b', 'exit'), ('exit', 'exit')]
        frame = public_frame(edges)
        route = self.plans(planner, frame)[0].route
        self.assertEqual(route, ('a', 'b', 'exit'))
        self.assertEqual(route, self.plans(planner, public_frame(list(reversed(edges))))[0].route)
        self.assertLessEqual(len(route), len(frame['scene']['knownSites']))
        self.assertEqual(self.plans(planner, public_frame([('exit', 'a')])), [])

    def test_unknown_sites_and_intermediate_nodes_do_not_leak(self):
        planner = self.planner()
        frame = public_frame([('a', 'secret'), ('secret', 'exit')], known=['a', 'exit'])
        self.assertEqual(self.plans(planner, frame), [])
        hidden_target = self.planner(planning_document(secret=goal(selector={'sites': ['secret']})))
        self.assertEqual(self.plans(hidden_target, frame), [])

    def test_only_rated_supported_current_offers_add_edges(self):
        planner = self.planner()
        frame = public_frame(offers=[{'entry': 'walk', 'destination': 'exit'}])
        self.assertEqual(self.plans(planner, frame)[0].route, ('a', 'exit'))
        self.assertEqual(self.plans(planner, frame, rated=()), [])
        for entry, kind in [('manual_flight', 'flight'), ('carry', 'carry')]:
            with self.subTest(kind=kind):
                frame = public_frame(offers=[{'entry': entry, 'destination': 'exit',
                                              'movementKind': kind}])
                self.assertEqual(self.plans(planner, frame), [])
                self.assertEqual(self.plans(planner, frame, rated=(entry,)), [])

    def test_scene_route_kind_allowlist(self):
        planner = self.planner()
        for kind in ('path', 'ice', 'bridge', 'door'):
            frame = public_frame([('a', 'exit')])
            frame['scene']['routes'][0]['kind'] = kind
            self.assertEqual(self.plans(planner, frame)[0].route, ('a', 'exit'))
        for kind in ('flight', 'carry', 'climb', 'transport', 'unknown', None):
            frame = public_frame([('a', 'exit')])
            frame['scene']['routes'][0]['kind'] = kind
            self.assertEqual(self.plans(planner, frame), [])

    def test_terminal_hops_and_action_cost_are_included(self):
        planner = self.planner()
        plan = self.plans(planner, public_frame([('a', 'b'), ('b', 'exit')]))[0]
        self.assertEqual((plan.estimated_actions, plan.gain, plan.value), (3, 54, 18.0))
        here = self.plans(planner, public_frame(origin='exit'))[0]
        self.assertEqual((here.route, here.estimated_actions, here.gain), (('exit',), 1, 58))

    def test_frontier_has_no_terminal_and_never_rewards_current_origin(self):
        planner = self.planner(planning_document(explore=goal(selector={'frontier': {'exclude_sites': []}},
            gains={'visitedPlaces': 1}, label='Explore', feature='explore')))
        frame = public_frame([('a', 'b'), ('b', 'c')])
        plans = self.plans(planner, frame, visited=())
        self.assertEqual([plan.site for plan in plans], ['b', 'c'])
        self.assertEqual((plans[1].estimated_actions, plans[1].gain), (2, 6))
        self.assertEqual(self.plans(planner, frame, visited=('a', 'b', 'c')), [])
        self.assertEqual(self.plans(planner, public_frame(), visited=()), [])
        already_here = self.planner(planning_document(visit=goal(selector={'sites': ['a']},
                                                               gains={'visitedPlaces': 1})))
        self.assertEqual(self.plans(already_here, public_frame(), visited=()), [])

    def test_compiled_score_edit_changes_order_and_personality_matters(self):
        document = planning_document(
            help=goal(selector={'sites': ['b']}, gains={'peopleThawed': 1, 'knownChargeSpent': 1},
                      label='Help', feature='help'),
            exit=goal(selector={'sites': ['c']}))
        frame = public_frame([('a', 'b'), ('a', 'c')])
        rules = ScoreRules(score_document('facts.peopleThawed * 100 + facts.departed * 10',
                                         cost='facts.publishedActions * 2 + facts.knownChargeSpent * 3'))
        edited = ScoreRules(score_document('facts.peopleThawed * 10 + facts.departed * 100',
                                          helpful='facts.peopleThawed * 200',
                                          cost='facts.publishedActions * 2 + facts.knownChargeSpent * 3'))
        first = self.plans(self.planner(document, rules), frame)
        self.assertEqual((first[0].goal, first[0].gain), ('Help', 93))
        planner = self.planner(document, edited)
        self.assertEqual(self.plans(planner, frame, personality='decisive_explorer')[0].goal, 'Exit')
        self.assertEqual(self.plans(planner, frame)[0].goal, 'Help')

    def test_unknown_frontier_may_cost_points_but_does_not_pretend_positive_gain(self):
        planner = self.planner(planning_document(explore=goal(selector={'frontier': {'exclude_sites': []}},
            gains={'visitedPlaces': 1}, feature='explore')), ScoreRules(score_document(cost='facts.publishedActions * 20')))
        plans = self.plans(planner, public_frame([('a', 'b'), ('b', 'c')]))
        self.assertEqual((plans[0].site, plans[0].gain, plans[0].value), ('b', -10, -10))

    def test_gain_is_relative_to_current_facts_not_zero(self):
        rules = ScoreRules(score_document('facts.peopleThawed * facts.peopleThawed'))
        planner = self.planner(planning_document(help=goal(selector={'sites': ['b']},
            gains={'peopleThawed': 1}, label='Help', feature='help')), rules)
        facts = ScoreFacts(peopleThawed=3, publishedActions=20)
        plan = self.plans(planner, public_frame([('a', 'b')]), facts=facts)[0]
        self.assertEqual((plan.estimated_actions, plan.gain), (2, 3))
        self.assertEqual(facts, ScoreFacts(peopleThawed=3, publishedActions=20))

    def test_frontier_exclusions_filter_goals_not_transit_or_visibility(self):
        row = goal(selector={'frontier': {'exclude_sites': ['gate', 'exit', 'hidden']}},
                   gains={'visitedPlaces': 1}, feature='explore')
        planner = self.planner(planning_document(explore=row))
        frame = public_frame([('a', 'gate'), ('gate', 'lair'), ('gate', 'exit')])
        before = deepcopy(frame)
        plans = self.plans(planner, frame)
        self.assertEqual([plan.site for plan in plans], ['lair'])
        self.assertEqual(plans[0].route, ('a', 'gate', 'lair'))
        self.assertEqual(self.plans(planner, frame, visited={'a', 'lair'}), [])
        self.assertEqual(frame, before)

    def test_goal_preferences_change_ranking_without_manufacturing_score_gain(self):
        exploration = goal(selector={'frontier': {'exclude_sites': ['exit']}},
                           gains={'visitedPlaces': 1}, feature='explore', label='Investigate')
        exploration['preferences']['cautious_investigator'] = 50
        document = planning_document(explore=exploration, exit=goal())
        planner = self.planner(document)
        frame = public_frame([('a', 'lair'), ('a', 'exit')])
        self.assertEqual(self.plans(planner, frame, personality='cautious_investigator')[0].site, 'lair')
        self.assertEqual(self.plans(planner, frame, personality='helpful_rescuer')[0].site, 'exit')
        cautious = self.plans(planner, frame, personality='cautious_investigator')[0]
        neutral = next(plan for plan in self.plans(planner, frame) if plan.site == 'lair')
        self.assertEqual((cautious.gain, neutral.gain), (8, 8))
        self.assertEqual((cautious.preference, neutral.preference), (50, 0))
        self.assertEqual(self.rules.evaluate(ScoreFacts())['cautious_investigator'], 0)

    def test_public_visit_budget_releases_exit_without_forbidding_manual_exploration(self):
        exploration = goal(selector={'frontier': {'exclude_sites': ['exit']}},
                           gains={'visitedPlaces': 1}, feature='explore', label='Investigate',
                           when='progress.visitedPlaces < 8')
        exploration['preferences']['cautious_investigator'] = 50
        planner = self.planner(planning_document(explore=exploration, exit=goal()))
        frame = public_frame([('a', 'lair'), ('a', 'exit')])
        self.assertEqual(self.plans(planner, frame, personality='cautious_investigator',
                                   facts=ScoreFacts(visitedPlaces=7))[0].site, 'lair')
        before = deepcopy(frame)
        self.assertEqual(self.plans(planner, frame, personality='cautious_investigator',
                                   facts=ScoreFacts(visitedPlaces=8))[0].site, 'exit')
        self.assertEqual(frame, before)

    def test_public_ritual_knowledge_and_bool_when(self):
        document = planning_document(interrupt=goal(gains={'ritualDisrupted': 1},
            when='progress.ritualDisrupted == 0 and knowledge.ritual_active'))
        planner = self.planner(document)
        for phase in ('preparing', 'gathering', 'critical'):
            self.assertTrue(self.plans(planner, public_frame([('a', 'exit')], phase=phase)))
        for phase in ('unknown', 'disrupted', 'completed', 'erupted', None):
            frame = public_frame([('a', 'exit')], phase=phase)
            frame['fields']['ritualSigns'] = 'critical'
            self.assertEqual(self.plans(planner, frame), [])
        document['goals']['interrupt']['when'] = False
        self.assertEqual(self.plans(self.planner(document), public_frame([('a', 'exit')])), [])
        document['goals']['interrupt']['when'] = 'knowledge.ritual_disrupted'
        document['goals']['interrupt']['gains'] = {'peopleThawed': 1}
        self.assertTrue(self.plans(self.planner(document),
                                  public_frame([('a', 'exit')], phase='disrupted')))

    def test_binary_achievements_cannot_be_predicted_twice(self):
        planner = self.planner(planning_document(binary=goal(gains={'departed': 3, 'ritualDisrupted': 2})))
        frame = public_frame([('a', 'exit')])
        self.assertEqual(self.plans(planner, frame)[0].gain, 136)
        self.assertEqual(self.plans(planner, frame, facts=ScoreFacts(departed=1, ritualDisrupted=1)), [])
        self.assertEqual(self.plans(planner, frame, facts=ScoreFacts(departed=1))[0].gain, 76)
        frame['information']['ritual']['phase'] = 'disrupted'
        self.assertEqual(self.plans(planner, frame)[0].gain, 56)

    def test_observation_goals_use_public_memory_and_skip_handled_targets(self):
        planner = self.planner(planning_document(help=goal(
            selector={'observation': {'kind': 'person', 'state': 'frozen'}},
            gains={'peopleThawed': 1, 'knownChargeSpent': 1}, label='Help', feature='help')))
        observations = [{'id': 'seen-1', 'kind': 'person', 'state': 'frozen', 'site': 'b'},
                        {'id': 'seen-2', 'kind': 'person', 'state': 'mobile', 'site': 'c'},
                        {'id': 'seen-3', 'kind': 'floor', 'state': 'frozen', 'site': 'c'}]
        frame = public_frame([('a', 'b'), ('a', 'c')], observations=observations)
        self.assertEqual([plan.site for plan in self.plans(planner, frame)], ['b'])
        self.assertEqual(self.plans(planner, frame, handled=('seen-1',)), [])
        frame['observations'].append({'id': 'seen-4', 'kind': 'person', 'state': 'frozen', 'site': 'b'})
        self.assertEqual([plan.site for plan in self.plans(planner, frame, handled=('seen-1',))], ['b'])

    def test_observation_site_is_public_even_without_known_sites_entry(self):
        planner = self.planner(planning_document(help=goal(
            selector={'observation': {'kind': 'person', 'state': 'frozen'}},
            gains={'peopleThawed': 1}, feature='help')))
        frame = public_frame([('a', 'b')], known=['a'], observations=[
            {'id': 'seen-1', 'kind': 'person', 'state': 'frozen', 'site': 'b'}])
        self.assertEqual(self.plans(planner, frame)[0].route, ('a', 'b'))

    def test_extra_private_fields_are_never_read_or_copied(self):
        class PrivateState:
            def __getattr__(self, name):
                raise AssertionError('Private state was read')

            def __deepcopy__(self, memo):
                raise AssertionError('A world snapshot was copied')

        planner = self.planner()
        frame = public_frame([('a', 'exit')])
        expected = self.plans(planner, frame)
        private = PrivateState()
        frame.update(owner_snapshot=private, session=private)
        frame['scene'].update(owners=private, private_routes=private, departure=private)
        frame['fields'].update(hidden_rescues=private, ritual_status=private)
        frame['information']['private_phase'] = private
        self.assertEqual(self.plans(planner, frame), expected)

    def test_no_route_nonpositive_gain_and_actual_ending_return_no_plans(self):
        planner = self.planner()
        self.assertEqual(self.plans(planner, public_frame(known=['a', 'exit'])), [])
        costly = ScoreRules(score_document(cost='facts.publishedActions * 100'))
        self.assertEqual(self.plans(self.planner(rules=costly), public_frame([('a', 'exit')])), [])
        frame = public_frame([('a', 'exit')])
        frame['ending'] = {'id': 'departed_palace'}
        self.assertEqual(self.plans(planner, frame), [])
        with self.assertRaises(ValueError):
            self.plans(planner, public_frame(), personality='unregistered')

    def test_config_validation_and_forbidden_when_ports(self):
        invalid = [
            {'when': 1}, {'when': None}, {'when': ''}, {'when': {'ref': 'progress.departed'}},
            {'when': 'progress.departed'}, {'when': 'scene.ritual.status == "active"'},
            {'when': 'knowledge.hidden'}, {'when': 'progress.private'}, {'when': 'occurrence'},
            {'when': 'not progress.ritualDisrupted'},
            {'gains': {'publishedActions': 1}}, {'gains': {'peopleThawed': -1}},
            {'gains': {'peopleThawed': True}}, {'gains': {'peopleThawed': 1.0}},
            {'gains': {'hiddenRescues': 1}}, {'gains': []}, {'feature': ''}, {'label': ''},
            {'selector': {}}, {'selector': {'sites': ['exit'], 'frontier': True}},
            {'selector': {'frontier': 1}}, {'selector': {'frontier': False}},
            {'selector': {'frontier': True}}, {'selector': {'frontier': {}}},
            {'selector': {'frontier': {'exclude_sites': ['exit', 'exit']}}},
            {'selector': {'frontier': {'exclude_sites': [1]}}},
            {'preferences': {}}, {'preferences': dict.fromkeys(DIMENSIONS, True)},
            {'preferences': dict.fromkeys(DIMENSIONS, 1001)},
            {'selector': {'sites': []}}, {'selector': {'sites': ['exit', 'exit']}},
            {'selector': {'sites': 'exit'}}, {'selector': {'sites': [1]}},
            {'selector': {'observation': {'kind': 'person', 'state': 'mobile'}}},
            {'selector': {'observation': {'kind': 'person', 'state': 'frozen', 'owner': 'secret'}}},
        ]
        for change in invalid:
            with self.subTest(change=change):
                document = planning_document()
                document['goals']['exit'].update(change)
                with self.assertRaises(ValueError):
                    self.planner(document)
        for change in ({'schema': 'other'}, {'goals': []}, {'extra': True}):
            document = planning_document()
            document.update(change)
            with self.assertRaises(ValueError):
                self.planner(document)

    def test_deterministic_plan_sort_and_selected_plan_snapshot(self):
        planner = self.planner(planning_document(
            z=goal(selector={'sites': ['c', 'b']}, label='Z'),
            a=goal(selector={'sites': ['c', 'b']}, label='A')))
        frame = public_frame([('a', 'c'), ('a', 'b')])
        plans = self.plans(planner, frame)
        self.assertEqual([(plan.site, plan.goal) for plan in plans],
                         [('b', 'A'), ('b', 'Z'), ('c', 'A'), ('c', 'Z')])
        selected = plans[2]
        snapshot = selected.snapshot(frame)
        self.assertEqual(snapshot, {'goal': 'A', 'targetSite': 'c',
            'route': [{'site': 'a', 'label': 'A'}, {'site': 'c', 'label': 'C'}],
            'estimatedActions': 2, 'estimatedGain': 56, 'value': 28.0, 'preference': 0,
            'uncertainty': '已知通路的收益估计；下一步仍需实际结算'})
        snapshot['route'][0]['site'] = 'changed'
        self.assertEqual(selected.route, ('a', 'c'))
        with self.assertRaises(FrozenInstanceError):
            selected.site = 'elsewhere'
        self.assertEqual(set(Plan.__dataclass_fields__),
                         {'goal', 'site', 'route', 'estimated_actions', 'gain', 'value', 'feature', 'preference'})
        self.assertEqual(replace(selected, route=('a', 'missing')).snapshot(frame)['route'][-1]['label'],
                         'missing')

    def test_fixture_digest_is_canonical_and_tracks_config_edits(self):
        document = planning_document()
        expected = hashlib.sha256(json.dumps(document, sort_keys=True,
                                             separators=(',', ':')).encode('utf-8')).hexdigest()
        planner = self.planner(document)
        self.assertEqual(planner.digest, expected)
        reordered = dict(reversed(list(document.items())))
        reordered['goals'] = {'exit': dict(reversed(list(document['goals']['exit'].items())))}
        self.assertEqual(self.planner(reordered).digest, planner.digest)
        document['goals']['exit']['gains']['departed'] = 0
        self.assertNotEqual(self.planner(document).digest, planner.digest)
        self.assertEqual(planner.goals['exit']['gains'], {'departed': 1})

    def test_default_document_uses_author_parser_digest_without_assets(self):
        from nomos_c0.author_document_v1 import parse_author_document
        from pathlib import Path
        import server.public_planner as planner_module
        source = json.dumps(planning_document())
        path = Path(planner_module.__file__).parent / 'policies/m1_public_goals_v1.yaml'
        parsed = parse_author_document(source, file=str(path), format='yaml')
        with patch('pathlib.Path.read_text', return_value=source) as read:
            planner = PublicPlanner(self.rules)
        read.assert_called_once_with(encoding='utf-8')
        self.assertEqual(planner.digest, parsed.digest)


if __name__ == '__main__':
    unittest.main()
