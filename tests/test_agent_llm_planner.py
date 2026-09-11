#!/usr/bin/env python3
"""P0 tests for the LLM planner groundwork in server.py.

Covers:
- serialize_agent_tool_registry: workspace filtering, shared-tool inclusion,
  arg whitelist attachment.
- validate_llm_plan: whitelist / workspace / args / step refs / dependsOn /
  duplicate-tool / topological order / agent-mode risk gate.
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


def valid_rt_plan() -> dict:
    return {
        "goal": "为 GAPDH 设计并验证 RT-qPCR 引物",
        "workspace": "rtqpcr",
        "steps": [
            {
                "tool": "resolve_rt_target",
                "args": {"targetGene": "GAPDH", "species": "Homo sapiens"},
                "dependsOn": [],
                "rationale": "先解析 transcript 候选",
            },
            {
                "tool": "design_rtqpcr",
                "args": {"transcriptRef": "step:0"},
                "dependsOn": [0],
                "rationale": "基于已选 transcript 设计引物",
            },
            {
                "tool": "check_rt_specificity",
                "args": {"primersRef": "step:1"},
                "dependsOn": [1],
                "rationale": "核验特异性",
            },
        ],
    }


class TestSerializeAgentToolRegistry(unittest.TestCase):
    def test_filters_by_workspace_and_includes_shared(self) -> None:
        tools = {item["name"]: item for item in server.serialize_agent_tool_registry("rtqpcr")}
        # shared tools always present
        self.assertIn("parse_sequence", tools)
        self.assertIn("read_open_sequence", tools)
        # rtqpcr tools present
        self.assertIn("resolve_rt_target", tools)
        self.assertIn("design_rtqpcr", tools)
        self.assertIn("check_rt_specificity", tools)
        # other-workspace tools excluded
        self.assertNotIn("design_cloning", tools)
        self.assertNotIn("resolve_sgrna_target", tools)

    def test_defaults_to_cloning_for_empty_workspace(self) -> None:
        tools = {item["name"]: item for item in server.serialize_agent_tool_registry("")}
        self.assertIn("design_cloning", tools)

    def test_arg_whitelist_attached(self) -> None:
        tools = {item["name"]: item for item in server.serialize_agent_tool_registry("rtqpcr")}
        design = tools["design_rtqpcr"]
        self.assertEqual(design["risk"], "medium")
        self.assertFalse(design["requiresConfirmation"])
        self.assertIn("sequence", design["args"])
        self.assertIn("transcriptRef", design["args"])
        self.assertNotIn("forwardSite", design["args"])
        resolve = tools["resolve_rt_target"]
        self.assertTrue(resolve["requiresConfirmation"])
        self.assertIn("targetGene", resolve["args"])


class TestValidateLlmPlan(unittest.TestCase):
    def test_valid_plan_passes(self) -> None:
        plan, errors = server.validate_llm_plan(valid_rt_plan(), "rtqpcr")
        self.assertEqual(errors, [])
        self.assertEqual(len(plan["steps"]), 3)
        self.assertEqual(plan["steps"][1]["dependsOn"], [0])
        self.assertEqual(plan["workspace"], "rtqpcr")

    def test_unknown_tool_rejected(self) -> None:
        plan = valid_rt_plan()
        plan["steps"][0]["tool"] = "resolve_unknown_target"
        _, errors = server.validate_llm_plan(plan, "rtqpcr")
        self.assertTrue(any("未注册工具" in error for error in errors))

    def test_cross_workspace_tool_rejected(self) -> None:
        plan = valid_rt_plan()
        plan["steps"][0]["tool"] = "design_cloning"
        _, errors = server.validate_llm_plan(plan, "rtqpcr")
        self.assertTrue(any("不属于工作区" in error for error in errors))

    def test_args_outside_whitelist_rejected(self) -> None:
        plan = valid_rt_plan()
        plan["steps"][1]["args"] = {"transcriptRef": "step:0", "forwardSite": "EcoRI"}
        _, errors = server.validate_llm_plan(plan, "rtqpcr")
        self.assertTrue(any("不在工具 design_rtqpcr 白名单内" in error for error in errors))

    def test_non_string_arg_rejected(self) -> None:
        plan = valid_rt_plan()
        plan["steps"][0]["args"] = {"targetGene": ["GAPDH"]}
        _, errors = server.validate_llm_plan(plan, "rtqpcr")
        self.assertTrue(any("不是非空字符串" in error for error in errors))

    def test_numeric_and_bool_args_coerced(self) -> None:
        # LLMs naturally emit {"homologyLength": 20} / {"preserveReadingFrame": true};
        # validator coerces to strings rather than rejecting.
        plan = valid_rt_plan()
        plan["steps"] = [
            {
                "tool": "design_cloning",
                "args": {
                    "method": "gibson",
                    "sequence": "ATGCATGC",
                    "homologyLength": 20,
                    "preserveReadingFrame": True,
                },
                "dependsOn": [],
                "rationale": "克隆设计",
            }
        ]
        result, errors = server.validate_llm_plan(plan, "cloning")
        self.assertEqual(errors, [])
        args = result["steps"][0]["args"]
        self.assertEqual(args["homologyLength"], "20")
        self.assertEqual(args["preserveReadingFrame"], "true")

    def test_step_ref_must_be_valid_integer(self) -> None:
        plan = valid_rt_plan()
        plan["steps"][1]["args"] = {"transcriptRef": "step:abc"}
        _, errors = server.validate_llm_plan(plan, "rtqpcr")
        self.assertTrue(any("step 引用格式无效" in error for error in errors))

    def test_step_ref_must_point_to_earlier_step(self) -> None:
        plan = valid_rt_plan()
        plan["steps"][1]["args"] = {"transcriptRef": "step:2"}
        _, errors = server.validate_llm_plan(plan, "rtqpcr")
        self.assertTrue(any("引用了尚未执行的步骤 2" in error for error in errors))

    def test_depends_on_forward_reference_rejected(self) -> None:
        plan = valid_rt_plan()
        plan["steps"][0]["dependsOn"] = [2]
        _, errors = server.validate_llm_plan(plan, "rtqpcr")
        self.assertTrue(any("无效步骤" in error for error in errors))

    def test_depends_on_out_of_range_rejected(self) -> None:
        plan = valid_rt_plan()
        plan["steps"][0]["dependsOn"] = [9]
        _, errors = server.validate_llm_plan(plan, "rtqpcr")
        self.assertTrue(any("无效步骤" in error for error in errors))

    def test_bool_depends_on_rejected(self) -> None:
        # bool is an int subclass in Python; must not be treated as a step index.
        plan = valid_rt_plan()
        plan["steps"][1]["dependsOn"] = [True]
        _, errors = server.validate_llm_plan(plan, "rtqpcr")
        self.assertTrue(any("无效步骤" in error for error in errors))

    def test_step_ref_without_depends_on_rejected(self) -> None:
        plan = valid_rt_plan()
        # references step 0 but forgets to declare the dependency
        plan["steps"][1]["dependsOn"] = []
        _, errors = server.validate_llm_plan(plan, "rtqpcr")
        self.assertTrue(any("dependsOn 未声明该依赖" in error for error in errors))

    def test_duplicate_tool_rejected(self) -> None:
        plan = valid_rt_plan()
        plan["steps"].append(
            {"tool": "design_rtqpcr", "args": {"sequence": "ATGC"}, "dependsOn": [0]}
        )
        _, errors = server.validate_llm_plan(plan, "rtqpcr")
        self.assertTrue(any("重复使用了工具 design_rtqpcr" in error for error in errors))

    def test_mode_gate_blocks_high_risk_in_review(self) -> None:
        plan = valid_rt_plan()
        # review mode blocks medium+ tools
        _, errors = server.validate_llm_plan(plan, "rtqpcr", agent_mode="review")
        self.assertTrue(any("模式门禁拦截" in error for error in errors))

    def test_mode_gate_blocks_write_risk_in_plan(self) -> None:
        plan = valid_rt_plan()
        plan["steps"] = [
            {
                "tool": "parse_sequence",
                "args": {"sequence": "ATGCATGC"},
                "dependsOn": [],
                "rationale": "解析序列",
            }
        ]
        # plan mode allows low risk; confirm high-risk tools still preflighted
        _, errors = server.validate_llm_plan(plan, "rtqpcr", agent_mode="plan")
        self.assertEqual(errors, [])

    def test_empty_steps_rejected(self) -> None:
        _, errors = server.validate_llm_plan({"steps": []}, "rtqpcr")
        self.assertTrue(any("非空的 steps" in error for error in errors))

    def test_steps_keep_original_order(self) -> None:
        # ``step:N`` refs in args are positional, so a valid plan keeps its
        # declaration order (no reordering even though deps point backwards).
        result, errors = server.validate_llm_plan(valid_rt_plan(), "rtqpcr")
        self.assertEqual(errors, [])
        order = [int(step["index"]) for step in result["steps"]]
        self.assertEqual(order, [0, 1, 2])

    def test_out_of_order_steps_with_forward_refs_rejected(self) -> None:
        # Reversed declaration order turns positional refs into forward refs,
        # which must be rejected (positional semantics, not reordered).
        plan = valid_rt_plan()
        plan["steps"].reverse()
        _, errors = server.validate_llm_plan(plan, "rtqpcr")
        self.assertTrue(any("尚未执行" in error for error in errors))

    def test_plan_steps_have_cycle_detection(self) -> None:
        steps = [
            {"index": 0, "tool": "parse_sequence", "args": {"sequence": "ATGC"}, "dependsOn": [], "rationale": ""},
            {"index": 1, "tool": "sequence_stats", "args": {}, "dependsOn": [0], "rationale": ""},
        ]
        self.assertFalse(server._plan_steps_have_cycle(steps))
        steps[1]["dependsOn"] = [0]
        steps[0]["dependsOn"] = [1]  # craft a cycle directly
        self.assertTrue(server._plan_steps_have_cycle(steps))

    def test_missing_tool_rejected(self) -> None:
        plan = valid_rt_plan()
        del plan["steps"][0]["tool"]
        _, errors = server.validate_llm_plan(plan, "rtqpcr")
        self.assertTrue(any("缺少 tool" in error for error in errors))


# ── P1: LLM planner + generic executor (pilot rtqpcr workspace) ──────────────


def _fake_llm_config(available: bool = True) -> dict:
    return {
        "available": available,
        "configured": available,
        "enabled": True,
        "provider": "test",
        "model": "test-model",
        "mode": "llm" if available else "rules",
        "message": "",
    }


def _rt_payload(**overrides) -> dict:
    payload = {
        "workspace": "rtqpcr",
        "message": "为 GAPDH 设计并验证 RT-qPCR 引物",
        "agentMode": "plan",
        "draft": {
            "workspace": "rtqpcr",
            "designType": "rtqpcr",
            "confirmations": {"rt-transcript": True},
            "designPayload": {
                "query": "GAPDH",
                "species": "Homo sapiens",
                "strain": "",
                "selectedAccession": "",
                "gdnaCheck": True,
                "includeProbe": False,
            },
        },
    }
    payload.update(overrides)
    return payload


class TestLlmPlanAgentExecution(unittest.TestCase):
    def test_returns_none_when_config_unavailable(self) -> None:
        result = server.llm_plan_agent_execution(_rt_payload(), "rtqpcr", _fake_llm_config(False))
        self.assertIsNone(result)

    def test_returns_none_when_workspace_not_in_pilot(self) -> None:
        result = server.llm_plan_agent_execution(_rt_payload(), "cloning", _fake_llm_config())
        self.assertIsNone(result)

    def test_returns_none_in_fast_mode(self) -> None:
        result = server.llm_plan_agent_execution(
            _rt_payload(runMode="fast"), "rtqpcr", _fake_llm_config()
        )
        self.assertIsNone(result)

    def test_returns_none_when_message_empty(self) -> None:
        result = server.llm_plan_agent_execution(
            _rt_payload(message="  "), "rtqpcr", _fake_llm_config()
        )
        self.assertIsNone(result)

    def test_returns_plan_when_available(self) -> None:
        with patch.object(server, "agent_llm_json_completion", return_value=valid_rt_plan()) as mock_completion:
            result = server.llm_plan_agent_execution(_rt_payload(), "rtqpcr", _fake_llm_config())
        self.assertIsNotNone(result)
        self.assertEqual(result["workspace"], "rtqpcr")
        self.assertEqual(len(result["steps"]), 3)
        # prompt carries the tool schema and the message
        call_kwargs = mock_completion.call_args.kwargs
        self.assertIn("resolve_rt_target", call_kwargs["user_prompt"])
        self.assertIn("GAPDH", call_kwargs["user_prompt"])
        self.assertIn("step:", call_kwargs["system_prompt"])

    def test_returns_none_when_completion_raises(self) -> None:
        with patch.object(server, "agent_llm_json_completion", side_effect=server.ApiError("boom")):
            result = server.llm_plan_agent_execution(_rt_payload(), "rtqpcr", _fake_llm_config())
        self.assertIsNone(result)

    def test_returns_none_when_completion_not_dict(self) -> None:
        with patch.object(server, "agent_llm_json_completion", return_value=None):
            result = server.llm_plan_agent_execution(_rt_payload(), "rtqpcr", _fake_llm_config())
        self.assertIsNone(result)


class TestExecuteLlmPlan(unittest.TestCase):
    def test_full_rt_chain_injects_step_refs_and_emits_sse_events(self) -> None:
        plan, errors = server.validate_llm_plan(valid_rt_plan(), "rtqpcr")
        self.assertEqual(errors, [])

        with patch.object(server, "resolve_rt_target_response") as mock_resolve, \
             patch.object(server, "design_rt_response") as mock_design, \
             patch.object(server, "check_rt_specificity_response") as mock_check:
            mock_resolve.return_value = {
                "meta": {"accession": "NM_002046.4", "transcriptOptions": [{"accession": "NM_002046.4"}]},
                "messages": ["found"],
                "results": [],
            }
            mock_design.return_value = {
                "meta": {},
                "messages": ["designed"],
                "results": [{"f": "ACGTACGT", "r": "TGCATGCA", "size": 120, "tm_f": 60.1, "tm_r": 59.9}],
            }
            mock_check.return_value = {
                "meta": {"checked": 1},
                "messages": ["checked"],
                "results": [],
            }
            events = list(server.execute_llm_plan(_rt_payload(), "rtqpcr", plan))

        event_types = [event["event"] for event in events]
        self.assertEqual(event_types, ["step_start", "step_done", "step_start", "step_done", "step_start", "step_done", "complete"])

        complete = events[-1]["data"]
        self.assertEqual(complete["meta"]["plannedBy"], "llm")
        self.assertTrue(complete["meta"]["planValidated"])
        self.assertEqual(complete["meta"]["planErrors"], [])
        self.assertEqual(len(complete["runLog"]), 3)
        self.assertTrue(all(item["status"] == "completed" for item in complete["runLog"]))
        self.assertEqual(len(complete["plan"]), 3)

        # step:0 → resolve selectedAccession injected into design payload
        design_payload = mock_design.call_args.args[0]
        self.assertEqual(design_payload["selectedAccession"], "NM_002046.4")
        # step:1 → design results injected into check payload as primersRef
        check_payload = mock_check.call_args.args[0]
        self.assertEqual(len(check_payload["results"]), 1)
        self.assertEqual(check_payload["results"][0]["f"], "ACGTACGT")

    def test_step_events_carry_args_result_duration(self) -> None:
        """§9.4: step_start/step_done and runLog rows carry the compacted
        resolved args, a result summary, and the wall-clock duration."""
        plan, errors = server.validate_llm_plan(valid_rt_plan(), "rtqpcr")
        self.assertEqual(errors, [])

        with patch.object(server, "resolve_rt_target_response") as mock_resolve, \
             patch.object(server, "design_rt_response") as mock_design, \
             patch.object(server, "check_rt_specificity_response") as mock_check:
            mock_resolve.return_value = {
                "meta": {"accession": "NM_002046.4", "transcriptOptions": [{"accession": "NM_002046.4"}]},
                "messages": ["found"],
                "results": [],
            }
            mock_design.return_value = {
                "meta": {},
                "messages": ["designed"],
                "results": [{"f": "ACGTACGT", "r": "TGCATGCA", "size": 120, "tm_f": 60.1, "tm_r": 59.9}],
            }
            mock_check.return_value = {
                "meta": {"checked": 1},
                "messages": ["checked"],
                "results": [],
            }
            events = list(server.execute_llm_plan(_rt_payload(), "rtqpcr", plan))

        starts = [e["data"] for e in events if e["event"] == "step_start"]
        dones = [e["data"] for e in events if e["event"] == "step_done"]
        complete = events[-1]["data"]

        # step_start carries the compacted resolved args (key preserved as-is)
        self.assertTrue(all("args" in data and isinstance(data["args"], dict) for data in starts))
        self.assertEqual(starts[0]["args"].get("targetGene"), "GAPDH")
        self.assertEqual(starts[0]["args"].get("species"), "Homo sapiens")

        # step_done carries args + result summary + durationMs
        self.assertTrue(all("args" in data for data in dones))
        self.assertTrue(all("durationMs" in data and isinstance(data["durationMs"], int) for data in dones))
        design_done = dones[1]
        self.assertEqual(design_done["result"]["resultCount"], 1)
        self.assertEqual(design_done["result"]["topResult"]["size"], 120)

        # runLog rows carry the same per-step detail
        self.assertEqual(len(complete["runLog"]), 3)
        for row in complete["runLog"]:
            self.assertIn("args", row)
            self.assertIn("result", row)
            self.assertIn("durationMs", row)
            self.assertTrue(isinstance(row["durationMs"], int))
        self.assertEqual(complete["runLog"][1]["result"]["resultCount"], 1)

    def test_step_failure_marks_failed_and_raises(self) -> None:
        plan, errors = server.validate_llm_plan(valid_rt_plan(), "rtqpcr")
        self.assertEqual(errors, [])
        with patch.object(server, "resolve_rt_target_response") as mock_resolve, \
             patch.object(server, "design_rt_response") as mock_design, \
             patch.object(server, "_replan_after_failure", return_value=None):
            mock_resolve.return_value = {"meta": {"accession": "NM_002046.4"}, "messages": [], "results": []}
            mock_design.side_effect = server.ApiError("没有找到满足当前条件的 RT-qPCR 引物")
            events = []
            with self.assertRaises(server.ApiError):
                for event in server.execute_llm_plan(_rt_payload(), "rtqpcr", plan):
                    events.append(event)
        failed_dones = [e for e in events if e["event"] == "step_done" and e["data"].get("status") == "failed"]
        self.assertEqual(len(failed_dones), 1)
        self.assertIn("没有找到满足当前条件的", failed_dones[0]["data"]["summary"])

    def test_unknown_tool_rejected_by_executor(self) -> None:
        plan, errors = server.validate_llm_plan(valid_rt_plan(), "rtqpcr")
        self.assertEqual(errors, [])
        plan["steps"][0]["tool"] = "resolve_unknown_target"
        with patch.object(server, "_replan_after_failure", return_value=None):
            with self.assertRaises(server.ApiError):
                list(server.execute_llm_plan(_rt_payload(), "rtqpcr", plan))

    def test_kind_mismatched_step_ref_raises_clean_error(self) -> None:
        # A scalar arg (resolve ``query``) referencing a design bucket resolves
        # to the results list; the scalar guard must raise a clean ApiError
        # rather than letting a list reach a deterministic handler.
        mismatched = {
            "goal": "类型不匹配测试",
            "workspace": "rtqpcr",
            "steps": [
                {"tool": "design_rtqpcr", "args": {"sequence": "ATGC" * 40}, "dependsOn": [], "rationale": "先设计"},
                {"tool": "resolve_rt_target", "args": {"query": "step:0"}, "dependsOn": [0], "rationale": "错误引用设计桶"},
            ],
        }
        plan, errors = server.validate_llm_plan(mismatched, "rtqpcr")
        self.assertEqual(errors, [])
        with patch.object(server, "design_rt_response") as mock_design, \
             patch.object(server, "_replan_after_failure", return_value=None):
            mock_design.return_value = {"meta": {}, "messages": [], "results": [{"size": 120}]}
            with self.assertRaises(server.ApiError) as ctx:
                list(server.execute_llm_plan(_rt_payload(), "rtqpcr", plan))
        self.assertIn("类型不匹配", str(ctx.exception))


class TestDesignAgentExecuteStreamDualTrack(unittest.TestCase):
    def test_llm_track_when_planner_available(self) -> None:
        with patch.object(server, "agent_llm_config", return_value=_fake_llm_config()), \
             patch.object(server, "agent_llm_json_completion", return_value=valid_rt_plan()), \
             patch.object(server, "resolve_rt_target_response") as mock_resolve, \
             patch.object(server, "design_rt_response") as mock_design, \
             patch.object(server, "check_rt_specificity_response") as mock_check:
            mock_resolve.return_value = {"meta": {"accession": "NM_002046.4"}, "messages": [], "results": []}
            mock_design.return_value = {"meta": {}, "messages": [], "results": [{"size": 120}]}
            mock_check.return_value = {"meta": {"checked": 1}, "messages": [], "results": []}
            final = server.design_agent_execute_response(_rt_payload(), "rtqpcr")
        self.assertEqual(final["meta"]["plannedBy"], "llm")
        self.assertTrue(final["meta"]["planValidated"])
        self.assertEqual(len(final["runLog"]), 3)

    def test_rules_track_when_llm_unavailable(self) -> None:
        with patch.object(server, "agent_llm_config", return_value=_fake_llm_config(False)), \
             patch.object(server, "resolve_transcript_options") as mock_resolve_options, \
             patch.object(server, "design_rt_response") as mock_design:
            mock_resolve_options.return_value = [{"accession": "NM_002046.4", "title": "t", "length": 1200, "variant": "1", "tags": []}]
            mock_design.return_value = {"meta": {}, "messages": [], "results": [{"size": 120, "tm_f": 60, "tm_r": 60}]}
            final = server.design_agent_execute_response(_rt_payload(), "rtqpcr")
        self.assertEqual(final["meta"]["plannedBy"], "rules")
        self.assertFalse(final["meta"]["planValidated"])
        self.assertEqual(final["meta"]["planErrors"], [])

    def test_falls_back_to_rules_when_plan_invalid(self) -> None:
        bad_plan = valid_rt_plan()
        bad_plan["steps"][0]["tool"] = "resolve_unknown_target"
        with patch.object(server, "agent_llm_config", return_value=_fake_llm_config()), \
             patch.object(server, "agent_llm_json_completion", return_value=bad_plan), \
             patch.object(server, "resolve_transcript_options") as mock_resolve_options, \
             patch.object(server, "design_rt_response") as mock_design:
            mock_resolve_options.return_value = [{"accession": "NM_002046.4", "title": "t", "length": 1200, "variant": "1", "tags": []}]
            mock_design.return_value = {"meta": {}, "messages": [], "results": [{"size": 120, "tm_f": 60, "tm_r": 60}]}
            final = server.design_agent_execute_response(_rt_payload(), "rtqpcr")
        self.assertEqual(final["meta"]["plannedBy"], "rules")
        self.assertTrue(final["meta"]["planErrors"])

    def test_falls_back_to_rules_when_plan_uses_non_executable_tool(self) -> None:
        # ``agent_confirm`` passes registry validation (it belongs to the
        # confirmation flow) but is not in LLM_PLAN_EXECUTABLE_TOOLS and is
        # hidden from the planner registry — such a plan must fall back to rules.
        shared_plan = valid_rt_plan()
        shared_plan["steps"][0]["tool"] = "agent_confirm"
        shared_plan["steps"][0]["args"] = {"confirmations": "rt-transcript"}
        shared_plan["steps"][0]["dependsOn"] = []
        with patch.object(server, "agent_llm_config", return_value=_fake_llm_config()), \
             patch.object(server, "agent_llm_json_completion", return_value=shared_plan), \
             patch.object(server, "resolve_transcript_options") as mock_resolve_options, \
             patch.object(server, "design_rt_response") as mock_design:
            mock_resolve_options.return_value = [{"accession": "NM_002046.4", "title": "t", "length": 1200, "variant": "1", "tags": []}]
            mock_design.return_value = {"meta": {}, "messages": [], "results": [{"size": 120, "tm_f": 60, "tm_r": 60}]}
            final = server.design_agent_execute_response(_rt_payload(), "rtqpcr")
        self.assertEqual(final["meta"]["plannedBy"], "rules")
        self.assertTrue(any("共享工具" in error for error in final["meta"]["planErrors"]))


class TestCloningExecuteLlmPlan(unittest.TestCase):
    """Cloning workspace LLM planner tests."""

    def valid_cloning_plan(self) -> dict:
        return {
            "goal": "为 GFP 克隆设计引物",
            "workspace": "cloning",
            "steps": [
                {
                    "tool": "parse_sequence",
                    "args": {"sequence": "ATGC" * 100, "name": "GFP_insert"},
                    "dependsOn": [],
                    "rationale": "先解析 insert 序列",
                },
                {
                    "tool": "design_cloning",
                    "args": {
                        "method": "gibson",
                        "sequence": "step:0",
                        "vectorSequence": "GGATCC" * 50,
                        "homologyLength": "20",
                    },
                    "dependsOn": [0],
                    "rationale": "基于已解析的 insert 设计 Gibson 引物",
                },
            ],
        }

    def _cloning_payload(self, **overrides) -> dict:
        payload = {
            "workspace": "cloning",
            "message": "为 GFP 设计克隆引物",
            "agentMode": "plan",
            "draft": {
                "workspace": "cloning",
                "designType": "cloning",
                "confirmations": {
                    "cloning-restriction-pair": True,
                },
                "designPayload": {
                    "method": "gibson",
                    "sequence": "",
                    "vectorSequence": "",
                    "label": "GFP_cloning",
                },
            },
        }
        payload.update(overrides)
        return payload

    def test_cloning_plan_validates(self) -> None:
        plan, errors = server.validate_llm_plan(self.valid_cloning_plan(), "cloning")
        self.assertEqual(errors, [])
        self.assertEqual(len(plan["steps"]), 2)

    def test_execute_cloning_chain(self) -> None:
        plan, errors = server.validate_llm_plan(self.valid_cloning_plan(), "cloning")
        self.assertEqual(errors, [])

        with patch.object(server, "parse_sequence_response") as mock_parse, \
             patch.object(server, "design_cloning_response") as mock_design:
            mock_parse.return_value = {
                "document": {"sequence": "ATGC" * 100, "name": "GFP_insert", "length": 400},
                "messages": ["已识别为纯序列，长度 400 bp。"],
            }
            mock_design.return_value = {
                "meta": {"cloningMethod": "gibson"},
                "messages": ["Gibson 引物已生成。"],
                "results": [{"size": 120, "forward_site_name": "", "reverse_site_name": ""}],
            }
            events = list(server.execute_llm_plan(self._cloning_payload(), "cloning", plan))

        event_types = [event["event"] for event in events]
        self.assertEqual(event_types, ["step_start", "step_done", "step_start", "step_done", "complete"])

        complete = events[-1]["data"]
        self.assertEqual(complete["meta"]["plannedBy"], "llm")
        self.assertEqual(len(complete["runLog"]), 2)
        self.assertTrue(all(item["status"] == "completed" for item in complete["runLog"]))

        # parse output → sequence arg injected into design payload
        design_payload = mock_design.call_args.args[0]
        # method comes from the LLM step args (resolved from the plan step)
        self.assertEqual(design_payload.get("method"), "gibson")
        self.assertTrue("sequence" in design_payload or "insertSequence" in design_payload)

    def test_cloning_parse_sequence_includes_name(self) -> None:
        plan, errors = server.validate_llm_plan(self.valid_cloning_plan(), "cloning")
        self.assertEqual(errors, [])

        with patch.object(server, "parse_sequence_response") as mock_parse, \
             patch.object(server, "design_cloning_response") as mock_design:
            mock_parse.return_value = {
                "document": {"sequence": "ATGC" * 100, "name": "GFP_insert", "length": 400},
                "messages": ["已识别序列。"],
            }
            mock_design.return_value = {
                "meta": {}, "messages": [], "results": [{"size": 120}],
            }
            list(server.execute_llm_plan(self._cloning_payload(), "cloning", plan))

        parse_payload = mock_parse.call_args.args[0]
        self.assertEqual(parse_payload["name"], "GFP_insert")

    def test_scan_restriction_sites_works_in_cloning(self) -> None:
        scan_plan = {
            "goal": "扫描酶切位点",
            "workspace": "cloning",
            "steps": [
                {
                    "tool": "scan_restriction_sites",
                    "args": {"sequence": "ATGC" * 50, "vectorSequence": "GGATCC" * 30},
                    "dependsOn": [],
                    "rationale": "扫描酶切位点",
                },
            ],
        }
        plan, errors = server.validate_llm_plan(scan_plan, "cloning")
        self.assertEqual(errors, [])

        with patch.object(server, "scan_restriction_sites_response") as mock_scan:
            mock_scan.return_value = {
                "meta": {"restrictionAnalysis": {"recommendedPairs": []}},
                "messages": ["扫描完成。"],
            }
            events = list(server.execute_llm_plan(self._cloning_payload(), "cloning", plan))

        event_types = [event["event"] for event in events]
        self.assertEqual(event_types, ["step_start", "step_done", "complete"])
        complete = events[-1]["data"]
        self.assertEqual(complete["meta"]["plannedBy"], "llm")


class TestReplanAfterFailure(unittest.TestCase):
    """P2: execute_llm_plan re-plans on step failure (at most once)."""

    def test_replan_on_design_failure_replaces_remaining_steps(self) -> None:
        """Design step fails → LLM replans → executor runs new steps."""
        plan, errors = server.validate_llm_plan(valid_rt_plan(), "rtqpcr")
        self.assertEqual(errors, [])
        replan_result = {
            "goal": "修正计划",
            "workspace": "rtqpcr",
            "steps": [
                {
                    "tool": "resolve_rt_target",
                    "args": {"targetGene": "GAPDH", "species": "Homo sapiens"},
                    "dependsOn": [],
                    "rationale": "重试解析转录本",
                },
            ],
        }
        with patch.object(server, "resolve_rt_target_response") as mock_resolve, \
             patch.object(server, "design_rt_response") as mock_design, \
             patch.object(server, "agent_llm_config", return_value={"available": True}), \
             patch.object(server, "_replan_after_failure", return_value=replan_result) as mock_replan:
            mock_resolve.return_value = {"meta": {"accession": "NM_002046.4"}, "messages": [], "results": []}
            mock_design.side_effect = [
                server.ApiError("没有找到满足条件的引物"),
            ]
            events = list(server.execute_llm_plan(_rt_payload(), "rtqpcr", plan))
        self.assertGreater(len(events), 0)
        event_types = [e["event"] for e in events]
        # Should have: step_start/step_done (resolve) + step_start/step_done (design fail)
        # + replan step_start/step_done + step_start/step_done (resolve retry) + complete
        self.assertIn("replan", [e["data"].get("step") for e in events if e["event"] == "step_start"])
        complete = [e for e in events if e["event"] == "complete"]
        self.assertEqual(len(complete), 1)
        self.assertEqual(complete[0]["data"]["meta"]["plannedBy"], "llm")
        # Replan was called
        mock_replan.assert_called_once()

    def test_replan_not_attempted_when_llm_unavailable(self) -> None:
        """If LLM config is unavailable, skip re-plan and raise instead."""
        plan, errors = server.validate_llm_plan(valid_rt_plan(), "rtqpcr")
        self.assertEqual(errors, [])
        with patch.object(server, "resolve_rt_target_response") as mock_resolve, \
             patch.object(server, "design_rt_response") as mock_design, \
             patch.object(server, "agent_llm_config", return_value={"available": False}):
            mock_resolve.return_value = {"meta": {"accession": "NM_002046.4"}, "messages": [], "results": []}
            mock_design.side_effect = server.ApiError("设计失败")
            with self.assertRaises(server.ApiError):
                list(server.execute_llm_plan(_rt_payload(), "rtqpcr", plan))

    def test_replan_only_once(self) -> None:
        """After a re-plan, if the new steps also fail, do NOT re-plan again."""
        plan, errors = server.validate_llm_plan(valid_rt_plan(), "rtqpcr")
        self.assertEqual(errors, [])
        replan_result = {
            "goal": "修正计划",
            "workspace": "rtqpcr",
            "steps": [
                {
                    "tool": "resolve_rt_target",
                    "args": {"targetGene": "GAPDH", "species": "Homo sapiens"},
                    "dependsOn": [],
                    "rationale": "再次尝试",
                },
            ],
        }
        with patch.object(server, "resolve_rt_target_response") as mock_resolve, \
             patch.object(server, "design_rt_response") as mock_design, \
             patch.object(server, "agent_llm_config", return_value={"available": True}), \
             patch.object(server, "_replan_after_failure", return_value=replan_result) as mock_replan:
            mock_resolve.side_effect = server.ApiError("resolve 也失败")
            mock_design.side_effect = server.ApiError("设计失败")
            with self.assertRaises(server.ApiError):
                list(server.execute_llm_plan(_rt_payload(), "rtqpcr", plan))
        # Replan called exactly once (not recursively)
        mock_replan.assert_called_once()

    def test_replan_returns_none_falls_back_to_raise(self) -> None:
        """If _replan_after_failure returns None, keep original raise."""
        plan, errors = server.validate_llm_plan(valid_rt_plan(), "rtqpcr")
        self.assertEqual(errors, [])
        with patch.object(server, "resolve_rt_target_response") as mock_resolve, \
             patch.object(server, "design_rt_response") as mock_design, \
             patch.object(server, "agent_llm_config", return_value={"available": True}), \
             patch.object(server, "_replan_after_failure", return_value=None) as mock_replan:
            mock_resolve.return_value = {"meta": {"accession": "NM_002046.4"}, "messages": [], "results": []}
            mock_design.side_effect = server.ApiError("设计失败")
            with self.assertRaises(server.ApiError):
                list(server.execute_llm_plan(_rt_payload(), "rtqpcr", plan))
        mock_replan.assert_called_once()


if __name__ == "__main__":
    unittest.main()
