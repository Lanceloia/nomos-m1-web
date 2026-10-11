"""Short public-frame policy contracts; fixtures are not world acceptance."""
import copy
import unittest
from collections import OrderedDict
from dataclasses import replace
from unittest.mock import patch

from server.bridge import ApiError, Game
from server.m1_policy import M1Policy, load_profiles
from server.policy_execution import Candidate, choose
from server.player_information import PlayerInformation
from server.play_report import PlayLedger, ScoreRules


def frame():
    return {"time": 0, "fields": {"locationId": "a", "life": "alive", "lifeState": "alive", "coldState": "mobile", "endurance": 3,
            "movementSpeed": 100, "coldCondition": "normal", "everflameCharges": 5,
            "carriedReservoirCharges": 2, "gold": 0}, "ending": None,
            "scene": {"knownSites": ["a", "b", "c"], "siteLabels": {"b": "B", "c": "C"},
                      "routes": []},
            "information": {"visibleEntities": [], "ritual": {"phase": "unknown"}}, "observations": [],
            "offers": [{"index": 71, "entry": "move_adventurer", "label": "Walk B", "destination": "b", "movementKind": "walk"},
                       {"index": 13, "entry": "move_adventurer", "label": "Walk C", "destination": "c", "movementKind": "walk"},
                       {"index": 42, "entry": "observe_floor_adventurer", "label": "Floor"},
                       {"index": 2, "entry": "observe_routes_adventurer", "label": "Routes"},
                       {"index": 99, "entry": "reload_everflame_adventurer", "label": "Refill"}]}


