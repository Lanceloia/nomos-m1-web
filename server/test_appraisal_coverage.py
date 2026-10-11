"""Coverage and meaningful stops using public frames, not a scripted world run."""
import copy
import unittest

from server.m1_policy import M1Policy
from server import test_policy_execution as execution_tests
from server.test_policy_execution import frame


class CoverageTests(unittest.TestCase):
    def test_batch_reuses_meanings_and_preserves_manual_authority(self):
        policy = M1Policy()
        self.assertEqual(len(policy.appraisal.compiled.bindings), 44)
        self.assertEqual(len(policy.appraisal.compiled.definitions), 16)
        for entry in ("strike_person_adventurer",
                      "offer_torch_adventurer", "receive_charge_adventurer", "observe_elemental_adventurer",
                      "climb_skyhook_adventurer", "bridge_rush_adventurer"):
            with self.subTest(entry=entry):
                current = frame()
                current["offers"] = [dict(index=1, entry=entry, label=entry)]
                self.assertEqual(policy.candidates(current, "decisive_explorer"), [])

    def test_new_person_entries_require_public_target_and_reuse_observation_state(self):
        policy, current = M1Policy(), frame()
        current["offers"] = [dict(index=101, entry="observe_resident_fox_adventurer", label="观察狐")]
        self.assertEqual(policy.candidates(current, "helpful_rescuer"), [])
        current["offers"][0]["targetIds"] = ["known_fox"]
        current["observations"] = [dict(id="known_fox", kind="person", site="a", state="unknown")]
        candidate = policy.candidates(current, "helpful_rescuer")[0]
        self.assertEqual(candidate.meaning, "inspect_person")
        current["observations"][0]["detailRecordedAt"] = 100
        self.assertEqual(policy.candidates(current, "helpful_rescuer"), [])

    def test_scope_memory_separates_inspections_and_reuses_aliases(self):
        policy, current = M1Policy(), frame()
        current["offers"] = [dict(index=11, entry="observe_chest_adventurer", label="看箱子"),
                             dict(index=12, entry="observe_wall_adventurer", label="看墙")]
        policy.start(current, "cautious_investigator")
        candidates = policy.candidates(current, "cautious_investigator")
        self.assertEqual({row.key[1] for row in candidates}, {"chest", "wall"})
        self.assertIsNotNone(policy.select(current))
        current["offers"] = [dict(index=13, entry="look_tower_top_adventurer", label="望塔顶")]
        first = policy.candidates(current, "cautious_investigator")[0]
        current["offers"][0]["entry"] = "observe_queen_adventurer"
        self.assertEqual(policy.candidates(current, "cautious_investigator", {first.key}), [])

    def test_ambiguous_unseen_objects_are_not_guessed_from_private_payload(self):
        current, policy = frame(), M1Policy()
        current["offers"] = [dict(index=11, entry="observe_wall_adventurer", label="墙"),
                             dict(index=12, entry="observe_wall_adventurer", label="墙")]
        policy.start(current, "decisive_explorer")
        self.assertIsNone(policy.select(current))
        self.assertEqual(policy.snapshot()["stopDetail"]["code"], "ambiguous")

    def test_current_and_last_known_inspections_are_scored_by_declared_evidence_risk(self):
        current, policy = frame(), M1Policy()
        current["observations"] = [dict(id="p", kind="person", site="a", state="unknown")]
        current["offers"] = [dict(index=8, entry="inspect_patient_adventurer", label="按过去线索查看", targetIds=["p"]),
                             dict(index=9, entry="observe_resident_adventurer", label="查看附近人物", targetIds=["p"])]
        for personality in policy.profiles:
            policy = M1Policy()
            policy.start(current, personality)
            selected = policy.select(current)
            self.assertEqual(selected.candidate.index, 9)
            self.assertEqual(policy.candidates(current, personality, {selected.candidate.key}), [])
        current["offers"] = current["offers"][:1]
        policy = M1Policy()
        policy.start(current, "cautious_investigator")
        self.assertEqual(policy.select(current).candidate.features, {"person": 1, "memory_risk": 1})

    def test_acquired_charge_is_one_attempt_without_inventing_source_balance(self):
        for entry in ("load_charge_adventurer", "load_elemental_torch_adventurer", "load_balloon_power_adventurer"):
            with self.subTest(entry=entry):
                current, policy = frame(), M1Policy()
                current["offers"] = [dict(index=77, entry=entry, label="装填一份充能")]
                current["fields"]["everflameCharges"] = 3
                policy.start(current, "helpful_rescuer")
                selected = policy.select(current)
                self.assertEqual(selected.candidate.expectations["torch_gain"], 1)
                self.assertEqual(selected.candidate.expectations["reservoir_spend"], 0)
                after = copy.deepcopy(current)
                after["fields"]["everflameCharges"] = 4
                self.assertIsNone(policy.stop_reason(selected.candidate, current, after))
                self.assertEqual(policy.candidates(after, "helpful_rescuer", {selected.candidate.key}), [])
                current["fields"]["everflameCharges"] = None
                self.assertEqual(policy.candidates(current, "helpful_rescuer"), [])

    def test_known_routes_do_not_suppress_distinct_climb_inspection(self):
        current, policy = frame(), M1Policy()
        current["scene"]["routes"] = [{"start": "a", "end": "b"}]
        current["offers"] = [dict(index=1, entry="observe_climbs_adventurer", label="查看攀爬路线")]
        self.assertEqual(policy.candidates(current, "cautious_investigator")[0].features, {"routes": 1})

    def test_new_prison_passages_use_real_offered_destination(self):
        for entry in ("pass_prison_bars_adventurer", "pass_prison_line_adventurer"):
            with self.subTest(entry=entry):
                current, policy = frame(), M1Policy()
                current["offers"] = [dict(index=202, entry=entry, label="通过", destination="b", movementKind="walk")]
                policy.start(current, "decisive_explorer")
                selected = policy.select(current)
                self.assertEqual(selected.candidate.meaning, "travel")
                after = copy.deepcopy(current)
                after["fields"]["locationId"] = "b"
                self.assertIsNone(policy.stop_reason(selected.candidate, current, after))
                after["fields"]["locationId"] = "other"
                self.assertEqual(policy.stop_reason(selected.candidate, current, after)[0], "landing_changed")


