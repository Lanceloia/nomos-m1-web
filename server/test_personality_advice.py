"""Read-only suggestions share the actual public-frame policy decision."""
from copy import deepcopy
from http.server import ThreadingHTTPServer
import json
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from server.bridge import ApiError, Bridge, make_handler
from server.m1_policy import M1Policy
from server import test_policy_execution as fixtures

frame = fixtures.frame


class AdviceTests(unittest.TestCase):
    def test_each_personality_matches_fresh_delegation_and_does_not_mutate(self):
        for name in M1Policy().profiles:
            with self.subTest(personality=name):
                policy, current = M1Policy(), frame()
                before = deepcopy(current)
                memory = self.memory(policy)
                advice = policy.advice(current, name)
                self.assertEqual(self.memory(policy), memory)
                self.assertEqual(current, before)
                self.assertIsNone(policy.run)
                policy.start(current, name)
                actual = policy.select(current)
                self.assertEqual(advice['choice']['index'], actual.candidate.index)
                self.assertEqual(advice['choice']['score'], actual.score)
                self.assertEqual(advice['choice']['reason'], actual.reason)
                self.assertEqual(advice['plan'], policy.run.plan)

    @staticmethod
    def memory(policy):
        return deepcopy({key: value for key, value in vars(policy).items()
                         if key not in {'appraisal', 'planner', 'profiles', 'feature_labels'}})

    def test_deviation_manual_history_and_current_offer_indexes_drive_recommendation(self):
        policy, current = M1Policy(), frame()
        first = policy.advice(current, 'cautious_investigator')['choice']
        self.assertEqual(first['index'], 42)
        # Model the already-supported episode memory of a manual inspection.
        key = policy.key(current, current['offers'][2])
        policy.visited.add(key)
        policy.remember_choice(current, current, key)
        current['offers'][3]['index'] = 200
        current['time'] = 700
        current['private_world'] = {'answer': 'hidden'}
        result = policy.advice(current, 'cautious_investigator')['choice']
        self.assertEqual(result['index'], 200)
        policy.start(current, 'cautious_investigator')
        self.assertEqual(result['index'], policy.select(current).candidate.index)

    def test_stopped_policy_is_not_resumed_reset_or_written_by_preview(self):
        policy, current = M1Policy(), frame()
        policy.start(current, 'decisive_explorer')
        policy.halt(current, 'cancelled', 'Stopped by player')
        memory = self.memory(policy)
        for name in policy.profiles:
            policy.advice(current, name)
        self.assertEqual(self.memory(policy), memory)

    def test_terminal_and_manual_only_options_have_no_fabricated_choice(self):
        policy, current = M1Policy(), frame()
        current['ending'] = {'id': 'departed_palace'}
        self.assertIsNone(policy.advice(current, 'helpful_rescuer')['choice'])
        current['ending'] = None
        current['offers'] = [{'index': 8, 'entry': 'strike_person_adventurer', 'label': 'Strike'}]
        result = policy.advice(current, 'helpful_rescuer')
        self.assertIsNone(result['choice'])
        self.assertIn('亲自选择', result['reason'])

    def test_resource_reserve_uses_the_same_setting_as_delegation(self):
        policy, current = M1Policy(), frame()
        current['fields']['everflameCharges'] = 2
        current['observations'] = [{'id': 'p', 'kind': 'person', 'site': 'a', 'state': 'frozen',
                                    'detailRecordedAt': {'time': 0, 'revision': 0}}]
        current['offers'] = [{'index': 7, 'entry': 'thaw_person_adventurer', 'label': 'Thaw', 'targetIds': ['p']}]
        for safety in (True, False):
            advice = policy.advice(current, 'helpful_rescuer', stop_on_unexpected=safety)
            self.assertEqual(advice['stopOnUnexpected'], safety)
            actual = M1Policy()
            actual.start(current, 'helpful_rescuer', stop_on_unexpected=safety)
            selected = actual.select(current)
            self.assertEqual(advice['choice'] is None, selected is None)
        self.assertIsNone(policy.advice(current, 'helpful_rescuer')['choice'])
        self.assertIsNotNone(policy.advice(current, 'helpful_rescuer', stop_on_unexpected=False)['choice'])

    def test_bridge_read_never_calls_world_or_changes_revision_ledger(self):
        game = fixtures.ControlTests().game()
        before = game.response()
        body = dict(revision=0, policyRevision=0, intentId='helpful_rescuer', stopOnUnexpected=True)
        with patch.object(game, 'mutate', side_effect=AssertionError('World mutation')):
            first = game.advice(body)
            self.assertEqual(first, game.advice(body))
        self.assertEqual(game.response(), before)
        first['choice']['index'] = -1
        self.assertNotEqual(game.advice(body)['choice']['index'], -1)

    def test_bridge_rejects_stale_wrong_settings_running_and_faulted(self):
        body = dict(revision=0, policyRevision=0, intentId='helpful_rescuer', stopOnUnexpected=True)
        for changes, status in [({'revision': 1}, 409), ({'revision': True}, 409),
                                ({'policyRevision': 1}, 409), ({'intentId': 'foreign'}, 400),
                                ({'intentId': []}, 400), ({'stopOnUnexpected': 1}, 400)]:
            with self.subTest(changes=changes):
                game = fixtures.ControlTests().game()
                with self.assertRaises(ApiError) as error:
                    game.advice({**body, **changes})
                self.assertEqual(error.exception.status, status)
                self.assertFalse(game.faulted)
        game = fixtures.ControlTests().game()
        game.policy.start(game.frame, 'helpful_rescuer')
        with self.assertRaises(ApiError):
            game.advice(body)
        game.policy.halt(game.frame, 'cancelled', 'Stopped')
        game.faulted = True
        with self.assertRaises(ApiError):
            game.advice(body)

    def test_http_advice_route_is_read_only_and_stale_requests_are_finite(self):
        game = fixtures.ControlTests().game()
        game.lock = threading.Lock()
        bridge = Bridge(None, None)
        bridge.games[game.session_id] = game
        http = ThreadingHTTPServer(('127.0.0.1', 0), make_handler(bridge))
        worker = threading.Thread(target=http.serve_forever)
        worker.start()
        url = f'http://127.0.0.1:{http.server_port}/api/sessions/fixture/advice'
        body = dict(revision=0, policyRevision=0, intentId='helpful_rescuer', stopOnUnexpected=True)
        def request(value):
            return Request(url, data=json.dumps(value).encode(), headers={'Content-Type': 'application/json'})
        before = game.response()
        try:
            with urlopen(request(body), timeout=5) as response:
                result = json.load(response)
            self.assertEqual(result['choice'], game.advice(body)['choice'])
            with self.assertRaises(HTTPError) as error:
                urlopen(request({**body, 'revision': 1}), timeout=5)
            self.assertEqual(error.exception.code, 409)
            error.exception.close()
            self.assertEqual(game.response(), before)
        finally:
            http.shutdown()
            worker.join(timeout=5)
            http.server_close()
