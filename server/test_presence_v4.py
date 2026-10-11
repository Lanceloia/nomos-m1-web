"""Finite author-projected presence; no Scene or other Actor reads in the host."""
import json
import unittest
from server.player_information import PlayerInformation


class PresenceTests(unittest.TestCase):
    def setUp(self):
        self.memory = PlayerInformation()
        self.ids = {}

    def identify(self, key):
        self.ids.setdefault(key, f'seen-{len(self.ids) + 1}')
        return self.ids[key]

    def surface(self, cells):
        return self.memory.capture_surface({
            'adventurer.site': 'ritual_threshold',
            'known_site_protection': (('ritual_threshold', tuple(cells.items())),),
        }, self.identify, {})

    def test_adjacent_observation_keeps_actual_site_and_no_private_detail(self):
        rows = self.surface({'surface_available': True,
                             'visible_person_bokold_two': 'ritual_ring',
                             'description_person_bokold_two': '博科尔德'})
        self.memory.capture(rows, None, 100, 1)
        public = self.memory.snapshot()
        self.assertEqual(public['visibleEntities'], [])
        entity = public['nearbyEntities'][0]
        self.assertEqual(entity['site'], 'ritual_ring')
        self.assertEqual(entity['label'], '博科尔德 · 1')
        self.assertEqual(entity['facts'], [])
        self.assertEqual(entity['state'], 'unknown')
        self.assertNotIn('bokold_two', json.dumps(public))

    def test_unseen_descriptions_are_not_received_and_movement_has_no_remote_update(self):
        self.surface({'surface_available': False, 'visible_person_secret': 'tower_top',
                      'description_person_secret': '隐藏身份'})
        self.assertEqual(self.memory.descriptions, {})
        self.assertEqual(self.memory.snapshot()['nearbyEntities'], [])
        label = self.memory.person_label('secret', self.identify, {})
        self.assertEqual(label, '附近的人 · 1')

    def test_lost_sight_retains_only_the_last_seen_position(self):
        rows = self.surface({'surface_available': True, 'visible_person_one': 'ritual_ring'})
        self.memory.capture(rows, None, 100, 1)
        self.surface({'surface_available': True})
        self.assertEqual(self.memory.snapshot()['nearbyEntities'], [])
        record = self.memory.observations()[0]
        self.assertEqual(record['site'], 'ritual_ring')
        self.assertEqual(record['recordedAt'], {'time': 100, 'revision': 1})
        self.assertEqual(record['presence'], 'not_confirmed')

    def test_same_description_distinguishes_people_without_leaking_internal_identity(self):
        rows = self.surface({'surface_available': True,
                             'visible_person_first': 'ritual_threshold', 'visible_person_second': 'ritual_ring',
                             'description_person_first': '博科尔德',
                             'description_person_second': '博科尔德'})
        self.assertEqual({row['label'] for row in rows}, {'博科尔德 · 1', '博科尔德 · 2'})
        self.assertEqual(self.memory.person_label('first', self.identify, {}), '博科尔德 · 1')

    def test_current_and_nearby_lists_do_not_grant_cross_site_action(self):
        rows = self.surface({'surface_available': True, 'visible_person_one': 'ritual_threshold',
                             'visible_person_two': 'ritual_ring'})
        self.assertEqual(self.memory.snapshot()['visibleEntities'][0]['site'], 'ritual_threshold')
        self.assertEqual(self.memory.snapshot()['nearbyEntities'][0]['site'], 'ritual_ring')
        self.assertEqual(len(rows), 2)

    def test_repeated_current_observation_is_stable(self):
        cells = {'surface_available': True, 'visible_person_one': 'ritual_ring',
                 'description_person_one': '博科尔德'}
        self.assertEqual(self.surface(cells), self.surface(cells))


if __name__ == '__main__':
    unittest.main()
