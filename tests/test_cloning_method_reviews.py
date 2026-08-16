from __future__ import annotations

import json
import unittest
from pathlib import Path
from types import SimpleNamespace

import server


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = json.loads(
    (ROOT / "tests" / "fixtures" / "offline_sequences.json").read_text(encoding="utf-8")
)


class TestGibsonSelfLigationRisk(unittest.TestCase):
    """Self-ligation hazard checks injected into Gibson construct reviews."""

    def make_gibson_review(self, left_homology: str, right_homology: str, homology_length: int) -> dict:
        return server.build_gibson_construct_review(
            {
                "leftHomology": left_homology,
                "rightHomology": right_homology,
                "homologyLength": homology_length,
                "vectorSequence": FIXTURES["vector_with_ecori_bamhi"],
                "vectorTopology": "circular",
                "vectorEdit": {"mode": "insert", "start": 100, "end": 100, "expectedSequence": ""},
            },
            SimpleNamespace(sequence=FIXTURES["default_insert_300"], name="insert"),
            {},
        )

    def test_assess_self_ligation_risk_pure_cases(self) -> None:
        arm = "AACCGGTTAACCGG"
        passed = {c["key"]: c for c in server.assess_self_ligation_risk(arm, "GGTTAACCAATTCC")}
        self.assertEqual(passed["vector_self_ligation"]["status"], "passed")
        self.assertEqual(passed["insert_self_annealing"]["status"], "passed")

        identical = {c["key"]: c for c in server.assess_self_ligation_risk(arm, arm)}
        self.assertEqual(identical["vector_self_ligation"]["status"], "review")
        self.assertEqual(identical["insert_self_annealing"]["status"], "review")

        complementary = {c["key"]: c for c in server.assess_self_ligation_risk(arm, server.reverse_complement(arm))}
        self.assertEqual(complementary["vector_self_ligation"]["status"], "review")
        self.assertEqual(complementary["insert_self_annealing"]["status"], "review")

        missing = {c["key"]: c for c in server.assess_self_ligation_risk("", arm)}
        self.assertEqual(missing["vector_self_ligation"]["status"], "review")
        self.assertEqual(missing["insert_self_annealing"]["status"], "review")

    def test_assess_fragment_overlap_uniqueness_pure_cases(self) -> None:
        arm = "AACCGGTTAACCGG"
        self.assertEqual(server.assess_fragment_overlap_uniqueness([arm, arm])["status"], "review")
        self.assertEqual(
            server.assess_fragment_overlap_uniqueness([arm, server.reverse_complement(arm)])["status"],
            "review",
        )
        self.assertEqual(
            server.assess_fragment_overlap_uniqueness([arm, "GGTTAACCAATTCC", "TGCATGCATGCATG"])["status"],
            "passed",
        )

    def test_gibson_review_flags_identical_arms(self) -> None:
        arm = "AACCGGTTAACCGG"
        review = self.make_gibson_review("GATTAC" + arm, arm + "GATTAC", len(arm))
        checks = {item["key"]: item for item in review["checks"]}
        self.assertEqual(checks["vector_self_ligation"]["status"], "review")
        self.assertEqual(checks["insert_self_annealing"]["status"], "review")

    def test_gibson_review_passes_distinct_arms(self) -> None:
        review = self.make_gibson_review(
            "GATTAC" + "AACCGGTTAACCGG",
            "GGTTAACCAATTCC" + "GATTAC",
            14,
        )
        checks = {item["key"]: item for item in review["checks"]}
        self.assertEqual(checks["vector_self_ligation"]["status"], "passed")
        self.assertEqual(checks["insert_self_annealing"]["status"], "passed")


class TestSingleFragmentCloningReviews(unittest.TestCase):
    def test_restriction_result_has_construct_review(self) -> None:
        response = server.design_cloning_response(
            {
                "label": "Restriction review",
                "sequence": FIXTURES["default_insert_300"],
                "method": "restriction",
                "forwardSite": "EcoRI",
                "reverseSite": "BamHI",
                "clampLength": 4,
                "vectorSequence": FIXTURES["vector_with_ecori_bamhi"],
                "vectorTopology": "circular",
            }
        )
        top = response["results"][0]
        review = top["construct_review"]
        checks = {item["key"]: item for item in review["checks"]}

        self.assertEqual(review["method"], "restriction")
        self.assertEqual(len(review["junctions"]), 2)
        self.assertEqual(checks["restriction_sites"]["status"], "passed")
        self.assertEqual(checks["insert_internal_sites"]["status"], "passed")
        self.assertEqual(checks["vector_unique_sites"]["status"], "passed")
        self.assertEqual(checks["directionality"]["status"], "passed")

    def test_single_golden_gate_result_has_construct_review(self) -> None:
        response = server.design_cloning_response(
            {
                "label": "Golden Gate review",
                "sequence": FIXTURES["default_insert_300"],
                "method": "golden_gate",
                "typeIisEnzyme": "BsaI",
                "leftOverhang": "AATG",
                "rightOverhang": "GCTT",
                "goldenGateClampLength": 4,
            }
        )
        top = response["results"][0]
        review = top["construct_review"]
        checks = {item["key"]: item for item in review["checks"]}

        self.assertEqual(review["method"], "golden_gate")
        self.assertEqual(len(review["junctions"]), 2)
        self.assertEqual(checks["primer_architecture"]["status"], "passed")
        self.assertEqual(checks["overhang_length"]["status"], "passed")
        self.assertEqual(checks["overhang_directionality"]["status"], "passed")
        self.assertEqual(checks["type_iis_internal_sites"]["status"], "passed")

    def test_single_golden_gate_exact_construct_is_digestible_only_with_real_backbone(self) -> None:
        vector = "AAAAA" + "AAAAA" + "GAGACC" + "AAAAAAAA" + "GGTCTC" + "TTTTT"
        response = server.design_cloning_response(
            {
                "label": "Strict Golden Gate review",
                "sequence": "ACGT" * 20,
                "method": "golden_gate",
                "typeIisEnzyme": "BsaI",
                "leftOverhang": "AAAA",
                "rightOverhang": "TTTT",
                "goldenGateClampLength": 4,
                "vectorSequence": vector,
                "vectorTopology": "linear",
            }
        )
        review = response["results"][0]["construct_review"]
        expected = review["expectedConstruct"]
        self.assertTrue(expected["available"])
        self.assertEqual(expected["vectorCutPositions"], [5, 31])
        self.assertEqual(review["checks"][-1]["key"], "exact_construct")
        self.assertEqual(review["checks"][-1]["status"], "passed")

        no_vector = server.design_cloning_response(
            {
                "label": "Review-only Golden Gate",
                "sequence": "ACGT" * 20,
                "method": "golden_gate",
                "typeIisEnzyme": "BsaI",
                "leftOverhang": "AAAA",
                "rightOverhang": "TTTT",
                "goldenGateClampLength": 4,
            }
        )
        self.assertFalse(no_vector["results"][0]["construct_review"]["expectedConstruct"]["available"])


if __name__ == "__main__":
    unittest.main()
