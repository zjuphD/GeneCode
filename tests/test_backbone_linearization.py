#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ["AGENT_LLM_ENABLED"] = "0"
import server  # noqa: E402


FIXTURES = json.loads((ROOT / "tests" / "fixtures" / "offline_sequences.json").read_text(encoding="utf-8"))


class TestBackboneLinearization(unittest.TestCase):
    def test_circular_gibson_includes_inverse_pcr_backbone_pair(self) -> None:
        vector = FIXTURES["vector_with_ecori_bamhi"]
        insert = FIXTURES["default_insert_300"]
        edit = server.derive_vector_homology_plan(
            vector,
            {"start": 100, "end": 106, "length": 6, "wrapsOrigin": False},
            homology_length=20,
            topology="circular",
        )

        response = server.design_cloning_response({
            "label": "circular-backbone-test",
            "sequence": insert,
            "method": "gibson",
            "leftHomology": edit["leftHomology"],
            "rightHomology": edit["rightHomology"],
            "homologyLength": 20,
            "vectorSequence": vector,
            "vectorTopology": "circular",
            "vectorEdit": edit,
        })

        top = response["results"][0]
        backbone = top["backbone_linearization"]
        self.assertTrue(backbone["available"])
        self.assertEqual(backbone["method"], "inverse_pcr")
        self.assertEqual(backbone["ampliconLength"], len(vector) - 6)
        self.assertEqual(backbone["editStart"], 100)
        self.assertEqual(backbone["editEnd"], 106)

        backbone_template = vector[106:] + vector[:100]
        self.assertEqual(backbone_template[:len(backbone["forwardCore"])], backbone["forwardCore"])
        self.assertEqual(
            server.reverse_complement(backbone_template[-len(backbone["reverseCore"]):]),
            backbone["reverseCore"],
        )

        review = top["construct_review"]
        self.assertEqual(review["backboneLinearization"]["ampliconLength"], len(vector) - 6)
        self.assertTrue(any(item["key"] == "backbone_linearization" for item in review["checks"]))

    def test_linear_vector_keeps_existing_review_contract(self) -> None:
        vector = FIXTURES["vector_with_ecori_bamhi"]
        insert = FIXTURES["default_insert_300"]
        edit = server.derive_vector_homology_plan(
            vector,
            {"start": 100, "end": 106, "length": 6, "wrapsOrigin": False},
            homology_length=20,
            topology="linear",
        )
        response = server.design_cloning_response({
            "label": "linear-backbone-test",
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
        self.assertIsNone(review["backboneLinearization"])
        self.assertEqual(review["status"], "passed")

    def test_agent_execute_exposes_backbone_step_and_result(self) -> None:
        vector = FIXTURES["vector_with_ecori_bamhi"]
        insert = FIXTURES["default_insert_300"]
        payload = {
            "workspace": "cloning",
            "message": f"请用 Gibson 把 insert sequence: {insert} 接入当前载体",
            "snapshot": {
                "lastWorkbenchPage": "cloning",
                "documentHash": "fnv1a64-v1:backbone-agent-test",
                "currentSequenceDocument": {
                    "name": "circular-vector",
                    "sequence": vector,
                    "circular": True,
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
                        "vectorTopology": "circular",
                        "vectorLabel": "circular-vector",
                        "homologyLength": "20",
                    }
                },
            },
        }
        plan = server.cloning_agent_chat_response(payload)
        self.assertTrue(plan["meta"]["readyToExecute"])

        response = server.cloning_agent_execute_response({
            **payload,
            "draft": plan["meta"]["draft"],
            "planSnapshotHash": payload["snapshot"]["documentHash"],
        })
        top = response["design"]["results"][0]
        self.assertTrue(top["backbone_linearization"]["available"])
        self.assertTrue(any(item["tool"] == "design_backbone_linearization" for item in response["runLog"]))


if __name__ == "__main__":
    unittest.main()
