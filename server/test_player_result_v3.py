"""Named short gate: authorized actual outcome display, not engine gameplay."""
import json
import unittest
from types import SimpleNamespace as R
from server.player_result import player_result

class PlayerResultV3Tests(unittest.TestCase):
    def test_collision_requires_matching_known_crossing(self):
        offer = R(entry='cross_ice_adventurer', payload=(('crossing', 'x'),))
        before = {'adventurer.site': 'origin', 'adventurer.known_crossings': (R(key='x', intended='target', collision='wall'),)}
        result = player_result(offer, before, {'adventurer.site': 'wall'}, {'adventurer.site': 'wall'}, True)
        self.assertTrue(result['collision'])
        self.assertEqual((result['landing'], result['target']), ('wall', 'target'))
        missing = player_result(offer, {}, {'adventurer.site': 'wall'}, {}, True)
        self.assertNotIn('collision', missing)
        self.assertNotIn('target', missing)
        # The frozen public KnownCrossing exposes intended, not the private collision destination.
        public = {**before, 'adventurer.known_crossings': (R(key='x', intended='target'),)}
        unknown = player_result(offer, public, {'adventurer.site': 'wall'}, {}, True)
        self.assertEqual(unknown['target'], 'target')
        self.assertNotIn('collision', unknown)

    def test_equal_roll_number_with_new_ref_is_new_but_old_ref_is_not(self):
        offer = R(entry='cross_ice_adventurer', payload=())
        before = {'adventurer.last_cross_ref': 'old', 'adventurer.last_cross_roll': 2}
        instant = {**before, 'adventurer.last_cross_ref': 'new'}
        result = player_result(offer, before, instant, instant, True)
        self.assertEqual(result['rolls'], [{'kind': 'balance', 'value': 2}])
        self.assertNotIn('rolls', player_result(offer, before, before, before, True))
        self.assertNotIn('ref', json.dumps(result))

    def test_action_cost_and_later_cold_are_separate_and_zero_is_known(self):
        offer = R(entry='thaw_person_adventurer', payload=(('private', object()),))
        before = {'adventurer.known_everflame_charges': 1, 'adventurer.vital.endurance': 3}
        instant = {**before, 'adventurer.known_everflame_charges': 0}
        after = {**instant, 'adventurer.vital.endurance': 2}
        result = player_result(offer, before, instant, after, True)
        self.assertEqual(result['changes'], [{'field': 'everflameCharges', 'before': 1, 'after': 0}])
        self.assertEqual(result['laterChanges'], [{'field': 'endurance', 'before': 3, 'after': 2}])
        self.assertNotIn('private', json.dumps(result))

    def test_refusal_has_no_success_record_or_resource_inference(self):
        self.assertIsNone(player_result(R(entry='thaw_person_adventurer', payload=()), {}, {}, {}, False))

    def test_missing_old_value_is_not_zero(self):
        result = player_result(R(entry='detach_reservoir_adventurer', payload=()), {}, {'adventurer.known_reservoir_charges': 2}, {'adventurer.known_reservoir_charges': 2}, True)
        self.assertEqual(result['changes'], [{'field': 'carriedReservoirCharges', 'after': 2}])
