"""Delegation settings and public replanning, independent of a long world witness."""
import copy
from types import SimpleNamespace
import unittest

from .m1_policy import M1Policy
from .bridge import ApiError
from .play_report import ScoreFacts
from .test_policy_execution import frame
from . import test_policy_execution as execution_tests


class ReplanningTests(unittest.TestCase):
    def test_ambiguous_primary_route_does_not_remove_identifiable_alternative(self):
        current, policy = frame(), M1Policy()
        current['scene']['knownSites'] = ['a', 'ritual_passage_entry', 'side_room']
        current['scene']['routes'] = [dict(start='a', end=site, kind='path') for site in ('ritual_passage_entry', 'side_room')]
        primary = dict(index=17, entry='move_adventurer', label='Walk', destination='ritual_passage_entry', movementKind='walk')
        current['offers'] = [primary, dict(primary, index=18, entry='move_wall_adventurer'),
                             dict(index=19, entry='move_adventurer', label='Side', destination='side_room', movementKind='walk')]
        policy.start(current, 'decisive_explorer')
        self.assertEqual(policy.select(current).candidate.index, 19)

    def test_cautious_checks_offered_floor_before_ice_route_and_does_not_repeat_same_check(self):
        current, policy = frame(), M1Policy()
        current['scene']['knownSites'] = ['a', 'ritual_passage_entry']
        current['offers'] = [dict(index=17, entry='cross_ice_adventurer', label='Slide', destination='ritual_passage_entry', movementKind='ice'),
                             dict(index=42, entry='observe_floor_adventurer', label='Floor')]
        before = copy.deepcopy(current)
        policy.start(current, 'cautious_investigator')
        selected = policy.select(current)
        self.assertEqual(selected.candidate.index, 42)
        self.assertIn('先核对脚下冰面', selected.reason)
        self.assertEqual(current, before)
        after = copy.deepcopy(current)
        after['feedback'] = {'status': 'published'}
        policy.record(selected, current, after, 0, 1)
        next_choice = policy.select(after)
        self.assertTrue(next_choice is None or next_choice.candidate.index != 42)

    def test_decisive_route_stays_with_the_current_goal_instead_of_a_secondary_frontier(self):
        current, policy = frame(), M1Policy()
        current['information']['ritual']['phase'] = 'disrupted'
        current['scene']['knownSites'] = ['a', 'palace_exit', 'side_room']
        current['scene']['routes'] = [dict(start='a', end=site, kind='path') for site in ('palace_exit', 'side_room')]
        current['offers'] = [dict(index=1, entry='move_adventurer', label='Exit', destination='palace_exit', movementKind='walk'),
                             dict(index=2, entry='move_adventurer', label='Side', destination='side_room', movementKind='walk')]
        policy.places.update(('a', 'palace_exit'))
        policy.facts = ScoreFacts(visitedPlaces=7, ritualDisrupted=1)
        snapshot = copy.deepcopy(current)
        policy.start(current, 'decisive_explorer')
        self.assertEqual(policy.select(current).candidate.index, 1)
        self.assertEqual(current, snapshot)

    def test_rescuer_checks_ground_routes_before_optional_climbs_when_no_route_is_known(self):
        current, policy = frame(), M1Policy()
        current['information']['ritual']['phase'] = 'disrupted'
        current['scene']['knownSites'] = ['a']
        current['scene']['routes'] = []
        current['offers'] = [dict(index=1, entry='observe_climbs_adventurer', label='Climb'),
                             dict(index=2, entry='observe_routes_adventurer', label='Routes')]
        policy.start(current, 'helpful_rescuer')
        self.assertEqual(policy.select(current).candidate.index, 2)
        self.assertIsNone(policy.run.plan)
        current['offers'] = current['offers'][:1]
        fresh = M1Policy()
        fresh.start(current, 'helpful_rescuer')
        self.assertEqual(fresh.select(current).candidate.index, 1)

    def test_rescuer_helps_known_visible_person_before_incidental_checks_or_floor_spending(self):
        current, policy = frame(), M1Policy()
        current['observations'] = [dict(id='p', kind='person', site='a', state='frozen', detailRecordedAt=1),
                                   dict(id='floor', kind='floor', site='a', state='frozen', detailRecordedAt=1)]
        current['information'].update(visibility='provided', visibleEntities=[dict(id='p', kind='person', site='a')])
        current['offers'] = [dict(index=1, entry='thaw_person_adventurer', label='Thaw', targetIds=['p']),
                             dict(index=2, entry='thaw_floor_adventurer', label='Clear', targetIds=['floor']),
                             dict(index=3, entry='observe_climbs_adventurer', label='Climb'),
                             dict(index=4, entry='observe_foxes_adventurer', label='Fox')]
        before = copy.deepcopy(current)
        policy.start(current, 'helpful_rescuer')
        self.assertEqual(policy.select(current).candidate.index, 1)
        self.assertEqual(current, before)
        current['offers'] = current['offers'][1:]
        fresh = M1Policy()
        fresh.start(current, 'helpful_rescuer')
        self.assertIsNotNone(fresh.select(current))

    def test_exit_frontier_includes_known_bridge_hall_without_inventing_it(self):
        current, policy = frame(), M1Policy()
        current['information']['ritual']['phase'] = 'disrupted'
        current['scene']['knownSites'] = ['a', 'halls_bridge_door']
        current['scene']['routes'] = [dict(start='a', end='halls_bridge_door', kind='path')]
        current['offers'] = [dict(index=1, entry='move_adventurer', label='Walk', destination='halls_bridge_door', movementKind='walk'),
                             dict(index=2, entry='observe_climbs_adventurer', label='Climb'),
                             dict(index=3, entry='observe_foxes_adventurer', label='Fox')]
        policy.start(current, 'helpful_rescuer')
        self.assertEqual(policy.select(current).candidate.index, 1)
        self.assertEqual(policy.run.plan['targetSite'], 'halls_bridge_door')
        current['scene']['knownSites'] = ['a']
        current['scene']['routes'] = []
        current['offers'] = current['offers'][1:]
        fresh = M1Policy()
        fresh.start(current, 'helpful_rescuer')
        self.assertIsNotNone(fresh.select(current))
        self.assertIsNone(fresh.run.plan)

    def test_exit_frontier_uses_the_authored_front_hall_identity(self):
        current, policy = frame(), M1Policy()
        current['information']['ritual']['phase'] = 'disrupted'
        current['scene']['knownSites'] = ['a', 'halls_ballroom_door']
        current['scene']['routes'] = [dict(start='a', end='halls_ballroom_door', kind='path')]
        current['offers'] = [dict(index=1, entry='move_adventurer', label='Walk', destination='halls_ballroom_door', movementKind='walk')]
        policy.start(current, 'helpful_rescuer')
        self.assertEqual(policy.select(current).candidate.index, 1)
        self.assertEqual(policy.run.plan['targetSite'], 'halls_ballroom_door')

    def test_interrupted_ritual_opens_known_exit_frontier_before_five_places(self):
        current, policy = frame(), M1Policy()
        current['scene']['knownSites'] = ['a', 'bridge_palace_landing']
        current['scene']['routes'] = [dict(start='a', end='bridge_palace_landing', kind='path')]
        policy.facts = ScoreFacts(visitedPlaces=2)
        self.assertFalse(any(row.site == 'bridge_palace_landing' for row in policy.plans(current, 'decisive_explorer')))
        current['information']['ritual']['phase'] = 'disrupted'
        self.assertTrue(any(row.site == 'bridge_palace_landing' for row in policy.plans(current, 'decisive_explorer')))
        current['scene']['knownSites'] = ['a']
        current['scene']['routes'] = []
        self.assertFalse(any(row.site == 'bridge_palace_landing' for row in policy.plans(current, 'decisive_explorer')))

    def test_record_keeps_actual_sites_not_candidate_destination(self):
        current, policy = frame(), M1Policy()
        current['offers'] = current['offers'][:1]
        policy.start(current, 'decisive_explorer')
        selected = policy.select(current)
        after = copy.deepcopy(current)
        after['fields']['locationId'] = 'c'
        after['time'] = 100
        after['feedback'] = {'status': 'published', 'result': {'landing': 'c'}}
        policy.record(selected, current, after, 0, 1)
        self.assertEqual(policy.run.steps[0]['beforeSite'], 'a')
        self.assertEqual(policy.run.steps[0]['afterSite'], 'c')
        self.assertEqual(selected.candidate.key[2], 'b')

    def test_help_plan_does_not_attach_to_unrelated_unknown_person(self):
        current, policy = frame(), M1Policy()
        current['observations'] = [dict(id='p', kind='person', site='a', state='frozen'),
                                   dict(id='q', kind='person', site='a', state='unknown')]
        current['information']['visibleEntities'] = [dict(id=target, kind='person', site='a') for target in ('p', 'q')]
        current['offers'] = [dict(index=1, entry='observe_resident_adventurer', label='Inspect Q', targetIds=['q']),
                             dict(index=2, entry='thaw_person_adventurer', label='Help Q', targetIds=['q']),
                             dict(index=3, entry='observe_resident_adventurer', label='Inspect P', targetIds=['p']),
                             dict(index=4, entry='thaw_person_adventurer', label='Help P', targetIds=['p'])]
        plan = next(row for row in policy.plans(current, 'helpful_rescuer') if row.feature == 'help')
        candidates = policy._candidates_for_plans(current, 'helpful_rescuer', (), [])
        wrong = next(row for row in candidates if row.index == 1)
        right = next(row for row in candidates if row.index == 3)
        self.assertFalse(policy.supports_plan(current, wrong, plan))
        self.assertTrue(policy.supports_plan(current, right, plan))
        policy.handled_targets.add('p')
        self.assertFalse(policy.supports_plan(current, right, plan))

    def test_available_exit_direction_precedes_incidental_survey_without_removing_manual_offer(self):
        current, policy = frame(), M1Policy()
        current['scene']['knownSites'] = ['a', 'palace_exit']
        current['scene']['routes'] = [dict(start='a', end='palace_exit', kind='path')]
        current['information']['ritual']['phase'] = 'disrupted'
        current['offers'] = [dict(index=7, entry='move_adventurer', label='Walk', destination='palace_exit', movementKind='walk'),
            dict(index=8, entry='observe_foxes_adventurer', label='Fox')]
        policy.facts = ScoreFacts(visitedPlaces=7, ritualDisrupted=1)
        before = copy.deepcopy(current)
        policy.start(current, 'helpful_rescuer')
        selected = policy.select(current)
        self.assertEqual(selected.candidate.index, 7)
        self.assertIn('寻找离宫', selected.reason)
        self.assertNotIn('净收益', selected.reason)
        self.assertNotIn('+1000', selected.reason)
        self.assertEqual(current, before)
        current['offers'] = current['offers'][1:]
        fresh = M1Policy()
        fresh.facts = policy.facts
        fresh.start(current, 'helpful_rescuer')
        self.assertEqual(fresh.select(current).candidate.index, 8)

    def test_urgent_ritual_can_attempt_offered_relief_without_inventing_a_frozen_observation(self):
        current, policy = frame(), M1Policy()
        current['fields']['locationId'] = 'ritual_ring'
        current['scene']['knownSites'] = ['ritual_ring', 'ritual_threshold']
        current['information']['ritual']['phase'] = 'critical'
        current['information']['visibleEntities'] = [dict(id='p', kind='person', site='ritual_ring'), dict(id='enemy', kind='person', site='ritual_ring')]
        current['observations'] = [dict(id='p', kind='person', site='ritual_ring', state='unknown'), dict(id='enemy', kind='person', site='ritual_ring', state='unknown')]
        current['offers'] = [dict(index=1, entry='observe_resident_adventurer', label='Inspect', targetIds=['p']),
            dict(index=2, entry='carry_from_ritual_adventurer', label='Carry', targetIds=['p'], destination='ritual_threshold'),
            dict(index=3, entry='observe_foxes_adventurer', label='Fox'),
            dict(index=4, entry='observe_resident_adventurer', label='Enemy', targetIds=['enemy'])]
        before = copy.deepcopy(current)
        policy.start(current, 'helpful_rescuer')
        self.assertEqual(policy.select(current).candidate.index, 2)
        self.assertEqual(current, before)
        current['observations'][0].update(state='frozen', detailRecordedAt=1)
        self.assertEqual(policy.select(current).candidate.index, 2)
        current['information']['ritual']['phase'] = 'disrupted'
        self.assertFalse(policy.select(current).candidate.expectations['interruption'])

    def test_urgent_unresolved_opportunity_hands_back_without_a_fox_detour(self):
        current, policy = frame(), M1Policy()
        current['fields']['locationId'] = 'ritual_ring'
        current['scene']['knownSites'] = ['ritual_ring']
        current['information']['ritual']['phase'] = 'critical'
        current['offers'] = [dict(index=3, entry='observe_foxes_adventurer', label='Fox')]
        policy.start(current, 'helpful_rescuer')
        self.assertIsNone(policy.select(current))
        self.assertEqual(policy.run.stop_detail['code'], 'manual_decision')
        self.assertIn('仪式接近完成', policy.run.reason)
        current['information']['visibleEntities'] = [dict(id='p', kind='person', site='ritual_ring')]
        current['observations'] = [dict(id='p', kind='person', site='ritual_ring', state='unknown')]
        current['offers'].extend([dict(index=1, entry='observe_resident_adventurer', label='Inspect', targetIds=['p']),
            dict(index=2, entry='carry_from_ritual_adventurer', label='Carry', targetIds=['p'], destination='ritual_threshold')])
        policy.start(current, 'helpful_rescuer')
        self.assertEqual(policy.select(current).candidate.index, 2)
        self.assertNotIn(('ritual_ring', 'interrupt'), policy.unsupported_goals)

    def test_public_ritual_direction_beats_curiosity_without_revealing_unknown_route(self):
        current, policy = frame(), M1Policy()
        current['scene']['knownSites'] = ['a', 'ritual_passage_entry']
        current['scene']['routes'] = [dict(start='a', end='ritual_passage_entry', kind='path')]
        current['offers'] = [dict(index=17, entry='move_adventurer', label='Walk', destination='ritual_passage_entry', movementKind='walk'), dict(index=18, entry='observe_foxes_adventurer', label='Fox')]
        policy.start(current, 'helpful_rescuer')
        self.assertEqual(policy.select(current).candidate.index, 17)
        self.assertEqual(policy.run.plan['targetSite'], 'ritual_passage_entry')
        self.assertNotIn('ritual_ring', policy.planning_frame(current)['scene']['knownSites'])
        current['scene']['routes'] = []
        current['scene']['knownSites'] = ['a']
        current['offers'] = current['offers'][1:]
        fresh = M1Policy()
        fresh.start(current, 'helpful_rescuer')
        self.assertEqual(fresh.select(current).candidate.index, 18)
        self.assertIsNone(fresh.run.plan)

    def test_inspection_of_departed_person_is_not_delegated_from_old_memory(self):
        current, policy = frame(), M1Policy()
        current['observations'] = [dict(id='p', kind='person', site='a', state='frozen')]
        current['information'].update(visibility='provided', visibleEntities=[], nearbyEntities=[])
        current['offers'] = [dict(index=1, entry='observe_resident_adventurer', label='Inspect', targetIds=['p'])]
        self.assertEqual(policy.candidates(current, 'helpful_rescuer'), [])
        self.assertEqual(len(current['offers']), 1)
        current['information']['nearbyEntities'] = [dict(id='p', kind='person', site='b')]
        self.assertEqual(policy.candidates(current, 'helpful_rescuer')[0].index, 1)

    def test_decisive_known_goal_route_precedes_an_incidental_survey(self):
        current, policy = frame(), M1Policy()
        current['scene']['knownSites'] = ['a', 'b', 'ritual_ring']
        current['scene']['routes'] = [dict(start='a', end='b', kind='path'), dict(start='b', end='ritual_ring', kind='path')]
        current['information']['ritual']['phase'] = 'gathering'
        current['offers'] = [current['offers'][0], dict(index=88, entry='observe_hall_adventurer', label='Survey')]
        policy.places.update(('a', 'b'))
        policy.visited.add(policy.key(current, current['offers'][0]))
        before = copy.deepcopy(current)
        policy.start(current, 'decisive_explorer')
        self.assertEqual(policy.select(current).candidate.index, 71)
        self.assertEqual(current, before)
        self.assertEqual(policy.run.plan['targetSite'], 'ritual_ring')

    def test_exit_search_does_not_take_over_while_finite_exploration_is_active(self):
        current, policy = frame(), M1Policy()
        current['scene']['knownSites'] = ['a','b','lair','bridge_palace_landing']
        current['scene']['routes'] = [dict(start='a',end='b',kind='path'),
            dict(start='b',end='lair',kind='path'),dict(start='a',end='bridge_palace_landing',kind='path')]
        current['offers'] = [dict(index=1,entry='move_adventurer',label='Return',destination='b',movementKind='walk'),
            dict(index=2,entry='move_adventurer',label='Bridge',destination='bridge_palace_landing',movementKind='walk')]
        policy.places.update(('a','b'))
        policy.visited.add(policy.key(current,current['offers'][0]))
        policy.facts = ScoreFacts(visitedPlaces=2)
        policy.start(current,'cautious_investigator')
        self.assertEqual(policy.select(current).candidate.index,1)
        self.assertEqual(policy.run.plan['targetSite'],'lair')
        self.assertFalse(any(plan.site=='bridge_palace_landing' for plan in policy.plans(current,'cautious_investigator')))

    def test_exploration_budget_still_allows_return_toward_known_bridge_before_exit_is_known(self):
        current, policy = frame(), M1Policy()
        current['scene']['knownSites'] = ['a','b','bridge_palace_landing']
        current['scene']['routes'] = [dict(start='a',end='b',kind='path'),
                                     dict(start='b',end='bridge_palace_landing',kind='path')]
        current['offers'] = current['offers'][:1]
        policy.places.update(('a','b'))
        policy.visited.add(policy.key(current,current['offers'][0]))
        policy.facts = ScoreFacts(visitedPlaces=5)
        policy.start(current,'cautious_investigator')
        self.assertEqual(policy.select(current).candidate.index,71)
        self.assertEqual(policy.run.plan['targetSite'],'bridge_palace_landing')
        self.assertNotIn('palace_exit',current['scene']['knownSites'])

    def test_three_dimensional_merits_do_not_depend_on_delegation_reserve_or_goal_memory(self):
        current, policy = frame(), M1Policy()
        current['fields']['everflameCharges'] = 2
        current['scene']['knownSites'].extend(('c','d','palace_exit'))
        current['scene']['routes'] = [dict(start='a',end='b',kind='path'),dict(start='b',end='c',kind='path'),
            dict(start='c',end='d',kind='path'),dict(start='d',end='palace_exit',kind='path')]
        current['observations'] = [dict(id='p',kind='person',site='a',state='frozen')]
        current['offers'] = [current['offers'][0],dict(index=2,entry='thaw_person_adventurer',label='Thaw',targetIds=['p'])]
        policy.places.update(('a','b'))
        policy.visited.add(policy.key(current,current['offers'][0]))
        policy.facts = ScoreFacts(visitedPlaces=5)
        manual = policy.action_merits(current,71)
        for stop in (True,False):
            policy.start(current,'cautious_investigator',stop_on_unexpected=stop)
            policy.unsupported_goals.add(('a','help'))
            before = policy.unsupported_goals.copy()
            self.assertEqual(policy.action_merits(current,71),manual)
            self.assertEqual(policy.unsupported_goals,before)
            policy.halt(current,'cancelled','Stop')
        self.assertTrue(any(manual[1].values()))

    def test_resource_reserved_help_does_not_block_a_returning_exit_route(self):
        current, policy = frame(), M1Policy()
        current['fields']['everflameCharges'] = 2
        current['scene']['knownSites'].extend(('c','d','palace_exit'))
        current['scene']['routes'] = [dict(start='a',end='b',kind='path'),dict(start='b',end='c',kind='path'),
            dict(start='c',end='d',kind='path'),dict(start='d',end='palace_exit',kind='path')]
        current['observations'] = [dict(id='p',kind='person',site='a',state='frozen')]
        current['offers'] = [current['offers'][0],dict(index=2,entry='thaw_person_adventurer',label='Thaw',targetIds=['p'])]
        policy.places.update(('a','b'))
        policy.visited.add(policy.key(current,current['offers'][0]))
        policy.facts = ScoreFacts(visitedPlaces=8)
        policy.start(current,'cautious_investigator')
        self.assertEqual(policy.select(current).candidate.index,71)
        self.assertNotIn(('a','help'),policy.unsupported_goals)
        self.assertEqual(current['fields']['everflameCharges'],2)
        current['fields']['everflameCharges'] = 5
        self.assertEqual(policy.select(current).candidate.index,2)

    def test_unsupported_help_at_current_site_does_not_block_known_exit(self):
        current, policy = frame(), M1Policy()
        current['scene']['knownSites'].extend(('c','d','palace_exit'))
        current['scene']['routes'] = [dict(start='a',end='b',kind='path'),
                                     dict(start='b',end='c',kind='path'),
                                     dict(start='c',end='d',kind='path'),
                                     dict(start='d',end='palace_exit',kind='path')]
        current['observations'] = [dict(id='p',kind='person',site='a',state='frozen')]
        current['offers'] = current['offers'][:1]
        policy.places.update(('a','b'))
        policy.visited.add(policy.key(current,current['offers'][0]))
        policy.facts = ScoreFacts(visitedPlaces=8)
        policy.start(current,'cautious_investigator')
        self.assertEqual(policy.plans(current,'cautious_investigator')[0].site,'a')
        self.assertEqual(policy.select(current).candidate.index,71)
        self.assertEqual(policy.run.plan['targetSite'],'palace_exit')
        self.assertEqual(current['observations'][0]['state'],'frozen')
        away = copy.deepcopy(current)
        away['fields']['locationId'] = 'b'
        self.assertFalse(any(plan.site == 'a' and plan.feature == 'help'
                             for plan in policy.plans(away,'cautious_investigator')))
        current['offers'].append(dict(index=2,entry='thaw_person_adventurer',label='Thaw',targetIds=['p']))
        self.assertIn(2,[row.index for row in policy.candidates(current,'cautious_investigator')])
        self.assertTrue(any(plan.site == 'a' and plan.feature == 'help'
                            for plan in policy.plans(current,'cautious_investigator')))

    def test_person_details_do_not_reopen_an_untargeted_presence_survey(self):
        current, policy = frame(), M1Policy()
        current['offers'] = [dict(index=1, entry='observe_hall_adventurer', label='Survey')]
        current['observations'] = [dict(id='p', kind='person', site='a', state='unknown')]
        policy.start(current, 'cautious_investigator')
        selected = policy.select(current)
        after = copy.deepcopy(current)
        after['feedback'] = {'status':'published'}
        policy.record(selected, current, after, 0, 1)
        after['observations'][0].update(state='frozen',facts=['Cold'],detailRecordedAt=2)
        self.assertEqual(policy.candidates(after,'cautious_investigator'), [])
        after['observations'].append(dict(id='q',kind='person',site='a',state='unknown'))
        self.assertEqual(policy.candidates(after,'cautious_investigator')[0].index,1)

    def test_ground_route_discovery_does_not_reopen_climbing_inspection(self):
        current, policy = frame(), M1Policy()
        current['offers'] = [dict(index=1, entry='observe_climbs_adventurer',label='Climbs')]
        policy.start(current,'cautious_investigator')
        selected = policy.select(current)
        after = copy.deepcopy(current)
        after['feedback'] = {'status':'published'}
        policy.record(selected,current,after,0,1)
        after['scene']['routes'].append(dict(start='a',end='new',kind='path'))
        self.assertEqual(policy.candidates(after,'cautious_investigator'), [])
        after['scene']['routes'].append(dict(start='a',end='up',kind='climb'))
        self.assertEqual(policy.candidates(after,'cautious_investigator')[0].index,1)

    def test_seen_detail_surface_oscillation_does_not_repeat_inspection(self):
        current, policy = frame(), M1Policy()
        current['offers'] = [dict(index=1, entry='observe_resident_adventurer',
                                  label='Inspect', targetIds=['p'])]
        current['observations'] = [dict(id='p', kind='person', site='a', state='unknown')]
        policy.start(current, 'cautious_investigator')
        selected = policy.select(current)
        detailed = copy.deepcopy(current)
        detailed['observations'][0].update(state='frozen', detailRecordedAt=1, facts=['Cold'])
        detailed['feedback'] = {'status': 'published'}
        policy.record(selected, current, detailed, 0, 1)
        for old in (current, detailed):
            self.assertEqual(policy.candidates(old, 'cautious_investigator'), [])
        newer = copy.deepcopy(detailed)
        newer['observations'][0]['facts'].append('Has answered')
        self.assertEqual(policy.candidates(newer, 'cautious_investigator')[0].index, 1)

    def test_manual_inspection_remembers_both_contexts_without_hiding_offer(self):
        current, policy = frame(), M1Policy()
        current['offers'] = [dict(index=1, entry='observe_hall_adventurer', label='Look')]
        after = copy.deepcopy(current)
        after['observations'] = [dict(id='p', kind='person', site='a', state='frozen')]
        ledger = SimpleNamespace(facts=ScoreFacts(publishedActions=1), places={'a'})
        policy.observe_episode(after, ledger, current['offers'][0], current, True)
        self.assertEqual(policy.candidates(current, 'cautious_investigator'), [])
        self.assertEqual(len(current['offers']), 1)

    def test_public_critical_ritual_cancels_curiosity_not_manual_branch(self):
        current, policy = frame(), M1Policy()
        current['scene']['knownSites'] = ['a', 'lair', 'palace_exit']
        current['scene']['routes'] = [dict(start='a', end='lair'), dict(start='a', end='palace_exit')]
        current['offers'] = [dict(index=1, entry='move_adventurer', label='Exit',
                                 destination='palace_exit', movementKind='walk'),
                             dict(index=2, entry='move_adventurer', label='Branch',
                                 destination='lair', movementKind='walk')]
        current['information']['ritual']['phase'] = 'critical'
        policy.start(current, 'cautious_investigator')
        self.assertEqual(policy.select(current).candidate.index, 1)
        self.assertEqual(len(current['offers']), 2)
        current['information']['ritual']['phase'] = 'unknown'
        self.assertEqual(policy.select(current).candidate.index, 2)

    def test_cautious_public_branch_precedes_exit_but_not_forever(self):
        current = frame()
        current['scene']['knownSites'] = ['a', 'lair', 'palace_exit']
        current['scene']['routes'] = [dict(start='a', end='lair'), dict(start='a', end='palace_exit')]
        current['offers'] = [dict(index=1, entry='move_adventurer', label='Exit direction',
                                 destination='palace_exit', movementKind='walk'),
                             dict(index=2, entry='move_adventurer', label='Branch',
                                 destination='lair', movementKind='walk')]
        policy = M1Policy()
        policy.start(current, 'cautious_investigator')
        self.assertEqual(policy.select(current).candidate.index, 2)
        self.assertEqual(policy.facts.publishedActions, 0)
        self.assertIn('预计还需', policy.select(current).reason)
        policy.facts = ScoreFacts(visitedPlaces=5)
        self.assertEqual(policy.select(current).candidate.index, 1)

    def test_explicit_null_budget_is_not_permission_for_default_64_steps(self):
        game = execution_tests.ControlTests().game()
        with self.assertRaises(ApiError):
            game.control_policy('start', {'revision': 0, 'policyRevision': 0,
                'requestId': 'invalid-null', 'intentId': 'helpful_rescuer', 'maxActions': None})
        self.assertIsNone(game.policy.run)
        self.assertEqual(game.revision, 0)

    def test_budget_and_unexpected_settings_are_validated_before_authorization(self):
        for limit, stop in ((0, True), (129, True), (True, True), (1.5, True), (10, 'false')):
            policy = M1Policy()
            with self.subTest(limit=limit, stop=stop), self.assertRaises(ValueError):
                policy.start(frame(), 'decisive_explorer', max_actions=limit, stop_on_unexpected=stop)
            self.assertIsNone(policy.run)
        policy = M1Policy()
        policy.start(frame(), 'decisive_explorer', max_actions=7, stop_on_unexpected=False)
        self.assertEqual(policy.snapshot()['limit'], 7)
        self.assertFalse(policy.snapshot()['stopOnUnexpected'])
        policy.run.steps = [{}] * 7
        self.assertIsNone(policy.select(frame()))
        self.assertEqual(policy.snapshot()['stopDetail']['code'], 'safety_limit')

    def test_disabled_unexpected_stop_replans_but_death_always_stops(self):
        before = frame()
        policy = M1Policy()
        policy.start(before, 'cautious_investigator', stop_on_unexpected=False)
        selected = policy.select(before)
        after = copy.deepcopy(before)
        after['fields']['endurance'] -= 1
        after['feedback'] = {'status': 'published'}
        policy.record(selected, before, after, 0, 1)
        self.assertEqual(policy.run.status, 'running')
        selected = policy.select(after)
        dead = copy.deepcopy(after)
        dead['fields']['life'] = 'dead'
        dead['fields']['lifeState'] = 'dead'
        policy.record(selected, after, dead, 1, 2)
        self.assertEqual(policy.run.status, 'stopped')
        self.assertEqual(policy.snapshot()['stopDetail']['code'], 'death')

    def test_collision_replans_from_actual_landing_not_intended_target(self):
        before, policy = frame(), M1Policy()
        policy.start(before, 'decisive_explorer', stop_on_unexpected=False)
        selected = policy.select(before)
        after = copy.deepcopy(before)
        after['fields']['locationId'] = 'collision'
        after['offers'] = [dict(index=777, entry='observe_routes_adventurer', label='Look')]
        after['feedback'] = {'status': 'published'}
        policy.record(selected, before, after, 0, 1)
        self.assertEqual(policy.run.status, 'running')
        self.assertEqual(policy.select(after).candidate.index, 777)

    def test_repeat_rejection_does_not_unlock_by_clock_or_observation_stamp(self):
        before, policy = frame(), M1Policy()
        before['offers'] = before['offers'][2:4]
        before['observations'] = [dict(id='person', kind='person', site='a', state='unknown', recordedAt=1)]
        policy.start(before, 'cautious_investigator', stop_on_unexpected=False)
        selected = policy.select(before)
        after = copy.deepcopy(before)
        after['feedback'] = {'status': 'rejected'}
        policy.record(selected, before, after, 0, 0)
        after['time'] += 100
        after['observations'][0]['recordedAt'] = 2
        self.assertNotEqual(policy.select(after).candidate.index, selected.candidate.index)

    def test_old_routes_can_be_reused_toward_known_exit_after_manual_deviation(self):
        current, policy = frame(), M1Policy()
        current['scene']['knownSites'].append('palace_exit')
        current['scene']['routes'] = [dict(start='b', end='palace_exit', kind='path')]
        current['offers'] = current['offers'][:1]
        policy.places.update(('a', 'b'))
        policy.visited.add(policy.key(current, current['offers'][0]))
        policy.start(current, 'helpful_rescuer')
        choice = policy.select(current)
        self.assertEqual(choice.candidate.index, 71)
        self.assertEqual(policy.snapshot(current)['plan']['targetSite'], 'palace_exit')
        self.assertIn('b', [row['site'] for row in policy.snapshot(current)['plan']['route']])

    def test_manual_memory_survives_switch_but_new_game_is_clean(self):
        current, policy = frame(), M1Policy()
        offer = current['offers'][2]
        ledger = SimpleNamespace(facts=ScoreFacts(publishedActions=1), places={'a'})
        policy.observe_episode(current, ledger, offer, current, True)
        for name in ('cautious_investigator', 'helpful_rescuer'):
            policy.start(current, name)
            self.assertFalse(any(row.index == offer['index'] for row in policy.candidates(current, name)))
            policy.halt(current, 'cancelled', 'Stop')
        self.assertTrue(any(row.index == offer['index'] for row in M1Policy().candidates(current, 'cautious_investigator')))

    def test_old_public_offer_directions_survive_manual_move_to_dead_end(self):
        opening, policy = frame(), M1Policy()
        ledger = SimpleNamespace(facts=ScoreFacts(), places={'a'})
        policy.observe_episode(opening, ledger)
        current = copy.deepcopy(opening)
        current['fields']['locationId'] = 'b'
        current['scene'] = {'knownSites': ['a', 'b'], 'siteLabels': {'a': 'A', 'b': 'B'}, 'routes': []}
        current['offers'] = [dict(index=800, entry='move_adventurer', label='Return',
                                  destination='a', movementKind='walk')]
        ledger.facts = ScoreFacts(publishedActions=1, visitedPlaces=1)
        ledger.places.add('b')
        policy.observe_episode(current, ledger, opening['offers'][0], opening, True)
        policy.start(current, 'helpful_rescuer')
        self.assertEqual(policy.select(current).candidate.index, 800)
        self.assertEqual(policy.snapshot()['plan']['targetSite'], 'c')
        self.assertEqual([row['site'] for row in policy.snapshot()['plan']['route']], ['b', 'a', 'c'])
        self.assertFalse(policy.candidates(current, 'helpful_rescuer')[0].features.get('explore'))

    def test_completed_ritual_notice_is_not_a_repeated_unexpected_stop(self):
        current, policy = frame(), M1Policy()
        current['information']['ritual']['phase'] = 'completed'
        policy.start(current, 'cautious_investigator')
        candidate = policy.select(current).candidate
        self.assertIsNone(policy.stop_reason(candidate, current, copy.deepcopy(current)))

    def test_nearby_frontier_is_not_abandoned_for_return_toward_distant_frontier(self):
        current, policy = frame(), M1Policy()
        current['scene']['knownSites'].append('d')
        current['scene']['routes'] = [dict(start='a', end='b', kind='path'),
            dict(start='b', end='d', kind='path'), dict(start='a', end='c', kind='path')]
        policy.places.update(('a', 'b'))
        policy.visited.add(policy.key(current, current['offers'][0]))
        current['offers'] = current['offers'][:2]
        policy.start(current, 'helpful_rescuer')
        selected = policy.select(current)
        self.assertEqual(selected.candidate.index, 13)
        self.assertEqual(policy.snapshot()['plan']['targetSite'], 'c')

    def test_authorized_departure_is_a_real_current_offer_not_inferred_arrival(self):
        current, policy = frame(), M1Policy()
        current['fields']['locationId'] = 'palace_exit'
        current['offers'] = []
        policy.start(current, 'helpful_rescuer')
        self.assertIsNone(policy.select(current))
        current['offers'] = [dict(index=90, entry='leave_palace_adventurer', label='Leave')]
        policy.start(current, 'helpful_rescuer')
        self.assertEqual(policy.select(current).candidate.index, 90)
        self.assertIsNone(current['ending'])

    def test_climb_shortcut_does_not_make_old_walk_an_exit_route(self):
        current, policy = frame(), M1Policy()
        current['scene']['knownSites'].append('palace_exit')
        current['scene']['routes'] = [dict(start='b', end='palace_exit', kind='path'),
            dict(start='c', end='palace_exit', kind='climb')]
        current['offers'] = current['offers'][:2]
        policy.places.update(('a', 'b', 'c'))
        for offer in current['offers']:
            policy.visited.add(policy.key(current, offer))
        policy.start(current, 'helpful_rescuer')
        choices = policy.candidates(current, 'helpful_rescuer')
        self.assertEqual([row.index for row in choices], [71])
        self.assertEqual(policy.select(current).candidate.index, 71)
        self.assertEqual([row['site'] for row in policy.snapshot()['plan']['route']],
                         ['a', 'b', 'palace_exit'])

    def test_resource_reserve_filters_spending_not_other_progress(self):
        for charge in (2, None):
            with self.subTest(charge=charge):
                current, policy = frame(), M1Policy()
                current['fields']['everflameCharges'] = charge
                current['observations'] = [dict(id='p', kind='person', site='a', state='frozen')]
                current['offers'] = [dict(index=1, entry='thaw_person_adventurer', label='Thaw', targetIds=['p']),
                    dict(index=2, entry='cross_ice_adventurer', label='Go', destination='b', movementKind='ice')]
                policy.start(current, 'helpful_rescuer')
                self.assertEqual(policy.select(current).candidate.index, 2)
                self.assertEqual(policy.run.status, 'running')

    def test_ambiguous_targets_do_not_block_an_identifiable_alternative(self):
        current, policy = frame(), M1Policy()
        current['offers'] = [dict(index=1, entry='observe_chest_adventurer', label='Chest'),
            dict(index=2, entry='observe_chest_adventurer', label='Chest'),
            dict(index=3, entry='move_adventurer', label='Walk', destination='b', movementKind='walk')]
        policy.start(current, 'helpful_rescuer')
        self.assertEqual(policy.select(current).candidate.index, 3)

    def test_changed_floor_reopens_inspection_but_unrelated_people_and_clock_do_not(self):
        current, policy = frame(), M1Policy()
        current['offers'] = [dict(index=1, entry='observe_floor_adventurer', label='Floor')]
        policy.start(current, 'cautious_investigator')
        chosen = policy.select(current)
        checked = copy.deepcopy(current)
        checked['observations'] = [dict(id='floor', kind='floor', site='a', state='normal')]
        checked['feedback'] = {'status': 'published'}
        policy.record(chosen, current, checked, 0, 1)
        checked['time'] += 100
        checked['observations'].append(dict(id='p', kind='person', site='a', state='frozen'))
        self.assertEqual(policy.candidates(checked, 'cautious_investigator'), [])
        checked['observations'][0]['state'] = 'frozen'
        self.assertEqual(policy.candidates(checked, 'cautious_investigator')[0].index, 1)

    def test_refrozen_target_can_be_thawed_again_and_retry_limit_has_an_honest_stop(self):
        current, policy = frame(), M1Policy()
        current['offers'] = [dict(index=1, entry='thaw_person_adventurer', label='Thaw', targetIds=['p'])]
        current['observations'] = [dict(id='p', kind='person', site='a', state='frozen')]
        policy.start(current, 'helpful_rescuer', stop_on_unexpected=False)
        selected = policy.select(current)
        thawed = copy.deepcopy(current)
        thawed['observations'][0]['state'] = 'mobile'
        thawed['fields']['everflameCharges'] = 4
        thawed['feedback'] = {'status': 'published'}
        policy.record(selected, current, thawed, 0, 1)
        refrozen = copy.deepcopy(thawed)
        refrozen['observations'][0]['state'] = 'frozen'
        self.assertEqual(policy.candidates(refrozen, 'helpful_rescuer')[0].index, 1)
        key = policy.key(refrozen, refrozen['offers'][0])
        policy.route_attempts[('thaw_person_adventurer', key, policy.public_state(refrozen))] = 2
        policy.start(refrozen, 'helpful_rescuer', stop_on_unexpected=False)
        self.assertIsNone(policy.select(refrozen))
        self.assertEqual(policy.snapshot()['stopDetail']['code'], 'retry_budget')

    def test_rejected_ground_entry_does_not_poison_other_entry_and_changed_offers_reopen(self):
        current, policy = frame(), M1Policy()
        current['offers'] = [dict(index=1, entry='move_adventurer', label='Walk', destination='b', movementKind='walk'),
            dict(index=2, entry='pass_prison_line_adventurer', label='Pass', destination='b', movementKind='walk')]
        policy.start(current, 'decisive_explorer', stop_on_unexpected=False)
        rejected = next(row for row in policy.candidates(current, 'decisive_explorer') if row.index == 1)
        policy.blocked.add((rejected.entry, rejected.key, policy.public_state(current)))
        self.assertEqual([row.index for row in policy.candidates(current, 'decisive_explorer')], [2])
        current['offers'].append(dict(index=3, entry='observe_floor_adventurer', label='Floor'))
        self.assertIn(1, [row.index for row in policy.candidates(current, 'decisive_explorer')])


if __name__ == '__main__':
    unittest.main()
