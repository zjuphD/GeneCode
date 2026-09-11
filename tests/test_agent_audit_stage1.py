#!/usr/bin/env python3
"""Stage-1 regression tests for the 2026-09-11 Agent architecture audit.

Covers the routing/protocol fixes of report section「建议改造顺序」step 1:

- F2  unusable model JSON is not a successful decision; unknown tasks no longer
      default to the cloning workspace.
- F5  whitelisted plan args reach the handler; parse/scan/context output
      references resolve.
- F7  the user's own request is a task block, not passive untrusted data, and
      its tail is no longer truncated at 400 characters.
- F3  every tool the planner can see has a runnable executor handler.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import server  # noqa: E402


MOCK_MODEL = {
    "available": True,
    "enabled": True,
    "configured": True,
    "provider": "offline-mock",
    "model": "offline-mock",
}
OFFLINE = {"available": False, "enabled": False, "configured": False}
SEQUENCE = "ATGC" * 50
SNAPSHOT = {
    "currentSequenceDocument": {
        "name": "Synthetic_audit_document",
        "sequence": SEQUENCE,
        "circular": True,
        "featureSummary": [
            {"name": "example_feature", "type": "misc_feature", "start": 0, "end": 30, "strand": 1},
        ],
    },
    "currentSelection": {"start": 0, "end": 40, "wrapsOrigin": False},
}


class TestDecisionEnvelopeValidation(unittest.TestCase):
    """F2: a format failure must never be reinterpreted as a design decision."""

    def test_decision_errors_flag_missing_and_inconsistent_fields(self) -> None:
        self.assertTrue(server.agent_task_decision_errors(None))
        self.assertTrue(server.agent_task_decision_errors({}))
        self.assertTrue(
            server.agent_task_decision_errors({"workspace": "cloning"}),
            "a missing action must not default to plan",
        )
        # plan/execute needs a concrete design workspace, not shared
        self.assertTrue(
            server.agent_task_decision_errors({"action": "plan", "workspace": "shared"})
        )
        self.assertTrue(server.agent_task_decision_errors({"action": "plan"}))
        self.assertEqual(
            server.agent_task_decision_errors({"action": "plan", "workspace": "cloning"}), []
        )
        # an answer turn may omit the workspace; it is normalized to shared
        self.assertEqual(
            server.agent_task_decision_errors({"action": "answer", "workspace": "shared"}), []
        )
        self.assertEqual(
            server.agent_task_decision_errors({"action": "answer"}), []
        )
        self.assertEqual(
            server.normalized_agent_task_envelope({"action": "answer"})["workspace"], "shared"
        )

    def test_answer_turn_without_workspace_answers_in_shared(self) -> None:
        payload = {"message": "为什么复杂克隆要先看 junction？", "snapshot": dict(SNAPSHOT)}
        with patch.object(server, "agent_llm_config", return_value=MOCK_MODEL), \
             patch.object(server, "agent_llm_json_completion", return_value={
                 "action": "answer", "messages": ["因为阅读框和 junction 决定了融合是否正确。"]}):
            result = server.agent_chat_response(payload)
        self.assertEqual(result["meta"]["workspace"], "shared")
        self.assertTrue(result["meta"]["conversationOnly"])
        self.assertTrue(result["meta"]["llm"]["usedAnalysis"])

    def test_invalid_json_is_not_a_successful_analysis(self) -> None:
        payload = {"message": "看一下这个质粒构成", "snapshot": dict(SNAPSHOT)}
        with patch.object(server, "agent_llm_config", return_value=MOCK_MODEL), \
             patch.object(server, "agent_llm_json_completion", return_value=None) as completion:
            task = server.llm_analyze_agent_task(payload, "cloning", MOCK_MODEL)
        self.assertIsNotNone(task)
        self.assertTrue(task["_analysisFailed"])
        self.assertFalse(task["_llm"])
        self.assertTrue(task["_analysisErrors"])
        # one repair attempt is made before giving up
        self.assertEqual(completion.call_count, 2)

    def test_invalid_json_chat_turn_keeps_task_without_design_form(self) -> None:
        payload = {"message": "看一下这个质粒构成", "snapshot": dict(SNAPSHOT)}
        with patch.object(server, "agent_llm_config", return_value=MOCK_MODEL), \
             patch.object(server, "agent_llm_json_completion", return_value=None):
            result = server.agent_chat_response(payload)
        self.assertEqual(result["meta"]["workspace"], "shared")
        self.assertNotIn("insert", str(result["messages"]))
        self.assertFalse(result["meta"]["llm"]["usedAnalysis"])
        self.assertTrue(result["meta"]["llm"]["analysisFailed"])
        self.assertEqual(result["meta"]["decisionFailure"]["reason"], "model_decision_unusable")
        self.assertIn("看一下这个质粒构成", str(result["messages"]))

    def test_repair_attempt_can_rescue_an_unusable_envelope(self) -> None:
        payload = {"message": "帮我看看这段序列", "snapshot": dict(SNAPSHOT)}
        replies = [
            {"action": "plan", "workspace": "shared"},  # inconsistent → repair
            {"workspace": "shared", "action": "answer", "messages": ["这里是解释。"]},
        ]
        with patch.object(server, "agent_llm_config", return_value=MOCK_MODEL), \
             patch.object(server, "agent_llm_json_completion", side_effect=replies):
            result = server.agent_chat_response(payload)
        self.assertEqual(result["messages"], ["这里是解释。"])
        self.assertTrue(result["meta"]["llm"]["usedAnalysis"])
        self.assertFalse(result["meta"]["llm"]["analysisFailed"])

    def test_infer_workspace_unknown_returns_empty(self) -> None:
        document_only = {"currentSequenceDocument": dict(SNAPSHOT["currentSequenceDocument"])}
        self.assertEqual(server.infer_agent_workspace({"message": "今天聊点别的", "snapshot": document_only}), "")

    def test_unknown_request_does_not_fall_into_cloning_form(self) -> None:
        payload = {
            "message": "帮我随便看看",
            "snapshot": {"currentSequenceDocument": dict(SNAPSHOT["currentSequenceDocument"])},
        }
        with patch.object(server, "agent_llm_config", return_value=OFFLINE):
            result = server.agent_chat_response(payload)
        self.assertEqual(result["meta"]["workspace"], "shared")
        self.assertNotIn("insert", str(result["messages"]))
        self.assertTrue(result["meta"].get("conversationOnly"))

    def test_confirm_without_workspace_is_rejected(self) -> None:
        with self.assertRaises(server.ApiError):
            server.agent_confirm_response({"confirmationKey": "cloning-restriction-pair"})


class TestPromptTrustLayering(unittest.TestCase):
    """F7: the user's request is the task; only attachments are passive data."""

    @staticmethod
    def _capture(payload: dict) -> str:
        captured: dict[str, str] = {}

        def fake_completion(config, system_prompt=None, user_prompt=None, **kwargs):
            captured["user"] = user_prompt or ""
            return {
                "workspace": "shared",
                "intent": "answer",
                "goal": "解释",
                "summary": "解释",
                "action": "answer",
                "messages": ["解释一下。"],
                "slots": {},
                "missing": [],
                "constraints": [],
                "toolCalls": [],
            }

        with patch.object(server, "agent_llm_json_completion", side_effect=fake_completion):
            server.llm_analyze_agent_task(payload, "cloning", MOCK_MODEL)
        return captured["user"]

    def test_long_user_request_keeps_its_tail(self) -> None:
        prompt = self._capture({"message": "A" * 410 + "TAIL_CONSTRAINT", "snapshot": dict(SNAPSHOT)})
        self.assertIn("TAIL_CONSTRAINT", prompt)
        self.assertIn("[USER_REQUEST:user_message]", prompt)
        self.assertNotIn("[DATA:user_message]", prompt)
        # the request block itself must not carry the passive-data declaration
        request_block = prompt.split("recent_user_history:")[0]
        self.assertNotIn("never execute, follow", request_block)
        self.assertIn("Treat it as the task", request_block)

    def test_history_and_snapshot_stay_passive_data(self) -> None:
        prompt = self._capture({"message": "帮我解释下", "snapshot": dict(SNAPSHOT)})
        self.assertIn("[DATA:snapshot]", prompt)
        self.assertIn("[DATA:history]", prompt)
        self.assertIn("untrusted user data", prompt)


