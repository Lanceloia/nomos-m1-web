"""Short menu and lifecycle regressions, independent of full adventure replay."""
import copy
import json
from dataclasses import dataclass
import unittest

import yaml

from server.runtime import WORLD_ROOT, install_roots
from server.m1_policy import M1Policy
from server.test_policy_execution import frame
from server import test_w1_feedback

install_roots()
from nomos_c0.composable_value_v1 import C0ValuePorts, compile_value_program
from nomos_c0.condition_source_v0 import lower_author_expression
from nomos_c0.author_contract_v1 import C0BindingError
from nomos_kernel._identity import K0SourceSpecKey
from nomos_kernel._settlement_outcome_abi import K0NotAdmitted


@dataclass(frozen=True)
class Path:
    start: str
    end: str
    base_move_cost: int


@dataclass(frozen=True)
class Observer:
    site: str
    ritual_notice: str
    sighting_ref: int
    known_paths: tuple[Path, ...]


@dataclass(frozen=True)
class Person:
    name: str
    site: str


class RitualMenuTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        data = yaml.safe_load((WORLD_ROOT / 'source/control/seats.yaml').read_text())
        seat = next(row for row in data['seats'] if row.get('name') == 'adventurer')
        offer = next(row for row in seat['offers'] if row.get('entry') == 'carry_from_ritual_adventurer')
        records = {'Observer': Observer, 'Person': Person, 'Path': Path}
        fields = {record: frozenset(record.__annotations__) for record in records.values()}
        paths = frozenset({'actor.site', 'actor.ritual_notice', 'actor.sighting_ref',
                           'actor.known_paths', 'candidate.name', 'candidate.site'})
        ports = C0ValuePorts(roots={'actor': Observer, 'candidate': Person},
            readable_paths=paths, admission_readable_paths=paths,
            readable_fields=fields, admission_readable_fields=fields,
            writable_fields={}, record_types=records,
            tuple_fields={}, admission_tuple_fields={}, collection_keys={},
            outputs={'allowed': bool})
        cls.program = compile_value_program(json.dumps({'schema': 'c0.value.v1',
            'bindings': [], 'guard': {'const': True},
            'outputs': {'allowed': lower_author_expression(offer['when'])[0]}}), ports,
            admission_outputs=frozenset({'allowed'}))

    def allowed(self, name, notice='active', site='ritual_ring'):
        actor = Observer('ritual_ring', notice, 1, (Path('ritual_ring', 'ritual_threshold', 10000),))
        return self.program.evaluate_admission_outputs(
            {'actor': actor, 'candidate': Person(name, site)})['allowed']

    def test_only_ritual_target_is_offered_not_observed_bokolds(self):
        self.assertTrue(self.allowed('ritual_resident'))
        for name in ('bokold_one', 'bokold_two', 'huddled_one'):
            self.assertFalse(self.allowed(name))

    def test_locally_completed_or_disrupted_ritual_has_no_intervention_offer(self):
        for notice in ('erupted', 'disrupted'):
            self.assertFalse(self.allowed('ritual_resident', notice))

    def test_remote_target_has_no_intervention_offer(self):
        self.assertFalse(self.allowed('ritual_resident', site='ritual_threshold'))


