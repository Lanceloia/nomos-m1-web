"""Short scoring contracts; synthetic frames are not gameplay evidence."""
from copy import deepcopy
from types import SimpleNamespace as R
import unittest

from server.play_report import PlayLedger, ScoreFacts, ScoreRules
from server.test_policy_execution import frame, ControlTests
from server.test_w1_feedback import FeedbackTransportTests


class PlayReportTests(unittest.TestCase):
    def setUp(self):
        self.opening = frame()
        self.rules = ScoreRules()
        self.ledger = PlayLedger(self.opening, self.rules)

    def record(self, after, *, entry='move_adventurer', identity=1, instant=None, personality=None,
               appraisal_key=None, merits=None):
        self.ledger.record(before=self.opening, after=after, entry=entry, label='Public action',
            publication=R(occurrences=(R(occurrence=identity),)), instant=instant or {},
            personality=personality, appraisal_key=appraisal_key, merits=merits)

    def test_authored_scores_compile_and_unknown_path_rejected(self):
        self.assertEqual(self.rules.evaluate(ScoreFacts(visitedPlaces=2))['decisive_explorer'], 0)
        self.assertEqual(self.rules.evaluate(ScoreFacts(explorationMerit=20))['decisive_explorer'], 20)
        altered = {'schema': 'm1.play_score.v1', 'thaw_entries': [],
                   'scores': {name: 0 for name in ('common', 'cost', 'cautious_investigator',
                                                 'helpful_rescuer', 'decisive_explorer')}}
        altered['scores']['common'] = 'facts.peopleThawed * 7'
        self.assertEqual(ScoreRules(altered).evaluate(ScoreFacts(peopleThawed=2))['common'], 14)
        altered['scores']['common'] = 'scene.hidden_rescued'
        with self.assertRaises(ValueError):
            ScoreRules(altered)
        altered['scores']['common'] = 0
        altered['thaw_entries'] = ['missing']
        with self.assertRaises(ValueError):
            ScoreRules(altered, program=R(actions=()))

    def test_opening_known_map_and_repeated_observation_do_not_give_points(self):
        after = deepcopy(self.opening)
        self.record(after)
        self.record(after, identity=2)
        report = self.ledger.snapshot(after)
        self.assertEqual(report['metrics']['visitedPlaces'], 0)
        self.assertEqual(report['scores']['common'], 0)
        self.assertEqual(report['scores']['cost'], 4)
        self.assertEqual(report['efficiency']['decisive_explorer'], -2)
        self.assertIsNone(report['rescuesConfirmed'])

    def test_actual_location_and_detail_are_unique_not_map_destinations(self):
        after = deepcopy(self.opening)
        after['fields'].update(locationId='b', location='B')
        after['observations'] = [{'id': 'seen-1', 'kind': 'person', 'label': 'Resident',
                                 'detailRecordedAt': {'time': 1, 'revision': 1},
                                 'facts': [{'label': 'state', 'value': 'frozen'}]}]
        self.record(after)
        after['observations'][0]['detailRecordedAt']['revision'] = 99
        self.record(after, identity=2)
        report = self.ledger.snapshot(after)
        self.assertEqual((report['metrics']['peopleDetailed'], report['metrics']['visitedPlaces']), (1, 1))
        self.assertEqual(report['scores']['cautious_investigator'], 0)
        self.assertEqual(len(report['achievements']), 2)

    def test_thaw_requires_published_authored_entry_and_immediate_result(self):
        after = deepcopy(self.opening)
        after['fields']['lastPersonThawed'] = 'resident'
        self.record(after, entry='offer_escort_adventurer', instant={'adventurer.last_thawed': 'resident'})
        self.assertEqual(self.ledger.facts.peopleThawed, 0)
        self.record(after, entry='thaw_person_adventurer', identity=2,
                    instant={'adventurer.last_thawed': 'resident'})
        self.record(after, entry='thaw_person_adventurer', identity=3,
                    instant={'adventurer.last_thawed': 'resident'})
        self.assertEqual(self.ledger.facts.peopleThawed, 1)
        self.assertNotIn('resident', str(self.ledger.snapshot(after)['achievements']))

    def test_published_thaw_target_memory_is_detached_and_survives_later_steps(self):
        after = deepcopy(self.opening)
        args = dict(before=self.opening, after=after, label='Thaw',
                    instant={'adventurer.last_thawed': 'private-subject'}, thawed_target_id='public-target')
        self.ledger.record(**args, entry='thaw_person_adventurer', publication=None)
        self.ledger.record(**args, entry='offer_escort_adventurer', publication=R(occurrences=(R(occurrence=1),)))
        self.assertTrue(all('thawedTargetId' not in row for row in self.ledger.actions))
        self.ledger.record(**args, entry='thaw_person_adventurer', publication=R(occurrences=(R(occurrence=2),)))
        self.record(after, identity=3)
        report = self.ledger.snapshot(after)
        self.assertEqual(report['actions'][1]['thawedTargetId'], 'public-target')
        self.assertNotIn('private-subject', str(report))
        report['actions'][1]['thawedTargetId'] = 'changed'
        self.assertEqual(self.ledger.snapshot(after)['actions'][1]['thawedTargetId'], 'public-target')

    def test_observed_disruption_and_departure_are_different_from_rescue(self):
        after = deepcopy(self.opening)
        after['information']['ritual']['phase'] = 'disrupted'
        self.record(after)
        after['ending'] = {'id': 'departed_palace'}
        self.record(after, identity=2)
        report = self.ledger.snapshot(after)
        self.assertEqual(report['scores']['common'], 160)
        self.assertEqual(report['status'], 'finished')
        self.assertIsNone(report['rescuesConfirmed'])
        self.assertIn('你察觉到仪式不再继续', report['achievements'][0]['evidence'])
        self.assertNotIn('你中断了', report['achievements'][0]['evidence'])

    def test_immediate_and_later_costs_not_net_change_or_unknown_refresh(self):
        after = deepcopy(self.opening)
        after['feedback'] = {'result': {'changes': [
            {'field': 'endurance', 'before': 3, 'after': 1},
            {'field': 'everflameCharges', 'after': 5}], 'laterChanges': [
            {'field': 'endurance', 'before': 1, 'after': 3},
            {'field': 'everflameCharges', 'before': 5, 'after': 4}]}}
        self.record(after)
        self.assertEqual(self.ledger.facts.enduranceSpent, 2)
        self.assertEqual(self.ledger.facts.knownChargeSpent, 1)
        self.assertEqual(self.ledger.snapshot(after)['scores']['cost'], 6)

    def test_failed_ending_penalty_requires_actual_terminal_outcome(self):
        after = deepcopy(self.opening)
        after['fields']['life'] = 'incapacitated'
        self.record(after)
        self.assertEqual(self.ledger.facts.failed, 0)
        after['ending'] = {'id': 'rescue_window_expired'}
        self.record(after, identity=2)
        report = self.ledger.snapshot(after)
        self.assertEqual(report['metrics']['failed'], 1)
        self.assertEqual(report['scores']['cost'], 104)

    def test_receipt_dedup_detached_snapshot_and_reset(self):
        after = deepcopy(self.opening)
        after['time'] = 100
        self.record(after)
        self.record(after)
        report = self.ledger.snapshot(after)
        self.assertEqual(report['metrics']['publishedActions'], 1)
        self.assertEqual(report['metrics']['elapsed'], 100)
        report['actions'][0]['label'] = 'bad'
        report['metrics']['publishedActions'] = 999
        self.assertEqual(self.ledger.snapshot(after)['actions'][0]['label'], 'Public action')
        empty = PlayLedger(after, self.rules).snapshot(after)
        self.assertEqual(empty['actions'], [])
        self.assertIsNone(empty['efficiency']['helpful_rescuer'])

    def test_manual_and_all_personas_share_one_episode(self):
        for identity, personality in enumerate((None, 'helpful_rescuer', 'cautious_investigator',
                                               'decisive_explorer'), 1):
            self.record(deepcopy(self.opening), identity=identity, personality=personality)
        report = self.ledger.snapshot(self.opening)
        self.assertEqual((report['metrics']['manualActions'], report['metrics']['delegatedActions']), (1, 3))
        self.assertEqual(len(report['actions']), 4)

    def test_controls_and_refused_duplicate_do_not_create_action_cost(self):
        game = ControlTests().game()
        started = ControlTests().start(game)
        game.control_policy('cancel', {'revision': 0, 'policyRevision': started['policyRevision'],
                                      'policyId': started['policy']['id'], 'requestId': 'cancel'})
        self.assertEqual(game.response()['playReport']['metrics']['publishedActions'], 0)
        game, calls = FeedbackTransportTests().game()
        body = {'index': 1, 'revision': 0, 'requestId': 'refused'}
        first = game.mutate('actions', body)
        self.assertEqual(game.mutate('actions', body), first)
        self.assertEqual(len(calls), 1)
        report = first['playReport']
        self.assertEqual(report['metrics']['rejectedAttempts'], 1)
        self.assertEqual(report['metrics']['publishedActions'], 0)
        self.assertEqual(report['scores']['cost'], 0)

    def test_style_follows_actual_choice_not_selected_personality_and_does_not_farm(self):
        merits = dict(cautious_investigator=14, helpful_rescuer=5, decisive_explorer=1)
        key = ('a', 'floor', '', ())
        after = deepcopy(self.opening)
        self.record(after, personality='decisive_explorer', appraisal_key=key, merits=merits)
        self.record(after, identity=2, personality='helpful_rescuer', appraisal_key=key, merits=merits)
        report = self.ledger.snapshot(after)
        self.assertEqual([report['scores'][name] for name in merits], [14, 5, 1])
        other = PlayLedger(self.opening, self.rules)
        other.record(before=self.opening, after=after, entry='look', label='Look',
            publication=None, instant={}, appraisal_key=key, merits=merits)
        self.assertEqual(other.facts.investigationMerit, 0)
        self.assertFalse(other.style_choices)

    def test_all_personalities_assess_the_same_manual_action(self):
        from server.m1_policy import M1Policy
        policy, current = M1Policy(), frame()
        key, merits = policy.action_merits(current, 42)
        self.assertEqual(merits, dict(cautious_investigator=10, helpful_rescuer=7, decisive_explorer=1))
        self.assertEqual(key[0][1], 'floor')
        self.assertIsNone(policy.action_merits(current, 123456)[1])

    def test_changed_public_evidence_scores_a_new_check_not_a_timestamp_refresh(self):
        from server.m1_policy import M1Policy
        current, policy = frame(), M1Policy()
        current['offers'] = [dict(index=1, entry='observe_floor_adventurer', label='Floor')]
        first_key, first_merits = policy.action_merits(current, 1)
        checked = deepcopy(current)
        checked['observations'] = [dict(id='f', kind='floor', site='a', state='normal', recordedAt=1)]
        self.record(checked, appraisal_key=first_key, merits=first_merits)
        policy.observe_episode(checked, self.ledger, current['offers'][0], current, True)
        changed = deepcopy(checked)
        changed['observations'][0]['state'] = 'frozen'
        next_key, next_merits = policy.action_merits(changed, 1)
        self.assertNotEqual(first_key, next_key)
        self.record(changed, identity=2, appraisal_key=next_key, merits=next_merits)
        changed['observations'][0]['recordedAt'] = 99
        changed['time'] += 100
        same_key, same_merits = policy.action_merits(changed, 1)
        self.assertEqual(next_key, same_key)
        self.record(changed, identity=3, appraisal_key=same_key, merits=same_merits)
        self.assertEqual(self.ledger.facts.investigationMerit, 20)

    def test_style_scales_are_comparable_even_when_profile_weights_have_different_magnitudes(self):
        from server.m1_policy import M1Policy
        current, policy = frame(), M1Policy()
        _, expected = policy.action_merits(current, 42)
        for value in expected.values():
            self.assertTrue(0 <= value <= 10)
        policy.profiles = deepcopy(policy.profiles)
        policy.profiles['helpful_rescuer']['weights'] = {
            name: value * 9 for name, value in policy.profiles['helpful_rescuer']['weights'].items()}
        self.assertEqual(policy.action_merits(current, 42)[1], expected)


if __name__ == '__main__':
    unittest.main()
