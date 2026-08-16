from __future__ import annotations

import json
import unittest
from pathlib import Path

import server
from tests.run_agent_harness import (
    REQUIRED_ARTIFACT_TYPES,
    reverse_complement,
    run_runtime_contract_case,
    validate_artifact_package,
    validate_result_shape,
)


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = json.loads(
    (ROOT / "tests" / "fixtures" / "offline_sequences.json").read_text(encoding="utf-8")
)


class TestAgentHarnessV3(unittest.TestCase):
    def test_reverse_complement_supports_iupac(self) -> None:
        self.assertEqual(reverse_complement("ACGTRYSWKMBDHVN"), "NBDHVKMWSRYACGT")

    def test_runtime_contract_is_green(self) -> None:
        result = run_runtime_contract_case()
        self.assertTrue(result["passed"])
        self.assertGreaterEqual(len(result["checks"]), 10)

    def test_current_artifact_contract_is_accepted(self) -> None:
        artifacts = []
        for index, artifact_type in enumerate(sorted(REQUIRED_ARTIFACT_TYPES)):
            data: dict[str, object] = {}
            if artifact_type == "candidate_table":
                data = {"candidates": [{"rank": 1}]}
            elif artifact_type == "ordering_table":
                data = {"items": [{"rank": 1}]}
            elif artifact_type == "risk_report":
                data = {"checks": [{"label": "input", "status": "pass"}]}
            elif artifact_type == "protocol_draft":
                data = {"summaryMarkdown": "推荐方案\nFinal Review"}
            artifacts.append(
                {
                    "artifact_id": f"artifact-{index}",
                    "type": artifact_type,
                    "title": artifact_type,
                    "filename": f"{artifact_type}.json",
                    "data": data,
                }
            )
        response = {
            "meta": {
                "artifactPackage": {
                    "workspace": "cloning",
                    "status": "available",
                    "source": "backend_artifact_package_v1",
                    "summaryMarkdown": "推荐方案\nFinal Review",
                    "artifacts": artifacts,
                }
            }
        }
        checks: list[dict[str, object]] = []
        validate_artifact_package(response, "cloning", checks)
        self.assertTrue(all(check["ok"] for check in checks), checks)

    def test_multifragment_gibson_biology_contract(self) -> None:
        design_payload = {
            "label": "Harness multi-fragment Gibson",
            "method": "gibson",
            "fragments": [
                {"name": "Reporter", "sequence": FIXTURES["default_insert_300"]},
                {"name": "Linker cassette", "sequence": FIXTURES["default_dna_520"]},
            ],
            "leftHomology": FIXTURES["left_homology_20"],
            "rightHomology": FIXTURES["right_homology_20"],
            "homologyLength": 20,
        }
        response = server.design_cloning_response(design_payload)
        checks: list[dict[str, object]] = []
        validate_result_shape(
            "cloning",
            response["results"],
            {"minResults": 1},
            checks,
            design_payload=design_payload,
        )
        failures = [check for check in checks if not check["ok"]]
        self.assertFalse(failures, failures)


if __name__ == "__main__":
    unittest.main()