class StopTests(unittest.TestCase):
    def test_response_reprojects_choices_after_manual_transition_and_ending(self):
        game = execution_tests.ControlTests().game()
        game.policy.start(game.frame, "cautious_investigator")
        game.policy.halt(game.frame, "cancelled", "已停止")
        old = game.response()
        game.frame = copy.deepcopy(game.frame)
        game.frame["offers"] = [dict(index=1, entry="open_chest_adventurer", label="新地点查看箱子")]
        game.revision += 1
        response = game.response()
        self.assertEqual(response["policy"]["stopDetail"]["choices"], [
            {"index": 1, "label": "新地点查看箱子"}])
        self.assertNotEqual(response["policy"]["stopDetail"]["choices"], old["policy"]["stopDetail"]["choices"])
        self.assertEqual(response["policy"]["reason"], "已停止")
        game.frame["ending"] = {"id": "departed_palace"}
        self.assertEqual(game.response()["policy"]["stopDetail"]["choices"], [])

    def test_fault_never_reprojects_old_offers_as_choices(self):
        current, policy = frame(), M1Policy()
        policy.start(current, "cautious_investigator")
        policy.run.stop("异常", code="fault")
        self.assertEqual(policy.snapshot(current)["stopDetail"]["choices"], [])

    def test_manual_decision_lists_current_options_without_submitting(self):
        current, policy = frame(), M1Policy()
        current["offers"] = [dict(index=9, entry="offer_torch_adventurer", label="转交永焰"),
                             dict(index=12, entry="open_chest_adventurer", label="打开宝箱")]
        policy.start(current, "helpful_rescuer")
        before = copy.deepcopy(current)
        self.assertIsNone(policy.select(current))
        snapshot = policy.snapshot()
        self.assertEqual(snapshot["stopDetail"], {"code": "manual_decision", "choices": [
            {"index": 9, "label": "转交永焰"}, {"index": 12, "label": "打开宝箱"}]})
        self.assertEqual(snapshot["steps"], [])
        self.assertEqual(current, before)
        snapshot["stopDetail"]["choices"][0]["label"] = "changed"
        self.assertEqual(policy.snapshot()["stopDetail"]["choices"][0]["label"], "转交永焰")

    def test_ordinary_discovery_continues_but_injury_explains_last_real_action(self):
        current, policy = frame(), M1Policy()
        policy.start(current, "cautious_investigator")
        selected = policy.select(current)
        after = copy.deepcopy(current)
        after.update(time=100, feedback={"status": "published", "result": {"discoveries": [
            {"id": "person", "kind": "person"}]}})
        policy.record(selected, current, after, 0, 1)
        self.assertEqual(policy.snapshot()["status"], "running")
        self.assertIsNone(policy.snapshot()["stopDetail"])
        selected = policy.select(after)
        injured = copy.deepcopy(after)
        injured["fields"]["endurance"] = 2
        injured["offers"] = [dict(index=21, entry="wait_adventurer", label="停留")]
        injured["time"] = 200
        policy.record(selected, after, injured, 1, 2)
        snapshot = policy.snapshot()
        self.assertEqual(snapshot["stopDetail"]["code"], "injury")
        self.assertEqual(snapshot["steps"][-1]["label"], selected.candidate.label)
        self.assertEqual(snapshot["stopDetail"]["choices"], [{"index": 21, "label": "停留"}])

    def test_ending_has_no_stale_choices_and_new_approval_clears_stop(self):
        current, policy = frame(), M1Policy()
        policy.start(current, "cautious_investigator")
        ended = copy.deepcopy(current)
        ended["ending"] = {"id": "departed_palace"}
        self.assertIsNone(policy.select(ended))
        self.assertEqual(policy.snapshot()["stopDetail"], {"code": "ending", "choices": []})
        policy.start(current, "decisive_explorer")
        self.assertIsNone(policy.snapshot()["stopDetail"])

    def test_distinct_meaning_tie_is_stable_and_empty_opportunity_stops(self):
        current, policy = frame(), M1Policy()
        profiles = copy.deepcopy(policy.profiles)
        weights = profiles["cautious_investigator"]["weights"]
        weights.update({name: 0 for name in weights})
        weights.update(floor=1, routes=1)
        policy = M1Policy(profiles=profiles)
        policy.start(current, "cautious_investigator")
        chosen = policy.select(current)
        current['offers'].reverse()
        self.assertEqual(policy.select(current).candidate.index, chosen.candidate.index)
        current["offers"] = []
        policy.halt(current, 'cancelled', '已停止')
        policy.start(current, "cautious_investigator")
        self.assertIsNone(policy.select(current))
        self.assertEqual(policy.snapshot()["stopDetail"], {"code": "no_candidate", "choices": []})


if __name__ == "__main__":
    unittest.main()
