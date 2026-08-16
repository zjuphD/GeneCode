#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ["AGENT_LLM_ENABLED"] = "0"
import server  # noqa: E402


FIXTURES = json.loads((ROOT / "tests" / "fixtures" / "offline_sequences.json").read_text(encoding="utf-8"))


class TestCloningCoordinateContract(unittest.TestCase):
    def test_cloning_primer_coordinates_are_zero_based_and_target_insert(self) -> None:
        sequence = (
            "TCGCGCGTTTCGGTGATGACGGTGAAAACCTCTGACACATGCAGCTCCCGGAGACGGTCACAGCTTGTCT"
            "GTAAGCGGATGCCGGGAGCAGACAAGCCCGTCAGGGCGCGTCAGCGGGTGTTGGCGGGTGTCGGGGCGCA"
        )
        candidates, _ = server.design_cloning_primers(sequence, "GGTCTCA", "GAGACC")
        self.assertTrue(candidates)

        top = candidates[0]
        self.assertEqual(top["coordinate_system"], "zero_based_half_open")
        self.assertEqual(top["binding_target"], "insert")
        self.assertEqual(top["binding_target_length"], len(sequence))
        self.assertEqual(
            sequence[top["binding_start_f"]:top["binding_end_f"]],
            top["forward_core"],
        )
        self.assertEqual(
            server.reverse_complement(sequence[top["binding_start_r"]:top["binding_end_r"]]),
            top["reverse_core"],
        )

    def test_gibson_result_contains_exact_construct_review(self) -> None:
        vector = FIXTURES["vector_with_ecori_bamhi"]
        insert = FIXTURES["default_insert_300"]
        selection = {
            "start": 100,
            "end": 106,
            "length": 6,
            "wrapsOrigin": False,
        }
        edit = server.derive_vector_homology_plan(
            vector,
            selection,
            homology_length=20,
            topology="linear",
        )

        response = server.design_cloning_response({
            "label": "review-test",
            "insertName": "GFP",
            "sequence": insert,
            "method": "gibson",
            "leftHomology": edit["leftHomology"],
            "rightHomology": edit["rightHomology"],
            "homologyLength": 20,
            "vectorSequence": vector,
            "vectorTopology": "linear",
            "vectorEdit": edit,
        })

        top = response["results"][0]
        review = top["construct_review"]
        self.assertEqual(review["status"], "passed")
        self.assertEqual(review["insert"]["name"], "GFP")
        self.assertEqual(review["junctions"][0]["overlap"], vector[80:100])
        self.assertEqual(review["junctions"][1]["overlap"], vector[106:126])
        self.assertEqual(review["primerArchitecture"][0]["tail"], vector[80:100])
        self.assertEqual(review["primerArchitecture"][1]["tailSource"], vector[106:126])
        expected = review["expectedConstruct"]
        self.assertTrue(expected["available"])
        self.assertEqual(expected["editMode"], "replace")
        self.assertEqual(expected["editStart"], 100)
        self.assertEqual(expected["editEnd"], 106)
        self.assertEqual(expected["length"], len(vector) - 6 + len(insert))
        self.assertTrue(expected["sequenceDigest"].startswith("sha256:"))
        self.assertTrue(all(item["status"] == "passed" for item in review["checks"]))

    def test_gibson_construct_review_blocks_stale_vector_edit(self) -> None:
        vector = FIXTURES["vector_with_ecori_bamhi"]
        insert = FIXTURES["default_insert_300"]
        edit = server.derive_vector_homology_plan(
            vector,
            {"start": 100, "end": 106, "length": 6, "wrapsOrigin": False},
            homology_length=20,
            topology="linear",
        )
        edit["expectedSequence"] = "AAAAAA"

        response = server.design_cloning_response({
            "label": "stale-review-test",
            "sequence": insert,
            "method": "gibson",
            "leftHomology": edit["leftHomology"],
            "rightHomology": edit["rightHomology"],
            "homologyLength": 20,
            "vectorSequence": vector,
            "vectorTopology": "linear",
            "vectorEdit": edit,
        })

        review = response["results"][0]["construct_review"]
        self.assertEqual(review["status"], "blocked")
        self.assertFalse(review["expectedConstruct"]["available"])
        self.assertTrue(
            any(item["key"] == "vector_edit" and item["status"] == "blocked" for item in review["checks"])
        )