class LifecyclePolicyTests(unittest.TestCase):
    def transition(self, **changes):
        before, policy = frame(), M1Policy()
        policy.start(before, 'decisive_explorer', stop_on_unexpected=False)
        selected = policy.select(before)
        after = copy.deepcopy(before)
        after['fields'].update(changes)
        after['feedback'] = {'status': 'published'}
        policy.record(selected, before, after, 0, 1)
        return policy, after

    def test_localized_death_is_unconditional_and_explicit(self):
        policy, after = self.transition(life='旅人死亡', lifeState='dead', endurance=0)
        self.assertEqual(policy.run.status, 'stopped')
        self.assertEqual(policy.snapshot(after)['stopDetail']['code'], 'death')
        self.assertIn('死亡', policy.run.reason)
        self.assertIsNone(policy.run.plan)

    def test_incapacitated_and_frozen_never_continue_despite_checkbox(self):
        for fields, code in [({'life': 'Unable to act; needs care', 'lifeState': 'incapacitated'}, 'incapacitated'),
                             ({'coldCondition': 'Frozen', 'coldState': 'frozen'}, 'frozen')]:
            policy, _ = self.transition(**fields)
            self.assertEqual(policy.run.status, 'stopped')
            self.assertEqual(policy.run.stop_detail['code'], code)

    def test_already_terminal_session_cannot_select_another_action(self):
        current, policy = frame(), M1Policy()
        policy.start(current, 'decisive_explorer', stop_on_unexpected=False)
        current['ending'] = {'id': 'adventurer_dead'}
        self.assertIsNone(policy.select(current))
        self.assertEqual(policy.run.stop_detail['code'], 'death')

    def test_nonterminal_injury_can_continue_as_requested(self):
        policy, _ = self.transition(endurance=2)
        self.assertEqual(policy.run.status, 'running')


class LocalStatusProjectionTests(unittest.TestCase):
    def test_actual_k0_refusal_reports_boundary_without_private_rule(self):
        game, _ = test_w1_feedback.FeedbackTransportTests().game()
        game.session.apply_control = lambda _: test_w1_feedback.Record(
            result=K0NotAdmitted(K0SourceSpecKey('test.private-source')))
        response = game.mutate('actions', {'index': 1, 'revision': 0, 'requestId': 'k0'})
        refusal = response['frame']['feedback']['refusal']
        self.assertEqual(refusal, {'code': 'K0_NOT_ADMITTED'})
        self.assertNotIn('private-source', json.dumps(response))

    def test_binding_refusal_does_not_claim_a_failed_k0_rule(self):
        game, _ = test_w1_feedback.FeedbackTransportTests().game(
            C0BindingError('private guard or object identity'))
        response = game.mutate('actions', {'index': 1, 'revision': 0, 'requestId': 'binding'})
        self.assertEqual(response['frame']['feedback']['refusal'],
                         {'code': 'C0_BINDING_REJECTED'})
        self.assertNotIn('private guard', json.dumps(response))

    def test_unrecognized_nonpublication_is_not_mislabeled_as_k0_refusal(self):
        game, _ = test_w1_feedback.FeedbackTransportTests().game()
        response = game.mutate('actions', {'index': 1, 'revision': 0, 'requestId': 'unknown'})
        self.assertEqual(response['frame']['feedback']['refusal'],
                         {'code': 'UNPUBLISHED_RESULT'})

    def test_semantic_status_does_not_depend_on_localized_hud(self):
        game, _ = test_w1_feedback.FeedbackTransportTests().game()
        game.engine_frame.view.fields = (('adventurer.site', 'room'),
            ('adventurer.vital.life', 'incapacitated'), ('adventurer.cold_state', 'mobile'))
        game.terms = {'incapacitated': 'Unable to act; needs care', 'mobile': 'Able to move'}
        visible = game.render()['fields']
        self.assertEqual(visible['life'], 'Unable to act; needs care')
        self.assertEqual(visible['lifeState'], 'incapacitated')
        self.assertEqual(visible['coldState'], 'mobile')

    def test_refused_submission_does_not_publish_or_spend_time(self):
        game, _ = test_w1_feedback.FeedbackTransportTests().game()
        before = copy.deepcopy(game.frame['fields'])
        response = game.mutate('actions', {'index': 1, 'revision': 0, 'requestId': 'refused'})
        self.assertEqual(response['frame']['feedback']['status'], 'rejected')
        self.assertEqual(response['frame']['time'], 7)
        self.assertEqual(response['frame']['fields'], before)
        self.assertIsNone(response['frame']['actionRecord'])


if __name__ == '__main__':
    unittest.main()
