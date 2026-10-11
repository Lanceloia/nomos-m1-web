"""Compile the authored sightline predicate without replaying a whole night."""
import json
from dataclasses import dataclass
import unittest

import yaml
from server.runtime import WORLD_ROOT, install_roots

install_roots()
from nomos_c0.composable_value_v1 import C0ValuePorts, compile_value_program, verify_pure_definition_types
from nomos_c0.pure_definition_v1 import check_pure_definitions
from nomos_c0.condition_source_v0 import lower_author_expression


@dataclass(frozen=True)
class Sites:
    observer: str
    subject: str


class AuthoredSightlineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        lib = yaml.safe_load((WORLD_ROOT / 'model.lib.yaml').read_text())
        raw = [row for row in lib['pure_definitions'] if row['name'].startswith('perception.')
               and row['name'] in ('perception.visible_site', 'perception.open_neighbor')]
        records = {'Sites': Sites}
        table = check_pure_definitions(raw, records)
        verify_pure_definition_types(table, records)
        paths = frozenset({'sites.observer', 'sites.subject'})
        fields = {Sites: frozenset({'observer', 'subject'})}
        ports = C0ValuePorts(
            roots={'sites': Sites}, readable_paths=paths, admission_readable_paths=paths,
            readable_fields=fields, admission_readable_fields=fields,
            writable_fields={}, record_types=records, tuple_fields={}, admission_tuple_fields={},
            collection_keys={}, outputs={'visible': bool}, pure_definitions=table)
        cls.program = compile_value_program(json.dumps({
            'schema': 'c0.value.v1', 'bindings': [], 'guard': {'const': True},
            'outputs': {'visible': {'call': {'ref': 'perception.visible_site', 'args': {
                'observer_site': {'ref': 'sites.observer'}, 'subject_site': {'ref': 'sites.subject'}}}}},
        }), ports, admission_outputs=frozenset({'visible'}))

    def visible(self, start, end):
        return self.program.evaluate_admission_outputs({'sites': Sites(start, end)})['visible']

    def test_same_site_and_both_directions_of_authored_open_edge(self):
        self.assertTrue(self.visible('ritual_ring', 'ritual_ring'))
        self.assertTrue(self.visible('ritual_ring', 'ritual_threshold'))
        self.assertTrue(self.visible('ritual_threshold', 'ritual_ring'))

    def test_two_hops_door_and_different_floor_do_not_reveal_people(self):
        for start, end in [('ritual_passage_entry', 'ritual_ring'),
                           ('ballroom_chandelier_reach', 'halls_ballroom_door'),
                           ('tower_base', 'tower_top'), ('unknown', 'ritual_ring')]:
            with self.subTest(start=start, end=end):
                self.assertFalse(self.visible(start, end))

    def test_seat_projection_outputs_exactly_match_ports(self):
        rules = yaml.safe_load((WORLD_ROOT / 'source/rules/local_observation.yaml').read_text())
        ports = yaml.safe_load((WORLD_ROOT / 'capabilities.ports.yaml').read_text())
        law = next(row for row in rules['lawdefs'] if row['name'] == 'view.current_site_information')
        projection = next(row for row in ports['seat_read_projections']
                          if row['symbol'] == 'known_site_protection')
        outputs = law['body']['value']['outputs']
        self.assertEqual(set(outputs), set(projection['value']['outputs']))
        self.assertLessEqual(len(outputs), 64)
        self.assertIn('surface_available', outputs)
        for name, expression in outputs.items():
            with self.subTest(output=name):
                lower_author_expression(expression)

    def test_pursuit_publishes_motion_and_uses_real_player_observer(self):
        rules = yaml.safe_load((WORLD_ROOT / 'source/rules/local_observation.yaml').read_text())
        source = yaml.safe_load((WORLD_ROOT / 'source/bindings/capabilities.yaml').read_text())
        law = next(row for row in rules['lawdefs'] if row['name'] == 'action.approach_bokold_light')
        motion = law['body']['value']['outputs']['actor_motion']['record']
        self.assertEqual(motion['type'], 'ActorMotion')
        self.assertEqual(motion['fields']['action'], {'ref': 'occurrence'})
        observer = next(row for row in source['events']
                        if row['family'] == 'player_motion_seen_named')
        self.assertTrue({'approach_light_bokold_one', 'approach_light_bokold_two'}
                        <= set(observer['for_actions']))


if __name__ == '__main__':
    unittest.main()