class TestVectorDrivenHomologyPlanning(unittest.TestCase):
    def make_payload(self, *, with_selection: bool = True) -> dict:
        vector = FIXTURES["vector_with_ecori_bamhi"]
        insert = FIXTURES["default_insert_300"]
        snapshot = {
            "lastWorkbenchPage": "cloning",
            "documentHash": "fnv1a64-v1:test-vector-hash",
            "currentSequenceDocument": {
                "name": "test-vector",
                "sequence": vector,
                "circular": False,
                "featureSummary": [],
            },
            "formState": {
                "cloning": {
                    "vectorSequence": vector,
                    "vectorTopology": "linear",
                    "vectorLabel": "test-vector",
                    "homologyLength": "20",
                }
            },
        }
        if with_selection:
            snapshot["currentSelection"] = {
                "start": 100,
                "end": 106,
                "length": 6,
                "wrapsOrigin": False,
                "sequence": vector[100:106],
            }
        return {
            "message": f"请用同源重组把 insert sequence: {insert} 插入当前载体",
            "snapshot": snapshot,
        }

    def test_derives_homology_from_open_vector_selection(self) -> None:
        payload = self.make_payload()
        response = server.cloning_agent_chat_response(payload)
        self.assertTrue(response["meta"]["readyToExecute"])
        self.assertEqual(response["meta"]["recommendedMethod"], "gibson")

        vector = FIXTURES["vector_with_ecori_bamhi"]
        design_payload = response["meta"]["draft"]["designPayload"]
        self.assertEqual(design_payload["leftHomology"], vector[80:100])
        self.assertEqual(design_payload["rightHomology"], vector[106:126])
        self.assertEqual(design_payload["vectorEdit"]["mode"], "replace")
        self.assertEqual(design_payload["vectorEdit"]["expectedSequence"], vector[100:106])

    def test_requires_selection_before_deriving_vector_junctions(self) -> None:
        response = server.cloning_agent_chat_response(self.make_payload(with_selection=False))
        self.assertFalse(response["meta"]["readyToExecute"])
        self.assertIsNone(response["meta"]["draft"])
        self.assertTrue(any("图谱中选择" in item for item in response["meta"]["missingInputs"]))

    def test_resolves_feature_name_as_an_insertion_anchor(self) -> None:
        payload = self.make_payload(with_selection=False)
        vector = FIXTURES["vector_with_ecori_bamhi"]
        insert = FIXTURES["default_insert_300"]
        payload["message"] = f"请用同源重组在 APOBEC3A 后面插入 insert sequence: {insert}"
        payload["snapshot"]["currentSequenceDocument"]["featureSummary"] = [
            {
                "name": "3xFLAG-APOBEC3A(human)",
                "type": "CDS",
                "start": 60,
                "end": 160,
                "strand": 1,
            }
        ]

        response = server.cloning_agent_chat_response(payload)

        self.assertTrue(response["meta"]["readyToExecute"])
        edit = response["meta"]["draft"]["designPayload"]["vectorEdit"]
        self.assertEqual(edit["selectionSource"], "feature_anchor")
        self.assertEqual(edit["resolvedAnchorName"], "3xFLAG-APOBEC3A(human)")
        self.assertEqual(edit["start"], 160)
        self.assertEqual(edit["end"], 160)
        self.assertEqual(edit["leftHomology"], vector[140:160])
        self.assertEqual(edit["rightHomology"], vector[160:180])

    def test_feature_anchor_preview_does_not_require_an_editor_selection(self) -> None:
        payload = self.make_payload(with_selection=False)
        insert = FIXTURES["default_insert_300"]
        payload["message"] = f"请用同源重组在 APOBEC3A 后面插入 insert sequence: {insert}"
        payload["snapshot"]["currentSequenceDocument"]["featureSummary"] = [
            {"name": "APOBEC3A", "type": "CDS", "start": 60, "end": 160, "strand": 1}
        ]
        plan = server.cloning_agent_chat_response(payload)

        response = server.cloning_agent_execute_response({
            **payload,
            "workspace": "cloning",
            "draft": plan["meta"]["draft"],
            "planSnapshotHash": payload["snapshot"]["documentHash"],
        })

        patch = response["sequencePatch"]
        self.assertEqual(patch["operations"][0]["kind"], "insert")
        self.assertEqual(patch["operations"][0]["position"], 160)

    def test_sequence_attachment_is_used_as_the_insert_without_chat_dump(self) -> None:
        payload = self.make_payload(with_selection=False)
        insert = FIXTURES["default_insert_300"]
        payload["message"] = "请用同源重组在 APOBEC3A 后面插入这个附件"
        payload["attachments"] = [{
            "name": "EGFP.gb",
            "sequence": insert,
            "circular": False,
            "featureCount": 1,
        }]
        payload["snapshot"]["currentSequenceDocument"]["featureSummary"] = [
            {"name": "APOBEC3A", "type": "CDS", "start": 60, "end": 160, "strand": 1}
        ]

        response = server.cloning_agent_chat_response(payload)

        self.assertTrue(response["meta"]["readyToExecute"])
        design = response["meta"]["draft"]["designPayload"]
        self.assertEqual(design["sequence"], insert)
        self.assertEqual(design["label"], "EGFP.gb")
        self.assertEqual(design["vectorEdit"]["start"], 160)

    def test_downstream_respects_reverse_strand_feature_direction(self) -> None:
        payload = self.make_payload(with_selection=False)
        insert = FIXTURES["default_insert_300"]
        payload["message"] = f"请用同源重组在 APOBEC3A 下游插入 insert sequence: {insert}"
        payload["snapshot"]["currentSequenceDocument"]["featureSummary"] = [
            {"name": "APOBEC3A", "type": "CDS", "start": 60, "end": 160, "strand": -1}
        ]

        response = server.cloning_agent_chat_response(payload)

        edit = response["meta"]["draft"]["designPayload"]["vectorEdit"]
        self.assertEqual(edit["start"], 60)

    def test_coexpression_intent_requires_an_explicit_strategy(self) -> None:
        payload = self.make_payload(with_selection=False)
        insert = FIXTURES["default_insert_300"]
        payload["message"] = f"在 APOBEC3A 后面插入 insert sequence: {insert}，一起表达"
        payload["snapshot"]["currentSequenceDocument"]["featureSummary"] = [
            {"name": "APOBEC3A", "type": "CDS", "start": 60, "end": 160, "strand": 1}
        ]

        response = server.cloning_agent_chat_response(payload)

        self.assertFalse(response["meta"]["readyToExecute"])
        self.assertTrue(any("P2A" in item and "IRES" in item for item in response["meta"]["missingInputs"]))

    def test_cloning_roles_do_not_confuse_insert_with_feature_anchor(self) -> None:
        inferred = server.infer_agent_message_inputs({
            "message": "把 GFP 插入当前载体的 lac-operon 后面并与上游蛋白一起表达，保持阅读框。先给方案，不要修改载体。"
        }, "cloning")

        self.assertEqual(inferred["query"], "GFP")
        self.assertEqual(inferred["insertionAnchorLabel"], "lac-operon")
        self.assertEqual(inferred["insertionAnchorSide"], "after")
        self.assertTrue(inferred["preserveReadingFrame"])

    def test_structured_inputs_override_chat_token_guessing(self) -> None:
        insert = FIXTURES["default_insert_300"]
        inferred = server.infer_agent_message_inputs({
            "message": "请继续当前任务",
            "structuredInputs": {
                "insertName": "EGFP",
                "insertSequence": insert,
                "insertionAnchorLabel": "lac-operon",
                "expressionStrategy": "fusion",
                "removeUpstreamStop": True,
            },
        }, "cloning")

        self.assertEqual(inferred["query"], "EGFP")
        self.assertEqual(inferred["sequence"], insert)
        self.assertEqual(inferred["insertionAnchorLabel"], "lac-operon")
        self.assertEqual(inferred["expressionStrategy"], "fusion")
        self.assertTrue(inferred["removeUpstreamStop"])

    def test_expression_strategy_history_does_not_replace_insert_identity(self) -> None:
        state = server.merge_agent_state_with_message(
            {},
            {
                "message": "请继续当前方案。",
                "history": [
                    {
                        "role": "user",
                        "content": "把 GFP 插入 lac-operon 后面并保持阅读框",
                    },
                    {
                        "role": "user",
                        "content": "表达策略：fusion",
                        "contextContent": (
                            "请使用我补充的结构化参数继续当前分子设计任务。\n"
                            "expression strategy: fusion"
                        ),
                    },
                ],
            },
            "cloning",
        )

        self.assertEqual(state["query"], "GFP")
        self.assertEqual(state["expressionStrategy"], "fusion")

    def test_fusion_plan_requires_stop_codon_removal_confirmation(self) -> None:
        insert = FIXTURES["default_insert_300"]
        vector = list("A" * 300)
        vector[147:150] = list("TAA")
        vector_sequence = "".join(vector)
        payload = {
            "message": f"把 GFP 插入 CDS1 后面做融合蛋白，保持阅读框。insert sequence: {insert}",
            "snapshot": {
                "lastWorkbenchPage": "cloning",
                "documentHash": "fnv1a64-v1:fusion-vector",
                "currentSequenceDocument": {
                    "name": "fusion-vector",
                    "sequence": vector_sequence,
                    "circular": False,
                    "featureSummary": [
                        {"name": "CDS1", "type": "CDS", "start": 60, "end": 150, "strand": 1}
                    ],
                },
                "formState": {
                    "cloning": {
                        "vectorSequence": vector_sequence,
                        "vectorTopology": "linear",
                        "vectorLabel": "fusion-vector",
                        "homologyLength": "20",
                    }
                },
            },
        }

        response = server.cloning_agent_chat_response(payload)
        self.assertFalse(response["meta"]["readyToExecute"])
        self.assertTrue(any("终止密码子 TAA" in item for item in response["meta"]["missingInputs"]))

        confirmed = server.cloning_agent_chat_response({
            **payload,
            "structuredInputs": {"removeUpstreamStop": True},
        })
        self.assertTrue(confirmed["meta"]["readyToExecute"])
        design = confirmed["meta"]["draft"]["designPayload"]
        self.assertEqual(design["vectorEdit"]["mode"], "replace")
        self.assertEqual(design["vectorEdit"]["start"], 147)
        self.assertEqual(design["vectorEdit"]["end"], 150)
        self.assertEqual(design["vectorEdit"]["expectedSequence"], "TAA")
        self.assertEqual(design["expressionReview"]["status"], "passed")

    def test_task_confirmation_exposes_expression_controls(self) -> None:
        payload = self.make_payload(with_selection=False)
        insert = FIXTURES["default_insert_300"]
        payload["message"] = f"在 APOBEC3A 后面插入 insert sequence: {insert}，一起表达"
        payload["snapshot"]["currentSequenceDocument"]["featureSummary"] = [
            {"name": "APOBEC3A", "type": "CDS", "start": 60, "end": 160, "strand": 1}
        ]
        payload["workspace"] = "cloning"
        local_config = {
            "enabled": False,
            "configured": False,
            "available": False,
            "provider": "local",
            "model": "",
            "message": "local rules",
        }

        with patch.object(server, "agent_llm_config", return_value=local_config):
            response = server.agent_chat_response(payload)

        confirmation = response["meta"]["taskConfirmation"]
        strategy = next(
            item for item in confirmation["missingParameters"]
            if item["key"] == "expressionStrategy"
        )
        self.assertEqual(strategy["kind"], "select")
        self.assertEqual(
            [item["value"] for item in strategy["options"]],
            ["fusion", "p2a", "ires"],
        )

    def test_stop_codon_gate_exposes_a_confirmation_checkbox(self) -> None:
        insert = FIXTURES["default_insert_300"]
        vector = list("A" * 300)
        vector[147:150] = list("TAA")
        vector_sequence = "".join(vector)
        payload = {
            "message": f"把 GFP 插入 CDS1 后面做融合蛋白，保持阅读框。insert sequence: {insert}",
            "workspace": "cloning",
            "snapshot": {
                "lastWorkbenchPage": "cloning",
                "documentHash": "fnv1a64-v1:fusion-checkbox",
                "currentSequenceDocument": {
                    "name": "fusion-vector",
                    "sequence": vector_sequence,
                    "circular": False,
                    "featureSummary": [
                        {"name": "CDS1", "type": "CDS", "start": 60, "end": 150, "strand": 1}
                    ],
                },
                "formState": {
                    "cloning": {
                        "vectorSequence": vector_sequence,
                        "vectorTopology": "linear",
                        "vectorLabel": "fusion-vector",
                        "homologyLength": "20",
                    }
                },
            },
        }
        local_config = {
            "enabled": False,
            "configured": False,
            "available": False,
            "provider": "local",
            "model": "",
            "message": "local rules",
        }

        with patch.object(server, "agent_llm_config", return_value=local_config):
            response = server.agent_chat_response(payload)

        controls = response["meta"]["taskConfirmation"]["missingParameters"]
        stop_confirmation = next(
            item for item in controls
            if item["key"] == "removeUpstreamStop"
        )
        self.assertEqual(stop_confirmation["kind"], "checkbox")

    def test_task_confirmation_deduplicates_controls_by_parameter_key(self) -> None:
        payload = self.make_payload(with_selection=False)
        payload["message"] = "把 GFP 插入 lac-operon 后面做融合蛋白，保持阅读框"
        payload["structuredInputs"] = {"expressionStrategy": "fusion"}
        payload["workspace"] = "cloning"
        local_config = {
            "enabled": False,
            "configured": False,
            "available": False,
            "provider": "local",
            "model": "",
            "message": "local rules",
        }

        with patch.object(server, "agent_llm_config", return_value=local_config):
            response = server.agent_chat_response(payload)

        controls = response["meta"]["taskConfirmation"]["missingParameters"]
        keys = [item["key"] for item in controls]
        self.assertTrue(all(keys))
        self.assertEqual(len(keys), len(set(keys)))

    def test_deterministic_missing_controls_replace_free_form_llm_keys(self) -> None:
        response = {
            "meta": {
                "readyToExecute": False,
                "draft": None,
                "missingInputs": ["请先提供 insert 序列或上传 insert 文件。"],
            },
            "messages": [],
            "plan": [],
        }
        task = {
            "workspace": "cloning",
            "missing": [{"key": "missing_0", "prompt": "Unknown model field", "kind": "text"}],
        }

        enriched = server.enrich_agent_task({}, "cloning", response, task)

        self.assertEqual([item["key"] for item in enriched["missing"]], ["insertSequence"])

    def test_design_request_uses_at_most_one_llm_round_trip(self) -> None:
        payload = {
            **self.make_payload(),
            "workspace": "cloning",
        }
        llm_config = {
            "enabled": True,
            "configured": True,
            "available": True,
            "provider": "test",
            "model": "test-model",
            "message": "test",
        }
        task = {
            "workspace": "cloning",
            "intent": "cloning_strategy",
            "goal": "Design a cloning plan",
            "summary": "Design a cloning plan",
            "action": "plan",
            "slots": {},
            "missing": [],
            "constraints": [],
            "toolCalls": [],
        }

        with (
            patch.object(server, "agent_llm_config", return_value=llm_config),
            patch.object(server, "agent_llm_json_completion", return_value=task) as completion,
        ):
            response = server.agent_chat_response(payload)

        self.assertTrue(response["meta"]["readyToExecute"])
        self.assertEqual(completion.call_count, 1)

    def test_structured_confirmation_skips_llm_round_trip(self) -> None:
        payload = {
            **self.make_payload(),
            "workspace": "cloning",
            "structuredInputs": {"insertName": "GFP"},
        }
        llm_config = {
            "enabled": True,
            "configured": True,
            "available": True,
            "provider": "test",
            "model": "test-model",
            "message": "test",
        }

        with (
            patch.object(server, "agent_llm_config", return_value=llm_config),
            patch.object(server, "agent_llm_json_completion") as completion,
        ):
            response = server.agent_chat_response(payload)

        self.assertTrue(response["meta"]["readyToExecute"])
        completion.assert_not_called()

    def test_execute_returns_preview_patch_without_applying_vector(self) -> None:
        payload = self.make_payload()
        plan = server.cloning_agent_chat_response(payload)
        execute_payload = {
            **payload,
            "workspace": "cloning",
            "draft": plan["meta"]["draft"],
            "planSnapshotHash": payload["snapshot"]["documentHash"],
        }
        response = server.cloning_agent_execute_response(execute_payload)
        patch = response["sequencePatch"]

        self.assertEqual(patch["schemaVersion"], 1)
        self.assertEqual(patch["baseHash"], payload["snapshot"]["documentHash"])
        self.assertEqual(patch["operations"][0]["kind"], "replace")
        self.assertEqual(patch["operations"][0]["start"], 100)
        self.assertEqual(patch["operations"][0]["end"], 106)
        self.assertEqual(patch["operations"][0]["sequence"], FIXTURES["default_insert_300"])
        self.assertEqual(patch["operations"][1]["kind"], "add_feature")
        self.assertIn("only a preview", patch["summary"])

    def test_agent_execute_does_not_call_llm_for_message_rewrite(self) -> None:
        payload = self.make_payload()
        plan = server.cloning_agent_chat_response(payload)
        execute_payload = {
            **payload,
            "workspace": "cloning",
            "draft": plan["meta"]["draft"],
            "planSnapshotHash": payload["snapshot"]["documentHash"],
        }
        llm_config = {
            "enabled": True,
            "configured": True,
            "available": True,
            "provider": "test",
            "model": "test-model",
            "message": "test",
        }

        with (
            patch.object(server, "agent_llm_config", return_value=llm_config),
            patch.object(server, "maybe_rewrite_agent_messages_with_llm") as rewrite,
        ):
            response = server.agent_execute_response(execute_payload)

        rewrite.assert_not_called()
        self.assertIsInstance(response.get("sequencePatch"), dict)

    def test_single_base_selection_is_an_insert_not_a_replacement(self) -> None:
        vector = FIXTURES["vector_with_ecori_bamhi"]
        plan = server.derive_vector_homology_plan(
            vector,
            {"start": 100, "end": 101, "wrapsOrigin": False},
            20,
            "linear",
        )
        self.assertEqual(plan["mode"], "insert")
        self.assertEqual(plan["start"], plan["end"])
        self.assertEqual(plan["rightHomology"], vector[100:120])

    def test_zero_width_editor_cursor_is_an_insert_plan(self) -> None:
        payload = self.make_payload()
        vector = FIXTURES["vector_with_ecori_bamhi"]
        payload["snapshot"]["currentSelection"] = {
            "start": 100,
            "end": 100,
            "length": 0,
            "wrapsOrigin": False,
            "sequence": "",
            "cursor": True,
        }

        response = server.cloning_agent_chat_response(payload)

        self.assertTrue(response["meta"]["readyToExecute"])
        edit = response["meta"]["draft"]["designPayload"]["vectorEdit"]
        self.assertEqual(edit["mode"], "insert")
        self.assertEqual(edit["start"], 100)
        self.assertEqual(edit["end"], 100)
        self.assertEqual(edit["selectionSource"], "editor_selection")
        self.assertEqual(edit["rightHomology"], vector[100:120])

    def test_execute_rejects_a_selection_changed_after_planning(self) -> None:
        payload = self.make_payload()
        plan = server.cloning_agent_chat_response(payload)
        payload["snapshot"]["currentSelection"] = {
            "start": 120,
            "end": 126,
            "length": 6,
            "wrapsOrigin": False,
            "sequence": FIXTURES["vector_with_ecori_bamhi"][120:126],
        }

        with self.assertRaisesRegex(server.ApiError, "选区已在规划后变化"):
            server.cloning_agent_execute_response({
                **payload,
                "workspace": "cloning",
                "draft": plan["meta"]["draft"],
            })

    def test_rejects_an_origin_wrapping_edit_selection(self) -> None:
        vector = FIXTURES["vector_with_ecori_bamhi"]
        with self.assertRaisesRegex(server.ApiError, "跨越环状载体原点"):
            server.derive_vector_homology_plan(
                vector,
                {"start": len(vector) - 6, "end": 6, "wrapsOrigin": True},
                20,
                "circular",
            )

    def test_auto_mode_still_waits_for_vector_plan_confirmation(self) -> None:
        payload = {
            **self.make_payload(),
            "workspace": "cloning",
            "agentMode": "auto",
            "runMode": "balanced",
        }
        local_config = {
            "enabled": False,
            "configured": False,
            "available": False,
            "provider": "local",
            "model": "",
            "message": "local rules",
        }
        with patch.object(server, "agent_llm_config", return_value=local_config):
            response = server.agent_chat_response(payload)

        meta = response["meta"]
        self.assertTrue(meta["readyToExecute"])
        self.assertFalse(meta["autoExecute"])
        self.assertTrue(meta["requiresExecutionConfirmation"])
        self.assertNotIn("design", response)

    def test_vector_design_request_is_not_intercepted_as_a_context_question(self) -> None:
        payload = {
            **self.make_payload(),
            "workspace": "cloning",
            "agentMode": "plan",
            "runMode": "fast",
        }
        local_config = {
            "enabled": False,
            "configured": False,
            "available": False,
            "provider": "local",
            "model": "",
            "message": "local rules",
        }
        with patch.object(server, "agent_llm_config", return_value=local_config):
            response = server.agent_chat_response(payload)

        self.assertEqual(response["meta"]["workspace"], "cloning")
        self.assertNotEqual(response["meta"]["intent"], "context_read")
        self.assertTrue(response["meta"]["readyToExecute"])
        self.assertIsInstance(response["meta"]["draft"]["designPayload"]["vectorEdit"], dict)


if __name__ == "__main__":
    unittest.main()