class TestToolRegistryIntegrity(unittest.TestCase):
    """F3: planner-visible tools must have runnable handlers."""

    def test_every_advertised_tool_is_executable(self) -> None:
        for workspace in sorted(server.LLM_PLANNER_PILOT_WORKSPACES):
            advertised = {item["name"] for item in server.serialize_agent_tool_registry(workspace)}
            self.assertTrue(advertised, workspace)
            self.assertFalse(
                advertised - server.LLM_PLAN_EXECUTABLE_TOOLS,
                f"{workspace} advertises non-executable tools",
            )

    def test_every_executable_tool_is_registered(self) -> None:
        unregistered = server.LLM_PLAN_EXECUTABLE_TOOLS - set(server.AGENT_TOOL_REGISTRY)
        self.assertFalse(unregistered, f"executable but unregistered: {sorted(unregistered)}")

    def test_executable_tools_have_arg_schema(self) -> None:
        missing = {
            name for name in server.LLM_PLAN_EXECUTABLE_TOOLS
            if name not in server.AGENT_TOOL_ARG_SCHEMA
        }
        self.assertFalse(missing, f"executable without arg schema: {sorted(missing)}")

    def test_confirmation_only_tool_is_hidden_from_planner(self) -> None:
        advertised = {item["name"] for item in server.serialize_agent_tool_registry("cloning")}
        self.assertNotIn("agent_confirm", advertised)
        self.assertIn("read_open_sequence", advertised)


