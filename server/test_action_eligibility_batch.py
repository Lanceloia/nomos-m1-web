"""Evaluate shipped candidate predicates, without compiling or replaying the adventure."""
from dataclasses import dataclass, replace
import unittest

import yaml

from server.runtime import WORLD_ROOT, install_roots

install_roots()
from nomos_c0.composable_value_v1 import (
    C0ValuePorts, _compile_expression, _eval, _guard_proofs,
)
from nomos_c0.condition_source_v0 import lower_author_expression


@dataclass(frozen=True)
class Vital:
    life: str


@dataclass(frozen=True)
class Sighting:
    subject: str
    site: str
    cold_state: str
    life: str


@dataclass(frozen=True)
class KnownPerson:
    name: str
    site: str


@dataclass(frozen=True)
class Path:
    start: str
    end: str
    intended: str


@dataclass(frozen=True)
class Door:
    front: str
    back: str


@dataclass(frozen=True)
class Torch:
    holder: str
    charges: int = 4


@dataclass(frozen=True)
class BalloonSighting:
    charges: int


@dataclass(frozen=True)
class Resources:
    power_origin: int | None
    balloon: BalloonSighting | None


@dataclass(frozen=True)
class Power:
    holder: str
    origin: int
    charges: int


@dataclass(frozen=True)
class Balloon:
    site: str


@dataclass(frozen=True)
class Actor:
    name: str
    site: str
    vital: Vital
    cold_state: str
    current_movement_speed: int
    person_sighting: Sighting | None
    known_residents: tuple[KnownPerson, ...]
    known_everflame_charges: int | None
    resources: Resources = Resources(1, BalloonSighting(0))
    ritual_notice: str = 'active'
    sighting_ref: int | None = 1
    sighting_site: str | None = 'ritual_ring'
    last_thawed: str | None = None


def load(relative):
    return yaml.safe_load((WORLD_ROOT / relative).read_text())


class ActionEligibilityBatchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        control = load('source/control/seats.yaml')
        cls.seats = {row['name']: row for row in control['seats'] if 'name' in row}
        cls.sets = {row['name']: row for row in load('source/menu_sets.yaml')['offer_sets']}
        cls.bindings = load('source/bindings/capabilities.yaml')['actions']
        cls.participants = {row['name']: row['participants']
                            for row in load('source/participant_bindings.yaml')['participant_bindings']}
        cls.compiled = {}

    def offer(self, entry, seat='adventurer', operation=None):
        rows = (self.sets[seat]['offers'] if seat in self.sets else self.seats[seat]['offers'])
        return next(row for row in rows if row.get('entry', row.get('entry_family')) == entry
                    and (operation is None or row['payload']['operation']['const'] == operation))

    def members(self, entry):
        action = next((row for row in self.bindings if row.get('name') == entry), None)
        if action is None:
            family = entry.removesuffix('_adventurer').removesuffix('_wall_resident')
            action = next(row for row in self.bindings if row.get('family') == family)
        participants = {}
        for name in action.get('use_participants', []):
            participants.update(self.participants[name])
        participants.update(action.get('participants', {}))
        return participants['victim']['actors']

    def evaluate(self, offer, actor, candidate='ritual_resident', power_charges=1, torch_charges=4):
        person_type = KnownPerson if 'collection' in offer.get('for_each_participants', {}).get('victim', {}) else str
        key = (repr(offer), person_type)
        if key not in self.compiled:
            records = (Vital, Sighting, KnownPerson, Path, Door, Torch, Actor,
                       BalloonSighting, Resources, Power, Balloon)
            fields = {record: frozenset(record.__annotations__) for record in records}
            roots = {'actor': Actor, 'patient': str, 'person': person_type,
                     'path': Path, 'door': Door, 'torch': Torch, 'power': Power, 'balloon': Balloon,
                     'candidate': KnownPerson}
            readable = frozenset({'actor.name', 'actor.site', 'actor.vital.life',
                'actor.cold_state', 'actor.current_movement_speed', 'actor.person_sighting',
                'actor.person_sighting.subject', 'actor.person_sighting.site',
                'actor.person_sighting.cold_state', 'actor.person_sighting.life',
                'actor.known_residents', 'actor.known_everflame_charges', 'patient', 'person',
                'person.name', 'person.site', 'path.start', 'path.end', 'path.intended',
                'door.front', 'door.back', 'torch.holder', 'torch.charges',
                'actor.resources.power_origin', 'actor.resources.balloon',
                'actor.resources.balloon.charges', 'balloon.site',
                'power.holder', 'power.origin', 'power.charges', 'candidate.name', 'candidate.site',
                'actor.ritual_notice', 'actor.sighting_ref', 'actor.sighting_site', 'actor.last_thawed'})
            ports = C0ValuePorts(roots=roots, readable_paths=readable,
                admission_readable_paths=readable, readable_fields=fields,
                admission_readable_fields=fields, writable_fields={},
                record_types={record.__name__: record for record in records},
                tuple_fields={}, admission_tuple_fields={}, collection_keys={},
                outputs={'allowed': bool})
            visible = lower_author_expression(offer.get('visible_when', True))[0]
            condition = lower_author_expression(offer['when'])[0]
            proofs = _guard_proofs(visible, roots, ports)
            self.compiled[key] = (ports, _compile_expression(visible, roots, ports, set()),
                                 _compile_expression(condition, roots, ports, proofs))
        ports, visible, condition = self.compiled[key]
        roots = {'actor': actor, 'patient': candidate,
                 'person': KnownPerson(candidate, actor.site) if person_type is KnownPerson else candidate,
                 'path': Path(actor.site, 'ritual_threshold', 'ritual_threshold'),
                 'door': Door(actor.site, 'ritual_threshold'), 'torch': Torch(actor.name, torch_charges),
                 'power': Power(actor.name, 1, power_charges), 'balloon': Balloon(actor.site),
                 'candidate': KnownPerson(candidate, actor.site)}
        return bool(_eval(visible, roots, dict(ports.roots), ports)
                    and _eval(condition, roots, dict(ports.roots), ports))

    def actor(self, subject='ritual_resident', life='alive', cold='frozen', **changes):
        actor = Actor('adventurer', 'ritual_ring', Vital('alive'), 'mobile', 5,
                      Sighting(subject, 'ritual_ring', cold, life),
                      (KnownPerson(subject, 'ritual_ring'),), 4)
        return replace(actor, **changes)

    def patient_offers(self):
        for seat, suffix in [('adventurer', '_adventurer'), ('wall_resident', '_wall_resident'),
                             ('resident_care', ''), ('resident_mobility_and_rescue', '')]:
            entries = ['care_person'] if seat == 'resident_care' else (
                ['carry_move', 'carry_bridge_slow', 'carry_cross_ice', 'carry_pass_door', 'inspect_patient']
                if seat == 'resident_mobility_and_rescue' else
                ['care_person', 'carry_move', 'carry_bridge_slow', 'carry_cross_ice', 'carry_pass_door', 'inspect_patient'])
            for name in entries:
                yield name, self.offer(name + suffix, seat)

    def test_patient_targets_use_the_actual_closed_action_domain(self):
        for name, offer in self.patient_offers():
            with self.subTest(entry=offer.get('entry', offer.get('entry_family'))):
                alias = 'person' if name == 'inspect_patient' else 'patient'
                self.assertEqual(offer['for_each_participants']['victim'],
                                 {'selected_members': True, 'as': alias})
                self.assertEqual(offer['payload']['victim'], {'ref': alias})
                for foreign in ('emma', 'captive_bear', 'icebar_bear_one', 'arctic_fox_one'):
                    self.assertNotIn(foreign, self.members(name))

    def test_generic_thaw_cannot_bind_bokold_queen_or_fox(self):
        offer = self.offer('thaw_person_adventurer')
        self.assertEqual(offer['for_each_participants']['victim'],
                         {'selected_members': True, 'as': 'person'})
        members = self.members('thaw_person_adventurer')
        self.assertIn('ritual_resident', members)
        for foreign in ('bokold_one', 'emma', 'arctic_fox_one'):
            self.assertNotIn(foreign, members)

    def test_valid_patient_offer_remains_available(self):
        for name, offer in self.patient_offers():
            actor = self.actor(life='incapacitated', cold='mobile') if name == 'care_person' else self.actor()
            with self.subTest(name=name):
                self.assertTrue(self.evaluate(offer, actor))

    def test_dead_patient_is_not_carried_even_when_observed_frozen(self):
        for name, offer in self.patient_offers():
            if name.startswith('carry_'):
                with self.subTest(name=name):
                    self.assertFalse(self.evaluate(offer, self.actor(life='dead')))

    def test_wrong_patient_and_absent_sighting_are_not_care_or_carry_options(self):
        for name, offer in self.patient_offers():
            if name == 'inspect_patient':
                continue
            for actor in (self.actor(subject='huddled_one'), self.actor(person_sighting=None)):
                with self.subTest(name=name):
                    self.assertFalse(self.evaluate(offer, actor))

    def test_inactive_actor_cannot_care_carry_inspect_thaw_or_call(self):
        offers = list(self.patient_offers()) + [('thaw', self.offer('thaw_person_adventurer')),
                                              ('escort', self.offer('offer_escort_adventurer'))]
        for name, offer in offers:
            for change in ({'vital': Vital('dead')}, {'vital': Vital('incapacitated')}, {'cold_state': 'frozen'}):
                with self.subTest(name=name, change=change):
                    self.assertFalse(self.evaluate(offer, self.actor(**change)))

    def test_immobile_actor_has_no_carry_offer(self):
        for name, offer in self.patient_offers():
            if name.startswith('carry_'):
                self.assertFalse(self.evaluate(offer, self.actor(current_movement_speed=0)))

    def test_declared_member_does_not_create_an_inspection_or_thaw_sighting(self):
        for entry in ('inspect_patient_adventurer', 'thaw_person_adventurer'):
            self.assertFalse(self.evaluate(self.offer(entry), self.actor(known_residents=())))

    def test_past_local_sighting_still_allows_inspection_attempt(self):
        offer = self.offer('inspect_patient_adventurer')
        self.assertTrue(self.evaluate(offer, self.actor()))
        self.assertNotIn('availability', offer)
        # Actual current reachability remains a K0 check, not a remote knowledge update.

    def test_dead_fox_and_queen_are_not_thawed(self):
        for entry, name in [('thaw_fox_adventurer', 'arctic_fox_one'), ('thaw_queen_adventurer', 'emma')]:
            offer = self.offer(entry)
            self.assertTrue(self.evaluate(offer, self.actor(subject=name), name))
            self.assertFalse(self.evaluate(offer, self.actor(subject=name, life='dead'), name))

    def test_balloon_power_load_requires_charge_and_free_capacity(self):
        offer = self.offer('load_balloon_power_adventurer')
        self.assertTrue(self.evaluate(offer, self.actor()))
        self.assertFalse(self.evaluate(offer, self.actor(), torch_charges=5))
        self.assertFalse(self.evaluate(offer, self.actor(), power_charges=0))
        self.assertFalse(self.evaluate(offer, self.actor(resources=Resources(None, None))))

    def test_balloon_reload_and_withdraw_require_opposite_carrier_state(self):
        reload = self.offer('transfer_balloon_power_adventurer', operation='reload')
        withdraw = self.offer('transfer_balloon_power_adventurer', operation='withdraw')
        empty_balloon = self.actor()
        full_balloon = self.actor(resources=Resources(1, BalloonSighting(1)))
        self.assertTrue(self.evaluate(reload, empty_balloon, power_charges=1))
        self.assertFalse(self.evaluate(reload, empty_balloon, power_charges=0))
        self.assertTrue(self.evaluate(withdraw, full_balloon, power_charges=0))
        self.assertFalse(self.evaluate(withdraw, full_balloon, power_charges=1))
        self.assertFalse(self.evaluate(reload, full_balloon))
        self.assertFalse(self.evaluate(withdraw, empty_balloon, power_charges=0))

    def test_balloon_power_read_grants_stay_within_existing_action_permission(self):
        actions = {row['symbol']: row for row in load('capabilities.ports.yaml')['actions']}
        for entry, action in [('transfer_balloon_power_adventurer', 'transfer_balloon_power'),
                              ('load_balloon_power_adventurer', 'load_balloon_power')]:
            for role in self.offer(entry)['for_each_participants'].values():
                self.assertLessEqual(set(role.get('read', [])), set(actions[action]['value']['read']))

    def test_heard_ritual_completion_removes_the_quick_intervention(self):
        offer = self.offer('thaw_ritual_resident')
        actor = self.actor(person_sighting=None)
        self.assertTrue(self.evaluate(offer, actor))
        self.assertFalse(self.evaluate(offer, replace(actor, ritual_notice='erupted')))


if __name__ == '__main__':
    unittest.main()
