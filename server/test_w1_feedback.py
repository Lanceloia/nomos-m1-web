"""W1 projection/transport branches. Stubs here do not prove engine gameplay."""
import json
import unittest
from collections import OrderedDict
from email.message import Message
from io import BytesIO
from threading import Lock
from types import SimpleNamespace as Record

from server.bridge import ApiError, Bridge, C0BindingError, Game, make_handler
from server.projection import action_feedback, offer_forecasts
from server.player_information import PlayerInformation
from server.m1_policy import M1Policy
from server.play_report import PlayLedger, ScoreRules


def presentation(**changes):
    return Record(published='Generic publication', rejected='Generic refusal', finish_on_action=(),
                  published_actions=(('move', 'Attempt published; check actual position.'),),
                  rejected_actions=(('move', 'Attempt did not start.'),),
                  preview_fields=(('move', (('cost', 'Cost'), ('covered', 'Covered'), ('missing', 'Missing'))),), **changes)


def offer(entry='move', preview=()):
    return Record(entry=entry, label='Attempt passage', label_fragments=(), payload=(), preview=preview)


class ForecastTests(unittest.TestCase):
    def test_zero_false_unknown_and_unlabelled_data(self):
        current = offer(preview=(('cost', 0), ('covered', False), ('hidden_ref', object())))
        self.assertEqual(offer_forecasts(current, presentation(), {}), [
            {'label': 'Cost', 'value': 0}, {'label': 'Covered', 'value': False}, {'label': 'Missing'}])

    def test_refs_records_and_payload_are_never_forecast_sources(self):
        current = offer(preview=(('cost', object()), ('covered', Record(secret=42))))
        current.payload = (('cost', 99), ('covered', True))
        result = offer_forecasts(current, presentation(), {})
        self.assertTrue(all('value' not in item for item in result))
        self.assertNotIn('secret', json.dumps(result))

    def test_missing_declaration_and_missing_preview_keep_choice(self):
        self.assertEqual(offer_forecasts(offer('other'), presentation(), {}), [])
        self.assertEqual(len(offer_forecasts(offer(), presentation(), {})), 3)

    def test_terms_translate_only_preview_strings(self):
        current = offer(preview=(('cost', 'covered'), ('covered', False)))
        result = offer_forecasts(current, presentation(), {'covered': 'In the light'})
        self.assertEqual(result[0]['value'], 'In the light')
        self.assertIs(result[1]['value'], False)

    def test_action_specific_messages_and_supported_fallback(self):
        self.assertEqual(action_feedback(offer(), presentation(), {}, True)['text'], 'Attempt published; check actual position.')
        self.assertEqual(action_feedback(offer(), presentation(), {}, False)['text'], 'Attempt did not start.')
        self.assertEqual(action_feedback(offer('other'), presentation(), {}, True)['text'], 'Generic publication')
        self.assertEqual(action_feedback(offer('other'), presentation(), {}, False)['status'], 'rejected')


class FeedbackTransportTests(unittest.TestCase):
    def game(self, failure=None):
        game = Game.__new__(Game)
        game.presentation, game.terms, game.labels = presentation(), {}, {}
        game.session_id, game.revision = 'test', 0
        game.policy, game.policy_revision = M1Policy(), 0
        game.completed, game.journal = OrderedDict(), []
        game.feedback, game.faulted, game.lock = None, False, Lock()
        game.observation_ids, game.player_information = {}, PlayerInformation()
        game.engine_frame = Record(view=Record(fields=(('adventurer.site', 'room'),)),
                                   offers=(offer(),), finished=False, time=7)
        game.frame = game.render()
        game.score_rules = ScoreRules()
        game.play_ledger = PlayLedger(game.frame, game.score_rules)
        calls = []
        def submit(command):
            calls.append(command)
            if failure:
                raise failure
            return Record(result=object())
        game.session = Record(apply_control=submit, form_frame=lambda _seat: game.engine_frame)
        game.seat = 'adventurer'
        return game, calls

    def test_nonpublication_is_refusal_and_retries_do_not_submit_again(self):
        game, calls = self.game()
        body = {'index': 1, 'revision': 0, 'requestId': 'once'}
        response = game.mutate('actions', body)
        self.assertEqual(response['frame']['feedback']['status'], 'rejected')
        self.assertEqual(response['frame']['feedback']['text'],
                         '本次提交未取得可识别的结算结果。请同步当前状态后核对。')
        self.assertEqual(response['frame']['time'], 7)
        self.assertEqual(game.mutate('actions', body), response)
        self.assertEqual(len(calls), 1)
        with self.assertRaises(ApiError):
            game.mutate('actions', {**body, 'requestId': 'stale'})
        self.assertEqual(len(calls), 1)
        self.assertEqual(game.response(), response)

    def test_binding_refusal_uses_the_submitted_entry_message(self):
        game, _ = self.game(C0BindingError('Opportunity changed'))
        response = game.mutate('actions', {'index': 1, 'revision': 0, 'requestId': 'once'})
        self.assertEqual(response['frame']['feedback']['text'], 'Attempt did not start.')
        self.assertTrue(any(entry['text'] == 'Attempt did not start.' for entry in response['entries']))

    def test_service_defect_is_http_500_not_a_refused_world_action(self):
        game, _ = self.game(RuntimeError('Service defect'))
        bridge = Bridge(None, None)
        bridge.games['test'] = game
        handler = make_handler(bridge).__new__(make_handler(bridge))
        handler.command, handler.path = 'POST', '/api/sessions/test/actions'
        body = json.dumps({'index': 1, 'revision': 0, 'requestId': 'once'}).encode()
        handler.headers = Message()
        handler.headers['Content-Type'] = 'application/json'
        handler.headers['Content-Length'] = str(len(body))
        handler.rfile = BytesIO(body)
        responses = []
        handler.send_json = lambda status, value: responses.append((status, value))
        with self.assertLogs(level='ERROR'):
            handler.dispatch()
        self.assertEqual(responses[0][0], 500)
        self.assertNotIn('frame', responses[0][1])
        self.assertTrue(game.faulted)
        self.assertIsNone(game.feedback)


if __name__ == '__main__':
    unittest.main()
