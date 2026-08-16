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


class TestMultiFragmentGoldenGate(unittest.TestCase):
    def make_payload(self) -> dict:
        fragment_a = FIXTURES["default_insert_300"]
        fragment_b = fragment_a[::-1]
        return {
            "label": "multi-golden-gate",
            "method": "golden_gate",
            "fragments": [
                {"name": "Fragment 1", "sequence": fragment_a},
                {"name": "Fragment 2", "sequence": fragment_b},
            ],
            "typeIisEnzyme": "BsaI",
            "leftOverhang": "AATG",
            "fragmentOverhangs": ["GCTT"],
            "rightOverhang": "CGAG",
            "goldenGateClampLength": 4,
        }

    def test_designs_ordered_type_iis_primers_and_review(self) -> None:
        response = server.design_cloning_response(self.make_payload())
        top = response["results"][0]

        self.assertEqual(len(response["results"]), 5)
        self.assertEqual(top["method"], "golden_gate")
        self.assertEqual(top["fragment_count"], 2)
        self.assertEqual(top["overhangs"], ["AATG", "GCTT", "CGAG"])
        self.assertEqual(len(top["fragment_primers"]), 2)
        self.assertTrue(top["fragment_primers"][0]["f"].startswith(top["fragment_primers"][0]["forward_tail"]))
        self.assertEqual(top["construct_review"]["method"], "golden_gate")
        self.assertEqual(len(top["construct_review"]["junctions"]), 3)
        self.assertEqual(top["construct_review"]["junctions"][1]["overlap"], "GCTT")

    def test_accepts_complete_overhang_list(self) -> None:
        payload = self.make_payload()
        payload.pop("fragmentOverhangs")
        payload["overhangs"] = ["AATG", "GCTT", "CGAG"]
        top = server.design_cloning_response(payload)["results"][0]
        self.assertEqual(top["fragment_overhangs"], ["GCTT"])

    def test_requires_internal_overhangs_instead_of_guessing(self) -> None:
        payload = self.make_payload()
        payload.pop("fragmentOverhangs")
        with self.assertRaises(server.ApiError):
            server.design_cloning_response(payload)

    def test_scans_vector_and_agent_executes_multi_fragment_plan(self) -> None:
        payload = self.make_payload()
        payload["vectorSequence"] = "A" * 80 + "GGTCTC" + "A" * 20 + "GGTCTC" + "C" * 80
        payload["vectorTopology"] = "linear"
        top = server.design_cloning_response(payload)["results"][0]
        self.assertEqual(top["construct_review"]["checks"][-1]["key"], "vector_type_iis_sites")
        self.assertEqual(top["construct_review"]["checks"][-1]["status"], "passed")

        fragment_a = FIXTURES["default_insert_300"]
        fragment_b = fragment_a[::-1]
        agent_payload = {
            "workspace": "cloning",
            "message": "继续 Golden Gate 多片段方案，fragmentOverhangs: GCTT，left overhang: AATG，right overhang: CGAG",
            "snapshot": {
                "lastWorkbenchPage": "cloning",
                "formState": {
                    "cloning": {
                        "sequence": fragment_a,
                        "fragments": [
                            {"name": "Fragment 1", "sequence": fragment_a},
                            {"name": "Fragment 2", "sequence": fragment_b},
                        ],
                        "method": "golden_gate",
                        "typeIisEnzyme": "BsaI",
                        "leftOverhang": "AATG",
                        "fragmentOverhangs": ["GCTT"],
                        "rightOverhang": "CGAG",
                    }
                },
            },
        }
        plan = server.cloning_agent_chat_response(agent_payload)
        self.assertTrue(plan["meta"]["readyToExecute"])
        self.assertEqual(plan["meta"]["draft"]["designPayload"]["fragmentOverhangs"], ["GCTT"])
        execution = server.cloning_agent_execute_response({**agent_payload, "draft": plan["meta"]["draft"]})
        self.assertEqual(execution["design"]["results"][0]["construct_review"]["method"], "golden_gate")


if __name__ == "__main__":
    unittest.main()