class ScoreTests(unittest.TestCase):
    def test_failed_evidence_is_serialized_once_per_pass_and_refreshed_next_pass(self):
        policy, current = M1Policy(), frame()
        current['offers'] = [dict(current['offers'][0], index=index, destination=f'place-{index}')
                             for index in range(20)]
        original = policy._candidates_for_plans(current, 'decisive_explorer', (), [])
        with patch.object(policy, 'attempt_context', wraps=policy.attempt_context) as context:
            self.assertEqual(policy._candidates_for_plans(current, 'decisive_explorer', (), []), original)
            self.assertFalse(policy.failed_attempt(current, current['offers'][0]))
            context.assert_not_called()

        offer = current['offers'][0]
        policy.failed_attempts.add((offer['entry'], policy.key(current, offer), policy.attempt_context(current)))
        with patch.object(policy, 'attempt_context', wraps=policy.attempt_context) as context:
            candidates = policy._candidates_for_plans(current, 'decisive_explorer', (), [])
            context.assert_called_once_with(current)
        self.assertEqual([row.index for row in candidates], list(range(1, 20)))

        current['observations'] = [{'id': 'floor', 'kind': 'floor', 'site': 'a',
                                    'state': 'normal', 'facts': []}]
        with patch.object(policy, 'attempt_context', wraps=policy.attempt_context) as context:
            candidates = policy._candidates_for_plans(current, 'decisive_explorer', (), [])
            context.assert_called_once_with(current)
        self.assertIn(0, [row.index for row in candidates])

    def test_manual_refusal_is_shared_by_advice_and_all_profiles_until_evidence_changes(self):
        before = frame()
        before['offers'] = before['offers'][:1]
        offer = before['offers'][0]
        after = copy.deepcopy(before)
        after['feedback'] = {'status': 'rejected', 'refusal': {'code': 'K0_NOT_ADMITTED'}}
        policy = M1Policy()
        ledger = PlayLedger(before, ScoreRules())
        policy.observe_episode(after, ledger, offer, before, False)
        for profile in policy.profiles:
            self.assertIsNone(policy.advice(after, profile)['choice'])
        same = copy.deepcopy(after)
        same['time'] = 1000
        same['offers'][0]['index'] = 200
        self.assertIsNone(policy.advice(same, 'decisive_explorer')['choice'])
        self.assertEqual(same['offers'][0]['index'], 200)
        changed = copy.deepcopy(same)
        changed['observations'] = [{'id': 'floor', 'kind': 'floor', 'site': 'a',
            'state': 'normal', 'facts': []}]
        self.assertEqual(policy.advice(changed, 'decisive_explorer')['choice']['index'], 200)
        preview = copy.deepcopy(same)
        preview['offers'][0]['forecasts'] = [{'label': 'Public path', 'value': 'clear'}]
        self.assertEqual(policy.advice(preview, 'decisive_explorer')['choice']['index'], 200)

    def test_ignored_world_refusal_chooses_another_candidate_not_a_repeat(self):
        policy, before = M1Policy(), frame()
        before['offers'] = before['offers'][:2]
        policy.start(before, 'decisive_explorer', stop_on_unexpected=False)
        selected = policy.select(before)
        after = copy.deepcopy(before)
        after['feedback'] = {'status': 'rejected', 'refusal': {'code': 'K0_NOT_ADMITTED'}}
        policy.record(selected, before, after, 0, 1)
        self.assertEqual(policy.run.status, 'running')
        self.assertNotEqual(policy.select(after).candidate.index, selected.candidate.index)
        self.assertEqual(policy.run.steps, [])

    def test_binding_and_unknown_publication_stop_even_when_surprises_are_ignored(self):
        for code in ('C0_BINDING_REJECTED', 'UNPUBLISHED_RESULT'):
            policy, before = M1Policy(), frame()
            policy.start(before, 'decisive_explorer', stop_on_unexpected=False)
            selected = policy.select(before)
            after = copy.deepcopy(before)
            after['feedback'] = {'status': 'rejected', 'refusal': {'code': code}}
            policy.record(selected, before, after, 0, 1)
            self.assertEqual(policy.run.status, 'stopped')
            self.assertEqual(policy.run.stop_detail['code'], 'submission_failed')
            self.assertEqual(policy.run.steps, [])

    def test_navigation_check_precedes_untargeted_survey_without_erasing_manual_offer(self):
        current = frame()
        current['offers'] = [current['offers'][3], {'index': 8,
            'entry': 'observe_foxes_adventurer', 'label': 'Look for foxes'}]
        for profile in ('cautious_investigator', 'helpful_rescuer', 'decisive_explorer'):
            policy = M1Policy()
            policy.start(current, profile)
            self.assertEqual(policy.select(current).candidate.index, 2)
            self.assertEqual(len(current['offers']), 2)
        current['offers'] = current['offers'][1:]
        policy = M1Policy()
        policy.start(current, 'cautious_investigator')
        self.assertEqual(policy.select(current).candidate.index, 8)

    def test_navigation_check_does_not_hide_targeted_person_inspection(self):
        current = frame()
        current['offers'] = [current['offers'][3], {'index': 8,
            'entry': 'observe_resident_adventurer', 'label': 'Check resident',
            'targetIds': ['person']}]
        current['information']['visibleEntities'] = [{'id': 'person', 'kind': 'person', 'site': 'a'}]
        policy = M1Policy()
        policy.start(current, 'helpful_rescuer')
        self.assertIn(8, [row.index for row in policy.candidates(current, 'helpful_rescuer')])
        self.assertIsNotNone(policy.select(current))

    def test_known_dead_person_is_not_an_escort_goal_but_unknown_presence_can_be(self):
        current = frame()
        current['offers'] = [{'index': 3, 'entry': 'offer_escort_adventurer', 'label': 'Invite'}]
        current['information']['visibleEntities'] = [{'id': 'person', 'kind': 'person'}]
        current['observations'] = [{'id': 'person', 'kind': 'person', 'state': 'dead'}]
        policy = M1Policy()
        self.assertEqual(policy.candidates(current, 'cautious_investigator'), [])
        current['observations'][0]['state'] = 'unknown'
        self.assertEqual([row.index for row in policy.candidates(current, 'cautious_investigator')], [3])

    def test_paired_crossing_does_not_treat_old_clear_floor_as_current_admission(self):
        current = frame()
        current['observations'] = [{'id': 'floor', 'kind': 'floor', 'site': 'a',
            'state': 'normal', 'recordedAt': {'time': 500, 'revision': 5}}]
        current['time'] = 900
        current['offers'] = [current['offers'][0], {'index': 4,
            'entry': 'cross_ice_adventurer', 'label': 'Cross toward B',
            'destination': 'b', 'movementKind': 'ice'}]
        for profile in ('cautious_investigator', 'helpful_rescuer', 'decisive_explorer'):
            policy = M1Policy()
            policy.start(current, profile)
            self.assertEqual(policy.select(current).candidate.index, 4)
        self.assertEqual(len(current['offers']), 2)

    def test_crossing_preference_is_same_destination_only_and_can_learn_refusal(self):
        current = frame()
        current['offers'] = [current['offers'][0], {'index': 4,
            'entry': 'cross_ice_adventurer', 'label': 'Cross toward C',
            'destination': 'c', 'movementKind': 'ice'}]
        policy = M1Policy()
        self.assertIn(71, [row.index for row in policy.candidates(current, 'cautious_investigator')])
        current['offers'][1]['destination'] = 'b'
        key = policy.key(current, current['offers'][1])
        policy.blocked.add(('cross_ice_adventurer', key, policy.public_state(current)))
        self.assertEqual([row.index for row in policy.candidates(current, 'cautious_investigator')], [71])
        current['offers'][1]['entry'] = 'unsupported_crossing'
        self.assertEqual([row.index for row in policy.candidates(current, 'cautious_investigator')], [71])

    def test_same_options_different_personality_not_different_goal(self):
        current = frame()
        current["fields"]["everflameCharges"] = 5
        choices = {}
        for name in ("cautious_investigator", "helpful_rescuer", "decisive_explorer"):
            policy = M1Policy()
            policy.start(current, name)
            choices[name] = policy.select(current).candidate.entry
        self.assertEqual(choices, {"cautious_investigator": "observe_floor_adventurer",
                                  "helpful_rescuer": "observe_routes_adventurer",
                                  "decisive_explorer": "move_adventurer"})

    def test_current_indexes_and_private_values(self):
        policy, current = M1Policy(), frame()
        current["fields"]["everflameCharges"] = 3
        original = policy.candidates(current, "cautious_investigator")
        current["private_world"] = {"solution": "hidden"}
        self.assertEqual(original, policy.candidates(current, "cautious_investigator"))
        policy.start(current, "cautious_investigator")
        current["offers"][4]["index"] = 120
        self.assertEqual(policy.select(current).candidate.index, 120)

    def test_same_entry_ties_are_stable_but_different_actions_return_control(self):
        first = Candidate(999, "walk", "B", ("a", "walk", "b", ()), {"explore": 1}, "travel")
        second = replace(first, index=1, key=("a", "walk", "c", ()))
        for candidates in ([first, second], [second, first]):
            self.assertEqual(choose(candidates, {"explore": 1}, stable_peers=True)[0].candidate.index, 999)
        self.assertIsNone(choose([first, replace(second, meaning="other")],
                                 {"explore": 1}, stable_peers=True)[0])

    def test_indistinguishable_public_peer_keys_never_fall_back_to_offer_order(self):
        first = Candidate(71, "walk", "Walk", ("a", "walk", "b", ()), {"explore": 1}, "travel")
        second = replace(first, index=13)
        for candidates in ([first, second], [second, first]):
            self.assertIsNone(choose(candidates, {"explore": 1}, stable_peers=True)[0])

    def test_real_ritual_projection_completion_stops(self):
        policy, before = M1Policy(), frame()
        policy.start(before, "cautious_investigator")
        after = copy.deepcopy(before)
        memory = PlayerInformation()
        memory.capture([], "erupted", 100, 1)
        after["information"] = memory.snapshot()
        self.assertEqual(after["information"]["ritual"]["phase"], "completed")
        after["feedback"] = {"status": "published"}
        policy.record(policy.select(before), before, after, 0, 1)
        self.assertEqual(policy.run.status, "stopped")
        self.assertIn("仪式", policy.run.reason)

    def test_unknown_personality_and_unsupported_irreversible_actions(self):
        policy, current = M1Policy(), frame()
        self.assertEqual(policy.candidates(current, "unknown_personality"), [])
        with self.assertRaises(ValueError):
            policy.start(current, "unknown_personality")
        current["offers"] = [{"index": 1, "entry": entry, "label": entry}
                             for entry in ("strike_person_adventurer", "give_torch_adventurer", "wait_adventurer")]
        self.assertEqual(policy.candidates(current, "helpful_rescuer"), [])

    def test_rush_carry_flight_transport_not_ordinary_movement(self):
        policy, current = M1Policy(), frame()
        current["offers"] = current["offers"][:1]
        for kind in ("rush", "carry", "flight", "transport", "climb"):
            current["offers"][0]["entry"] = "unrated_" + kind
            current["offers"][0]["movementKind"] = kind
            self.assertEqual(policy.candidates(current, "decisive_explorer"), [])

    def test_ordinary_people_and_ritual_discovery_rescores_not_stops(self):
        policy, before = M1Policy(), frame()
        policy.start(before, "cautious_investigator")
        after = copy.deepcopy(before)
        after["information"]["visibleEntities"].append({"id": "p", "kind": "person"})
        after["information"]["ritual"]["phase"] = "gathering"
        after["scene"]["routes"] = [{"start": "a", "end": "b"}]
        after["observations"].append({"id": "p", "kind": "person", "site": "a", "state": "unknown"})
        after["offers"].append({"index": 177, "entry": "observe_resident_adventurer",
                                "label": "Person", "targetIds": ["p"]})
        after["feedback"] = {"status": "published"}
        policy.record(policy.select(before), before, after, 0, 1)
        self.assertEqual(policy.run.status, "running")
        # A supplied partial edge list no longer claims every local route was inspected.
        selected = policy.select(after)
        self.assertEqual(selected.candidate.index, 2)
        policy.record(selected, after, after, 1, 2)
        self.assertEqual(policy.select(after).candidate.index, 177)

    def test_more_than_three_steps_and_multiple_categories(self):
        policy, current = M1Policy(), frame()
        current["fields"].update(everflameCharges=0, carriedReservoirCharges=5)
        policy.start(current, "helpful_rescuer")
        for revision in range(5):
            selected = policy.select(current)
            self.assertEqual(selected.candidate.entry, "reload_everflame_adventurer")
            after = copy.deepcopy(current)
            after["fields"]["everflameCharges"] += 1
            after["fields"]["carriedReservoirCharges"] -= 1
            after["time"] += 100
            after["feedback"] = {"status": "published"}
            policy.record(selected, current, after, revision, revision + 1)
            current = after
        self.assertEqual(policy.run.status, "running")
        self.assertEqual(policy.select(current).candidate.entry, "observe_routes_adventurer")

    def test_novel_observations_and_visited_edges_do_not_loop(self):
        policy, current = M1Policy(), frame()
        candidates = policy.candidates(current, "decisive_explorer")
        walk = next(row for row in candidates if row.entry == "move_adventurer")
        policy.places.update(('a', 'b', 'c'))
        self.assertNotIn(walk, policy.candidates(current, "decisive_explorer", {walk.key}))
        current["observations"].append({"id": "floor", "kind": "floor", "site": "a"})
        self.assertFalse(any(row.entry == "observe_floor_adventurer"
                             for row in policy.candidates(current, "cautious_investigator")))
        policy.start(current, "decisive_explorer")
        policy.run.sites.add("b")
        current["offers"][0]["movementKind"] = "ice"
        self.assertFalse(any(row.index == 71 for row in policy.candidates(current, policy.run.intent_id)))

    def test_help_requires_actual_local_observation_and_low_charge_pauses(self):
        policy, current = M1Policy(), frame()
        current["offers"] = [{"index": 88, "entry": "thaw_person_adventurer", "label": "Thaw", "targetIds": ["p"]}]
        self.assertEqual(policy.candidates(current, "helpful_rescuer"), [])
        current["observations"].append({"id": "p", "kind": "person", "state": "frozen", "site": "a"})
        policy.start(current, "helpful_rescuer")
        self.assertEqual(policy.select(current).candidate.index, 88)
        current["fields"]["everflameCharges"] = 2
        self.assertIsNone(policy.select(current))
        self.assertIn("永焰", policy.run.reason)

    def test_expected_thaw_cost_and_new_people_do_not_stop(self):
        policy, before = M1Policy(), frame()
        before["offers"] = [{"index": 88, "entry": "thaw_person_adventurer", "label": "Thaw", "targetIds": ["p"]}]
        before["observations"] = [{"id": "p", "kind": "person", "state": "frozen", "site": "a"}]
        policy.start(before, "helpful_rescuer")
        selected = policy.select(before)
        after = copy.deepcopy(before)
        after["fields"]["everflameCharges"] -= 1
        self.assertIsNone(policy.stop_reason(selected.candidate, before, after))

    def test_injury_unexpected_cost_collision_eruption_ending_stop(self):
        changes = [lambda f: f["fields"].update(endurance=2),
                   lambda f: f["fields"].update(life="dead"),
                   lambda f: f["fields"].update(movementSpeed=90),
                   lambda f: f["fields"].update(gold=5),
                   lambda f: f["information"]["ritual"].update(phase="completed"),
                   lambda f: f.update(ending={"id": "done"}),
                   lambda f: f.update(feedback={"status": "published", "result": {
                       "changes": [{"field": "endurance", "before": 3, "after": 2}],
                       "laterChanges": [{"field": "endurance", "before": 2, "after": 3}]}})]
        for change in changes:
            policy, before = M1Policy(), frame()
            policy.start(before, "cautious_investigator")
            selected = policy.select(before)
            after = copy.deepcopy(before)
            after["feedback"] = {"status": "published"}
            change(after)
            policy.record(selected, before, after, 0, 1)
            self.assertEqual(policy.run.status, "stopped")

    def test_collision_and_rejection(self):
        policy, before = M1Policy(), frame()
        policy.start(before, "decisive_explorer")
        selected = policy.select(before)
        after = copy.deepcopy(before)
        after["feedback"] = {"status": "published"}
        after["fields"]["locationId"] = "collision"
        policy.record(selected, before, after, 0, 1)
        self.assertIn("落点", policy.run.reason)
        policy.start(before, "decisive_explorer")
        after["feedback"]["status"] = "rejected"
        policy.record(policy.select(before), before, after, 0, 1)
        self.assertEqual(policy.run.steps, [])

    def test_safety_cap_not_normal_three_step_limit(self):
        policy, before = M1Policy(), frame()
        policy.start(before, "cautious_investigator")
        policy.run.steps = [{}] * policy.run.limit
        self.assertIsNone(policy.select(before))
        self.assertIn("你设置的", policy.run.reason)

    def test_frozen_floor_replaces_direct_walk_with_path_preparation(self):
        policy, current = M1Policy(), frame()
        current["observations"] = [{"id": "f", "kind": "floor", "site": "a", "state": "frozen"}]
        current["scene"]["routes"] = [{"start": "a", "end": "b"}]
        current["offers"].append({"index": 7, "entry": "thaw_floor_adventurer", "label": "Clear ice", "targetIds": ["f"]})
        policy.start(current, "cautious_investigator")
        selected = policy.select(current)
        self.assertEqual(selected.candidate.index, 2)
        checked = copy.deepcopy(current)
        checked['feedback'] = {'status': 'published'}
        policy.record(selected, current, checked, 0, 1)
        self.assertEqual(policy.select(current).candidate.index, 7)
        self.assertFalse(any(row.entry == "move_adventurer" for row in policy.candidates(current, policy.run.intent_id)))

    def test_known_need_changes_route_score_without_a_script_or_private_goal(self):
        policy, current = M1Policy(), frame()
        current["offers"] = current["offers"][:2]
        current["scene"]["routes"] = [{"start": "b", "end": "d"}]
        current["observations"] = [{"id": "p", "kind": "person", "site": "d", "state": "frozen"}]
        policy.start(current, "helpful_rescuer")
        self.assertEqual(policy.select(current).candidate.index, 71)
        current["observations"][0]["site"] = "c"
        self.assertEqual(policy.select(current).candidate.index, 13)

    def test_invalid_asset(self):
        with patch("server.m1_policy.yaml.safe_load", return_value={"version": 1, "profiles": {}}):
            with self.assertRaises(ValueError):
                load_profiles()


