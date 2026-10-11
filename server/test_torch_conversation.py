"""Execute the authored conversation predicates without compiling the whole adventure."""
from dataclasses import dataclass
import unittest

import yaml

from server.runtime import WORLD_ROOT, install_roots

install_roots()
from nomos_c0.composable_value_v1 import C0ValuePorts, _compile_expression, _eval
from nomos_c0.condition_source_v0 import lower_author_expression


@dataclass(frozen=True)
class Vital:
    life: str


@dataclass(frozen=True)
class Path:
    start: str
    end: str


@dataclass(frozen=True)
class Resident:
    name: str
    site: str


@dataclass(frozen=True)
class Speaker:
    site: str
    cold_state: str
    vital: Vital
    known_residents: tuple[Resident, ...]
    known_paths: tuple[Path, ...]


@dataclass(frozen=True)
class Recipient:
    site: str
    cold_state: str
    vital: Vital


class TorchConversationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        control = yaml.safe_load((WORLD_ROOT / 'source/control/seats.yaml').read_text())
        seat = next(row for row in control['seats'] if row.get('name') == 'adventurer')
        cls.offer = next(row for row in seat['offers'] if row['entry'] == 'offer_torch_adventurer')
        bindings = yaml.safe_load((WORLD_ROOT / 'source/bindings/capabilities.yaml').read_text())
        cls.action = next(row for row in bindings['actions'] if row.get('name') == cls.offer['entry'])
        ports = yaml.safe_load((WORLD_ROOT / 'capabilities.ports.yaml').read_text())
        cls.input = next(row for row in ports['candidate_inputs']
                         if row['symbol'] == cls.offer['availability']['ref'])
        records = (Vital, Path, Resident, Speaker, Recipient)
        fields = {record: frozenset(record.__annotations__) for record in records}
        roots = {'actor': Speaker, 'recipient': Recipient, 'candidate': str}
        readable = frozenset({'actor.site', 'actor.cold_state', 'actor.vital.life',
                             'actor.known_residents', 'actor.known_paths', 'candidate',
                             *cls.input['read']})
        value_ports = C0ValuePorts(roots=roots, readable_paths=readable,
            admission_readable_paths=readable, readable_fields=fields,
            admission_readable_fields=fields, writable_fields={},
            record_types={record.__name__: record for record in records},
            tuple_fields={}, admission_tuple_fields={}, collection_keys={},
            outputs={'allowed': bool})
        def compile_predicate(expression):
            # Menu candidates include scalar aliases, unlike complete world-state roots.
            return _compile_expression(lower_author_expression(expression)[0],
                                       roots, value_ports, set())
        cls.ports = value_ports
        cls.known = compile_predicate(cls.offer['when'])
        cls.current = compile_predicate(cls.offer['availability']['when'])

    def allowed(self, candidate='ritual_resident', recipient_site='ritual_ring',
                life='alive', cold='mobile', speaker_life='alive', known=True):
        actor = Speaker('ritual_ring', 'mobile', Vital(speaker_life),
            (Resident(candidate, 'ritual_ring'),) if known else (),
            (Path('ritual_ring', 'ritual_threshold'),))
        roots = {'actor': actor, 'recipient': Recipient(recipient_site, cold, Vital(life)),
                 'candidate': candidate}
        return all(_eval(program, roots, dict(self.ports.roots), self.ports)
                   for program in (self.known, self.current))

    def test_candidates_come_only_from_the_action_member_domain(self):
        self.assertEqual(self.offer['for_each_participants']['recipient'],
                         {'selected_members': True, 'as': 'candidate'})
        members = self.action['participants']['recipient']['actors']
        self.assertEqual(len(members), 6)
        self.assertNotIn('bokold_one', members)
        self.assertNotIn('bokold_two', members)
        self.assertEqual(self.offer['payload']['recipient'], {'ref': 'candidate'})

    def test_colocated_awake_known_resident_can_be_addressed(self):
        self.assertTrue(self.allowed())

    def test_frozen_dead_incapacitated_or_departed_resident_is_not_offered(self):
        for changes in ({'cold': 'frozen'}, {'life': 'dead'}, {'life': 'incapacitated'},
                        {'recipient_site': 'palace_exit'}):
            with self.subTest(**changes):
                self.assertFalse(self.allowed(**changes))

    def test_member_declaration_does_not_create_player_knowledge(self):
        self.assertFalse(self.allowed(known=False))

    def test_dead_speaker_cannot_start_conversation(self):
        self.assertFalse(self.allowed(speaker_life='dead'))

    def test_candidate_inputs_are_a_subset_of_the_existing_action_read_domain(self):
        action_ports = next(row for row in yaml.safe_load(
            (WORLD_ROOT / 'capabilities.ports.yaml').read_text())['actions']
            if row['symbol'] == 'offer_torch')
        self.assertEqual(self.input['action'], 'offer_torch')
        self.assertLessEqual(set(self.input['read']), set(action_ports['value']['read']))


if __name__ == '__main__':
    unittest.main()
