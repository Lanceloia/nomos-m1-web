"""Short contracts; fixtures test transport order, not world gameplay."""
import unittest
from types import SimpleNamespace as R
from unittest.mock import patch

from server.projection import scalar_records
from server.test_w1_feedback import FeedbackTransportTests


class DisplayV2Tests(unittest.TestCase):
    def game(self):
        game, calls = FeedbackTransportTests().game()
        game.presentation.fields = (('a', 'A'), ('b', 'B'), ('missing', 'Missing'))
        game.presentation.published_fields = (('move', ('a', 'b', 'missing')),)
        game.presentation.finish_fields = (('leave', ('a', 'b')),)
        game.display_history, game.display_sequence = {}, 0
        game.session.time = 7
        return game, calls

    def test_zero_false_missing_and_foreign_scalar_failure(self):
        game, _ = self.game()
        self.assertEqual(scalar_records(('a', 'b', 'missing'), (('a', 0), ('b', False)), game.presentation, {}),
                         [{'label': 'A', 'value': 0}, {'label': 'B', 'value': False}, {'label': 'Missing'}])
        with self.assertRaises(ValueError):
            scalar_records(('a',), (('a', R(secret=1)),), game.presentation, {})

    def test_publication_reads_before_continuation_and_same_value_repeats(self):
        game, calls = self.game()
        events = []
        game.session.apply_control = lambda command: R(result=R(occurrences=(R(occurrence=len(events)),)))
        game.session.read = lambda seat: self.fail('Immediate record must use the current frame')
        immediate = R(view=R(fields=(('a', 0), ('b', False))), time=7, finished=False)
        game.session.form_frame = lambda seat: events.append('form') or immediate
        game.session.continue_form = lambda seat: events.append('continue') or game.engine_frame
        with patch('server.bridge.K0Published', R):
            first = game.mutate('actions', {'index': 1, 'revision': 0, 'requestId': 'one'})
            second = game.mutate('actions', {'index': 1, 'revision': 1, 'requestId': 'two'})
        self.assertEqual(events, ['form', 'continue', 'form', 'continue'])
        self.assertEqual(first['frame']['actionRecord'], second['frame']['actionRecord'])
        self.assertEqual(len(second['frame']['history']['leave']['records']), 4)
        self.assertNotIn('value', first['frame']['actionRecord']['fields'][-1])
        self.assertEqual(game.mutate('actions', {'index': 1, 'revision': 1, 'requestId': 'two'}), second)
        self.assertEqual(len(events), 4)

    def test_immediate_frame_failure_does_not_start_automatic_transitions(self):
        from server.bridge import C0BindingError
        game, _ = self.game()
        game.session.apply_control = lambda command: R(result=R(occurrences=(R(occurrence=1),)))
        def fail(seat):
            raise C0BindingError('Current read failed after publication')
        game.session.form_frame = fail
        game.session.continue_form = lambda seat: self.fail('Must not advance after read failure')
        with patch('server.bridge.K0Published', R), self.assertRaises(C0BindingError):
            game.mutate('actions', {'index': 1, 'revision': 0, 'requestId': 'one'})
        self.assertEqual(game.revision, 0)
        self.assertIsNone(game.feedback)

    def test_immediate_record_failure_does_not_start_automatic_transitions(self):
        game, _ = self.game()
        game.session.apply_control = lambda command: R(result=R(occurrences=(R(occurrence=1),)))
        game.session.form_frame = lambda seat: R(view=R(fields=(('a', R(secret=1)),)),
                                                time=7, finished=False)
        game.session.continue_form = lambda seat: self.fail('Must not advance after record failure')
        with patch('server.bridge.K0Published', R), self.assertRaises(ValueError):
            game.mutate('actions', {'index': 1, 'revision': 0, 'requestId': 'one'})
        self.assertEqual(game.revision, 0)

    def test_immediate_terminal_frame_is_reused_without_read_or_advance(self):
        game, _ = self.game()
        game.engine_frame.finished = True
        game.engine_frame.outcome = 'departed_palace'
        game.session.apply_control = lambda command: R(result=R(occurrences=(R(occurrence=1),)))
        game.session.read = lambda seat: self.fail('Must not reread the terminal frame')
        game.session.continue_form = lambda seat: self.fail('Must not advance a finished world')
        with patch('server.bridge.K0Published', R):
            result = game.mutate('actions', {'index': 1, 'revision': 0, 'requestId': 'one'})
        self.assertIsNotNone(result['frame']['ending'])
        self.assertEqual(result['frame']['feedback']['status'], 'published')

    def test_refusal_has_no_read_or_success_record(self):
        game, _ = self.game()
        game.session.read = lambda seat: self.fail('Refusal must not read published record')
        response = game.mutate('actions', {'index': 1, 'revision': 0, 'requestId': 'one'})
        self.assertIsNone(response['frame']['actionRecord'])
        self.assertEqual(response['frame']['feedback']['status'], 'rejected')

    def test_history_is_bounded_deduped_and_response_is_immutable(self):
        game, _ = self.game()
        for n in range(65):
            game.remember_visible((('a', n), ('b', False)), n)
        game.frame = game.render()
        original = game.response()
        game.remember_visible((('a', 64), ('b', False)), 100)
        self.assertEqual(len(game.display_history['leave']['records']), 64)
        self.assertTrue(game.display_history['leave']['truncated'])
        game.remember_visible((('a', 65), ('b', False)), 101)
        self.assertEqual(original['frame']['history']['leave']['records'][-1]['fields'][0]['value'], 64)
        game.response()
        game.response()
        self.assertEqual(len(game.display_history['leave']['records']), 64)

    def test_ending_matches_entry_and_outcome_not_first_outcome(self):
        game, _ = self.game()
        game.presentation.finish_on_action = (('wrong', 'departed_palace', 'Wrong'), ('move', 'departed_palace', 'Correct'))
        game.engine_frame.finished = True
        game.engine_frame.outcome = 'departed_palace'
        game.finish_entry = 'move'
        self.assertEqual(game.render()['ending']['engineText'], 'Correct')
        game.finish_entry = None
        self.assertIsNone(game.render()['ending']['engineText'])

    def test_cleared_observation_records_missing_instead_of_retaining_current_values(self):
        game, _ = self.game()
        game.remember_visible((), 0)
        self.assertEqual(game.display_history, {})
        game.remember_visible((('a', 'person'), ('b', False)), 1)
        game.remember_visible((), 2)
        rows = game.display_history['leave']['records']
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[-1]['fields'], [{'label': 'A'}, {'label': 'B'}])
        game.remember_visible((), 3)
        self.assertEqual(len(rows), 2)

    def test_reset_clears_history_and_records(self):
        game, _ = self.game()
        game.remember_visible((('a', 1), ('b', False)), 7)
        game.presentation.terms = ()
        game.presentation.opening = 'Opening'
        game.presentation.title = 'Title'
        session = R(human_seats=lambda: ('seat',), continue_form=lambda seat: game.engine_frame)
        game.program = R(start=lambda assets: session, seats=(R(symbol='seat', presentation=game.presentation),))
        game.assets = {}
        game.appraisal = None
        from unittest.mock import patch
        from server.authored_appraisal import AuthoredAppraisal
        with patch('server.bridge.AuthoredAppraisal', return_value=AuthoredAppraisal()):
            game.reset()
        self.assertEqual(game.display_history, {})
        self.assertIsNone(game.action_record)
        self.assertIsNone(game.finish_entry)