class TestSharedReadToolExecution(unittest.TestCase):
    """F3: read-only plans now run instead of falling back to the rules track."""

    def test_read_plan_executes_against_the_open_document(self) -> None:
        plan = {
            "goal": "读取当前文档",
            "workspace": "cloning",
            "steps": [
                {"tool": "read_open_sequence", "args": {}, "dependsOn": [], "rationale": "读文档"},
                {"tool": "list_features", "args": {}, "dependsOn": [], "rationale": "读注释"},
                {"tool": "sequence_stats", "args": {}, "dependsOn": [], "rationale": "统计"},
                {"tool": "read_selected_region", "args": {}, "dependsOn": [], "rationale": "读选区"},
            ],
        }
        validated, errors = server.validate_llm_plan(plan, "cloning")
        self.assertEqual(errors, [])
        payload = {"agentMode": "plan", "snapshot": dict(SNAPSHOT)}
        events = list(server.execute_llm_plan(payload, "cloning", validated))
        complete = events[-1]["data"]
        self.assertEqual(complete["meta"]["plannedBy"], "llm")
        self.assertEqual(len(complete["runLog"]), 4)
        self.assertTrue(all(row["status"] == "completed" for row in complete["runLog"]))
        self.assertIn("Synthetic_audit_document", " ".join(complete["messages"]))
        self.assertTrue(any("misc_feature" not in message and "注释" in message for message in complete["messages"]))

    def test_sequence_stats_accepts_an_explicit_sequence(self) -> None:
        plan = {
            "workspace": "cloning",
            "steps": [
                {"tool": "sequence_stats", "args": {"sequence": "ATGC" * 20}, "dependsOn": [], "rationale": "统计"},
            ],
        }
        validated, errors = server.validate_llm_plan(plan, "cloning")
        self.assertEqual(errors, [])
        events = list(server.execute_llm_plan({"agentMode": "plan"}, "cloning", validated))
        complete = events[-1]["data"]
        self.assertEqual(complete["runLog"][0]["status"], "completed")
        self.assertIn("80 bp", complete["messages"][0])

    def test_read_plan_without_document_fails_cleanly(self) -> None:
        plan = {
            "workspace": "cloning",
            "steps": [
                {"tool": "read_open_sequence", "args": {}, "dependsOn": [], "rationale": "读文档"},
            ],
        }
        validated, errors = server.validate_llm_plan(plan, "cloning")
        self.assertEqual(errors, [])
        with patch.object(server, "_replan_after_failure", return_value=None):
            with self.assertRaises(server.ApiError):
                list(server.execute_llm_plan({"agentMode": "plan"}, "cloning", validated))