class ControlTests(unittest.TestCase):
    def game(self):
        game = Game.__new__(Game)
        game.frame, game.policy = frame(), M1Policy()
        game.score_rules = ScoreRules()
        game.play_ledger = PlayLedger(game.frame, game.score_rules)
        game.session_id, game.revision, game.journal = "fixture", 0, []
        game.policy_revision = 0
        game.completed, game.faulted = OrderedDict(), False
        return game

    def start(self, game):
        return game.control_policy("start", {"revision": 0, "policyRevision": 0, "requestId": "start", "intentId": "cautious_investigator"})

    def test_start_get_cancel_are_control_only_and_duplicate_is_detached(self):
        game = self.game()
        initial = self.start(game)
        policy_id = initial["policy"]["id"]
        self.assertEqual(game.revision, 0)
        self.assertEqual(game.response()["policy"]["status"], "running")
        game.control_policy("cancel", {"revision": 0, "policyRevision": game.policy_revision, "requestId": "cancel", "policyId": policy_id})
        self.assertEqual(game.revision, 0)
        self.assertEqual(initial["policy"]["status"], "running")
        replay = self.start(game)
        replay["policy"]["steps"].append({"bad": True})
        self.assertEqual(self.start(game)["policy"]["steps"], [])

    def test_wrong_id_revision_request_collision_and_manual_control_reject(self):
        game = self.game()
        self.start(game)
        for operation, body in [("step", {"revision": 0, "requestId": "wrong", "policyId": "foreign"}),
                                ("cancel", {"revision": 1, "requestId": "stale"}),
                                ("cancel", {"revision": 0, "requestId": "start"}),
                                ("start", {"revision": 0, "requestId": "other", "intentId": "decisive_explorer"})]:
            with self.subTest(operation=operation), self.assertRaises(ApiError):
                game.control_policy(operation, {"policyRevision": game.policy_revision, **body})
        for operation in ("actions", "restart"):
            with self.assertRaises(ApiError):
                game.mutate(operation, {"revision": 0, "requestId": "manual", "index": 1, "_delegated": True})

    def test_one_step_one_submit_and_duplicate_never_replays(self):
        game = self.game()
        policy_id = self.start(game)["policy"]["id"]
        def actual_attempt(operation, body, **kwargs):
            self.assertEqual(body["index"], 42)
            self.assertTrue(kwargs["_delegated"])
            game.frame = copy.deepcopy(game.frame)
            game.frame["fields"]["locationId"] = "b"
            game.frame["time"] = 100
            game.frame["feedback"] = {"status": "published"}
            game.revision += 1
        body = {"revision": 0, "policyRevision": game.policy_revision, "requestId": "step", "policyId": policy_id}
        with patch.object(game, "mutate", side_effect=actual_attempt) as action:
            first = game.control_policy("step", body)
            second = game.control_policy("step", body)
            self.assertEqual(action.call_count, 1)
        self.assertEqual(first, second)
        self.assertEqual(first["policy"]["executed"], 1)
        self.assertEqual(first["policy"]["status"], "running")

    def test_world_value_error_is_not_masked_as_a_control_reject(self):
        game = self.game()
        policy_id = self.start(game)["policy"]["id"]
        with patch.object(game, "mutate", side_effect=ValueError("world fault")):
            with self.assertRaisesRegex(ValueError, "world fault"):
                game.control_policy("step", {"revision": 0, "policyRevision": game.policy_revision, "requestId": "step", "policyId": policy_id})

    def test_old_approval_cannot_revive_after_cancel_without_a_world_write(self):
        game = self.game()
        stale = {"revision": 0, "policyRevision": 0, "requestId": "late", "intentId": "decisive_explorer"}
        policy_id = self.start(game)["policy"]["id"]
        game.control_policy("cancel", {"revision": 0, "policyRevision": 1,
                                     "requestId": "cancel", "policyId": policy_id})
        self.assertEqual(game.revision, 0)
        self.assertEqual(game.policy_revision, 2)
        with self.assertRaises(ApiError):
            game.control_policy("start", stale)
        self.assertEqual(game.policy.run.status, "stopped")

    def test_missing_control_generation_rejects(self):
        game = self.game()
        with self.assertRaises(ApiError):
            game.control_policy("start", {"revision": 0, "requestId": "missing", "intentId": "cautious_investigator"})


if __name__ == "__main__":
    unittest.main()
