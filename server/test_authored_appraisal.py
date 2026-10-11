"""Author edits and local evidence drive judgments, not entry-name switches."""
import copy
from dataclasses import dataclass
from types import SimpleNamespace as R
import unittest

from server.authored_appraisal import AuthoredAppraisal
from server.m1_policy import M1Policy
from server.runtime import WORLD_ROOT
from server.test_policy_execution import frame
from nomos_c0.author_contract_v1 import C0LawError
from nomos_c0.author_document_v1 import parse_author_document


def document():
    path = WORLD_ROOT / 'player.appraisal.yaml'
    return parse_author_document(path.read_text(encoding='utf-8'), file=str(path), format='yaml').to_data()


@dataclass(frozen=True)
class Payload:
    victim: str
    floor_key: str
    destination: str
    crossing: str
    chandelier: str
    reservoir: str
    balloon: str
    bars: str
    drink: str
    target: str


def program(raw):
    entries = (*raw['appraisal']['bindings'], *raw['appraisal']['manual'])
    return R(seats=(R(symbol='adventurer', entries=entries),),
             actions=tuple((entry, R(payload_type=Payload)) for entry in entries))


class AuthoredTests(unittest.TestCase):
    def test_manual_offer_destinations_cannot_change_rated_route_features(self):
        current, policy = frame(), M1Policy()
        current['offers'] = current['offers'][:1]
        current['scene']['routes'] = [{'start': 'b', 'end': 'c'}]
        current['observations'] = [dict(id='p', kind='person', site='c', state='frozen')]
        before = policy.candidates(current, 'helpful_rescuer')[0]
        self.assertEqual(before.features['approach'], 1)
        current['offers'].append(dict(index=101, entry='balloon_flight_adventurer',
                                     label='Flight', destination='c', movementKind='flight'))
        self.assertEqual(policy.candidates(current, 'helpful_rescuer')[0], before)

    def test_expected_resource_effect_must_actually_occur(self):
        current, policy = frame(), M1Policy()
        current['fields']['everflameCharges'] = 3
        policy.start(current, 'cautious_investigator')
        selected = policy.select(current)
        self.assertEqual(selected.candidate.meaning, 'replenish')
        after = copy.deepcopy(current)
        after['feedback'] = {'status': 'published'}
        policy.record(selected, current, after, 0, 1)
        self.assertEqual(policy.run.status, 'stopped')
        self.assertIn('资源', policy.run.reason)

    def test_rename_and_new_binding_need_no_python_dispatch(self):
        raw, current = document(), frame()
        definition = raw['appraisal']['bindings'].pop('observe_floor_adventurer')
        raw['appraisal']['bindings']['survey_surface'] = definition
        raw['inputs']['survey_surface'] = raw['inputs'].pop('observe_floor_adventurer')
        contract = AuthoredAppraisal(document=raw, program=program(raw))
        current['offers'][2]['entry'] = 'survey_surface'
        policy = M1Policy(appraisal=contract)
        policy.start(current, 'cautious_investigator')
        selected = policy.select(current)
        self.assertEqual(selected.candidate.entry, 'survey_surface')
        self.assertEqual(selected.candidate.meaning, 'inspect_floor')

    def test_only_editing_authored_feature_changes_selection(self):
        original, changed = document(), document()
        changed['appraisal']['definitions']['inspect_floor']['features']['floor'] = 0
        choices = []
        for raw in (original, changed):
            current = frame()
            policy = M1Policy(appraisal=AuthoredAppraisal(document=raw, program=program(raw)))
            policy.start(current, 'cautious_investigator')
            choices.append(policy.select(current).candidate.entry)
        self.assertEqual(choices, ['observe_floor_adventurer', 'observe_routes_adventurer'])

    def test_same_action_changes_with_current_local_evidence(self):
        current, policy = frame(), M1Policy()
        current['offers'] = [dict(index=1, entry='thaw_person_adventurer', label='Help', targetIds=['seen'])]
        self.assertEqual(policy.candidates(current, 'helpful_rescuer'), [])
        current['observations'] = [dict(id='seen', kind='person', state='frozen', site='a')]
        self.assertEqual(policy.candidates(current, 'helpful_rescuer')[0].features, {'help': 1})
        current['observations'][0]['state'] = 'normal'
        self.assertEqual(policy.candidates(current, 'helpful_rescuer'), [])

    def test_private_root_and_missing_or_stale_program_binding_reject(self):
        raw = document()
        raw['appraisal']['definitions']['inspect_floor']['when'] = 'scene.hidden'
        with self.assertRaises(C0LawError):
            AuthoredAppraisal(document=raw, program=program(raw))
        raw = document()
        selected = program(raw)
        selected.seats[0].entries = (*selected.seats[0].entries, 'new_unclassified_action')
        with self.assertRaises(C0LawError):
            AuthoredAppraisal(document=raw, program=selected)
        raw['inputs']['move_adventurer']['destination']['field'] = 'secret_field'
        with self.assertRaises(C0LawError):
            AuthoredAppraisal(document=raw, program=program(raw))

    def test_authored_projection_uses_bound_fields_and_local_target_handles(self):
        raw = document()
        raw['inputs']['move_adventurer']['destination']['field'] = 'crossing'
        contract = AuthoredAppraisal(document=raw, program=program(raw))
        self.assertEqual(contract.project('move_adventurer', {'crossing': 'b', 'destination': 'wrong'},
                                          {}, {}, set()), {'destination': 'b', 'movementKind': 'walk'})
        self.assertEqual(contract.project('thaw_person_adventurer', {'victim': 'private'},
                                          {}, {'private': 'known'}, set()), {})
        self.assertEqual(contract.project('thaw_person_adventurer', {'victim': 'private'},
                                          {}, {'private': 'known'}, {'known'}), {'targetIds': ['known']})

    def test_same_meaning_peer_choice_does_not_depend_on_entry_names(self):
        raw, current = document(), frame()
        rule = raw['appraisal']['bindings']['move_adventurer']
        raw['appraisal']['bindings']['new_travel'] = rule
        raw['inputs']['new_travel'] = copy.deepcopy(raw['inputs']['move_adventurer'])
        current['offers'] = current['offers'][:2]
        current['offers'][1]['entry'] = 'new_travel'
        policy = M1Policy(appraisal=AuthoredAppraisal(document=raw, program=program(raw)))
        policy.start(current, 'decisive_explorer')
        chosen = policy.select(current).candidate.index
        current['offers'].reverse()
        self.assertEqual(policy.select(current).candidate.index, chosen)
        raw['appraisal']['bindings']['aaa_travel'] = raw['appraisal']['bindings'].pop('new_travel')
        raw['inputs']['aaa_travel'] = raw['inputs'].pop('new_travel')
        current['offers'][0]['entry'] = 'aaa_travel'
        renamed = M1Policy(appraisal=AuthoredAppraisal(document=raw, program=program(raw)))
        renamed.start(current, 'decisive_explorer')
        self.assertEqual(renamed.select(current).candidate.index, chosen)

    def test_low_resource_pause_is_not_hardwired_to_help_feature_name(self):
        raw, current = document(), frame()
        rule = raw['appraisal']['definitions']['inspect_floor']
        rule['values']['torch_spend'] = 1
        current['offers'] = current['offers'][2:3]
        current['fields']['everflameCharges'] = 2
        policy = M1Policy(appraisal=AuthoredAppraisal(document=raw, program=program(raw)))
        policy.start(current, 'cautious_investigator')
        self.assertIsNone(policy.select(current))
        self.assertIn('永焰', policy.run.reason)