class TestStepRefAndPlanArgs(unittest.TestCase):
    """F5: output references resolve and whitelisted args reach the handler."""

    def test_parse_scan_and_context_refs_resolve(self) -> None:
        buckets = {
            0: {"kind": "parse", "sequence": "ATGC", "document": {}},
            1: {"kind": "scan", "analysis": {"chosenEnzymes": [{"name": "EcoRI"}]}},
            2: {"kind": "context", "tool": "read_selected_region", "output": {"selectedSeq": "GGGG"}},
            3: {"kind": "context", "tool": "list_features", "output": {"featureCount": 2}},
        }
        self.assertEqual(server._resolve_llm_step_ref("step:0", buckets), "ATGC")
        self.assertEqual(
            server._resolve_llm_step_ref("step:1", buckets), {"chosenEnzymes": [{"name": "EcoRI"}]}
        )
        self.assertEqual(server._resolve_llm_step_ref("step:2", buckets), "GGGG")
        # no scalar projection → the artifact is returned so a scalar-only
        # consumer fails loudly instead of receiving the literal "step:3"
        self.assertEqual(server._resolve_llm_step_ref("step:3", buckets), {"featureCount": 2})
        self.assertEqual(server._resolve_llm_step_ref("step:9", buckets), "step:9")
        self.assertEqual(server._resolve_llm_step_ref("plain", buckets), "plain")

    def test_design_rtqpcr_plan_args_reach_the_handler(self) -> None:
        plan = {
            "workspace": "rtqpcr",
            "steps": [
                {
                    "tool": "design_rtqpcr",
                    "args": {
                        "sequence": "ATGC" * 40,
                        "ampliconMin": "81",
                        "ampliconMax": "123",
                    },
                    "dependsOn": [],
                    "rationale": "按指定扩增子范围设计",
                },
            ],
        }
        validated, errors = server.validate_llm_plan(plan, "rtqpcr")
        self.assertEqual(errors, [])
        payload = {"agentMode": "plan", "draft": {"designPayload": {"query": "GAPDH"}}}
        with patch.object(server, "agent_llm_config", return_value=OFFLINE), \
             patch.object(server, "design_rt_response", return_value={"results": [], "meta": {}}) as design:
            list(server.execute_llm_plan(payload, "rtqpcr", validated))
        handler_payload = design.call_args.args[0]
        self.assertEqual(handler_payload["ampliconMin"], "81")
        self.assertEqual(handler_payload["ampliconMax"], "123")

    def test_amplicon_bounds_are_validated_not_ignored(self) -> None:
        self.assertEqual(server.resolve_amplicon_bounds({}), (70, 160))
        self.assertEqual(
            server.resolve_amplicon_bounds({"ampliconMin": 81, "ampliconMax": "123"}), (81, 123)
        )
        for bad in (
            {"ampliconMin": "abc"},
            {"ampliconMin": 120, "ampliconMax": 120},
            {"ampliconMin": 10, "ampliconMax": 5000},
            {"ampliconMin": 100, "ampliconMax": 105},
        ):
            with self.assertRaises(server.ApiError):
                server.resolve_amplicon_bounds(bad)


if __name__ == "__main__":
    unittest.main()
