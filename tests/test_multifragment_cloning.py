#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ["AGENT_LLM_ENABLED"] = "0"
import server  # noqa: E402


FIXTURES = json.loads((ROOT / "tests" / "fixtures" / "offline_sequences.json").read_text(encoding="utf-8"))


class TestMultiFragmentOverlapUniqueness(unittest.TestCase):
    """Multi-fragment Gibson junction uniqueness and self-ligation checks."""

    def make_review(self, fragment_b_start: str) -> dict:
        arm1 = "AACCGGTTAACCGG"
        arm2 = "GGTTAACCAATTCC"
        fragment_a = FIXTURES["default_insert_300"]
        fragment_b = fragment_b_start + "TGCATGCATGCATGCATGCATGCATGCATGC"
        return server.build_multifragment_construct_review(
            {
                "leftHomology": "GATTAC" + arm1,
                "rightHomology": arm2 + "GATTAC",
                "homologyLength": len(arm1),
                "vectorSequence": FIXTURES["vector_with_ecori_bamhi"],
                "vectorTopology": "linear",
                "vectorEdit": {"mode": "insert", "start": 100, "end": 100, "expectedSequence": ""},
            },
            [
                SimpleNamespace(sequence=fragment_a, name="f1"),
                SimpleNamespace(sequence=fragment_b, name="f2"),
            ],
            {},
        )

    def test_duplicate_internal_overlap_flagged(self) -> None:
        # fragment_b starts with the vector's left arm -> the f1->f2 junction
        # reuses the vector left junction sequence, allowing mis-assembly.
        arm1 = "AACCGGTTAACCGG"
        review = self.make_review(arm1)
        checks = {item["key"]: item for item in review["checks"]}
        self.assertEqual(checks["fragment_overlap_uniqueness"]["status"], "review")
        self.assertEqual(checks["vector_self_ligation"]["status"], "passed")
        self.assertEqual(review["status"], "review")

    def test_unique_internal_overlaps_pass(self) -> None:
        review = self.make_review("TGCATGCATGCATG")
        checks = {item["key"]: item for item in review["checks"]}
        self.assertEqual(checks["fragment_overlap_uniqueness"]["status"], "passed")
        self.assertEqual(checks["vector_self_ligation"]["status"], "passed")


class TestMultiFragmentCloning(unittest.TestCase):
    def make_payload(self) -> dict:
        vector = FIXTURES["vector_with_ecori_bamhi"]
        fragment_a = FIXTURES["default_insert_300"]
        fragment_b = fragment_a[::-1]
        snapshot = {
            "lastWorkbenchPage": "cloning",
            "documentHash": "fnv1a64-v1:multi-fragment-test",
            "currentSequenceDocument": {
                "name": "multi-fragment-vector",
                "sequence": vector,
                "circular": False,
                "featureSummary": [],
            },
            "currentSelection": {
                "start": 100,
                "end": 106,
                "length": 6,
                "wrapsOrigin": False,
                "sequence": vector[100:106],
            },
            "formState": {
                "cloning": {
                    "vectorSequence": vector,
                    "vectorTopology": "linear",
                    "vectorLabel": "multi-fragment-vector",
                    "homologyLength": "20",
                }
            },
        }
        return {
            "workspace": "cloning",
            "message": f"用 Gibson 把片段1: {fragment_a} 和片段2: {fragment_b} 接入当前载体",
            "snapshot": snapshot,
        }

    def test_designs_ordered_fragment_primer_sets_and_construct_review(self) -> None:
        payload = self.make_payload()
        plan = server.cloning_agent_chat_response(payload)

        self.assertTrue(plan["meta"]["readyToExecute"])
        self.assertEqual(plan["meta"]["recommendedMethod"], "gibson")
        design_payload = plan["meta"]["draft"]["designPayload"]
        self.assertEqual(len(design_payload["fragments"]), 2)

        execution = server.cloning_agent_execute_response({**payload, "draft": plan["meta"]["draft"]})
        top = execution["design"]["results"][0]
        review = top["construct_review"]
        self.assertEqual(top["fragment_count"], 2)
        self.assertEqual(len(top["fragment_primers"]), 2)
        self.assertEqual(len(review["junctions"]), 3)
        self.assertEqual(review["status"], "passed")
        self.assertEqual(review["expectedConstruct"]["length"], len(FIXTURES["vector_with_ecori_bamhi"]) - 6 + 600)

    def test_apply_preview_keeps_each_fragment_as_an_annotation(self) -> None:
        payload = self.make_payload()
        plan = server.cloning_agent_chat_response(payload)
        execution = server.cloning_agent_execute_response({**payload, "draft": plan["meta"]["draft"]})
        patch = execution["sequencePatch"]

        self.assertEqual([item["kind"] for item in patch["operations"]], ["replace", "add_feature", "add_feature"])
        feature_names = [item["feature"]["name"] for item in patch["operations"][1:]]
        self.assertEqual(feature_names, ["Fragment_1", "Fragment_2"])
        self.assertEqual(patch["operations"][1]["feature"]["start"], 100)
        self.assertEqual(patch["operations"][2]["feature"]["start"], 100 + 300)

    def test_single_insert_path_is_unchanged(self) -> None:
        vector = FIXTURES["vector_with_ecori_bamhi"]
        insert = FIXTURES["default_insert_300"]
        edit = server.derive_vector_homology_plan(
            vector,
            {"start": 100, "end": 106, "length": 6, "wrapsOrigin": False},
            20,
            "linear",
        )
        response = server.design_cloning_response({
            "label": "single-insert",
            "sequence": insert,
            "method": "gibson",
            "leftHomology": edit["leftHomology"],
            "rightHomology": edit["rightHomology"],
            "homologyLength": 20,
            "vectorSequence": vector,
            "vectorTopology": "linear",
            "vectorEdit": edit,
        })
        self.assertNotIn("fragment_primers", response["results"][0])
        self.assertEqual(response["results"][0]["construct_review"]["status"], "passed")


if __name__ == "__main__":
    unittest.main()
