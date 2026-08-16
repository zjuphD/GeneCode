#!/usr/bin/env python3
"""Direct-function regression tests for TASK-019 Sequence Context Tools.

These tests call server.py functions directly and do not need a browser,
network service, or API key.
"""

from __future__ import annotations

import sys
import os
import unittest
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ["AGENT_LLM_ENABLED"] = "0"
import server  # noqa: E402


# ── Fixtures ──────────────────────────────────────────────────────────────────

PUC19_NAME = "pUC19"
# Minimal pUC19-like sequence (200 bp) with some GC content
PUC19_SEQ = (
    "TCGCGCGTTTCGGTGATGACGGTGAAAACCTCTGACACATGCAGCTCCCGGAGACGGTCACAGCTTGTCT"
    "GTAAGCGGATGCCGGGAGCAGACAAGCCCGTCAGGGCGCGTCAGCGGGTGTTGGCGGGTGTCGGGGCGCA"
    "GCCATGACCCAGTCACGTAGCGATAGCGGAGTGTATACTGGCTTAACTATGCGGCATCAG"
)

# TASK-018 frontend shape: featureSummary with 0-based half-open start/end
PUC19_FEATURE_SUMMARY = [
    {"type": "CDS", "name": "lacZ", "start": 9, "end": 50},
    {"type": "rep_origin", "name": "ori", "start": 99, "end": 150},
    {"type": "promoter", "name": "lac promoter", "start": 59, "end": 80},
]

# Legacy GenBank-style features (1-based inclusive)
PUC19_LEGACY_FEATURES = [
    {"type": "CDS", "location": "10..50", "qualifiers": {"gene": "lacZ"}},
    {"type": "rep_origin", "location": "100..150", "qualifiers": {"note": "ori"}},
    {"type": "promoter", "location": "60..80", "qualifiers": {"note": "lac promoter"}},
]

# Frontend shape: circular boolean
SELECTION_FRONTEND = {
    "start": 5,
    "end": 55,
    "wrapsOrigin": False,
}

SELECTION_NO_WRAP = {
    "start": 0,
    "end": 40,
    "wrapsOrigin": False,
}

SELECTION_WRAP = {
    "start": 180,
    "end": 30,  # wraps past origin on a 200bp circular
    "wrapsOrigin": True,
}


def make_frontend_snapshot(
    doc_name: str = PUC19_NAME,
    doc_seq: str = PUC19_SEQ,
    circular: bool = True,
    doc_accession: str | None = "L09137",
    doc_version: str | None = "L09137.2",
    feature_summary: list[dict[str, Any]] | None = PUC19_FEATURE_SUMMARY,
    selection: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a snapshot using the exact TASK-018 frontend shape."""
    snapshot: dict[str, Any] = {
        "currentSequenceDocument": {
            "name": doc_name,
            "sequence": doc_seq,
            "circular": circular,
            "accession": doc_accession,
            "version": doc_version,
            "featureSummary": feature_summary or [],
        },
    }
    if selection is not None:
        snapshot["currentSelection"] = selection
    return snapshot


def make_legacy_snapshot(
    doc_name: str = PUC19_NAME,
    doc_seq: str = PUC19_SEQ,
    doc_topology: str = "circular",
    doc_accession: str | None = "L09137",
    doc_version: str | None = "L09137.2",
    doc_features: list[dict[str, Any]] | None = PUC19_LEGACY_FEATURES,
    selection: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a snapshot using legacy topology/features shape."""
    snapshot: dict[str, Any] = {
        "currentSequenceDocument": {
            "name": doc_name,
            "sequence": doc_seq,
            "topology": doc_topology,
            "accession": doc_accession,
            "version": doc_version,
            "features": doc_features or [],
        },
    }
    if selection is not None:
        snapshot["currentSelection"] = selection
    return snapshot


# ── Tests ─────────────────────────────────────────────────────────────────────


class TestContextToolRegistry(unittest.TestCase):
    """Verify four context tools are registered in AGENT_TOOL_REGISTRY."""

    def test_read_open_sequence_registered(self):
        tool = server.AGENT_TOOL_REGISTRY.get("read_open_sequence")
        self.assertIsNotNone(tool)
        self.assertEqual(tool["workspace"], "shared")
        self.assertEqual(tool["riskLevel"], "low")
        self.assertTrue(tool["canAutoRun"])
        self.assertFalse(tool["requiresConfirmation"])

    def test_read_selected_region_registered(self):
        tool = server.AGENT_TOOL_REGISTRY.get("read_selected_region")
        self.assertIsNotNone(tool)
        self.assertEqual(tool["workspace"], "shared")
        self.assertEqual(tool["riskLevel"], "low")
        self.assertTrue(tool["canAutoRun"])
        self.assertFalse(tool["requiresConfirmation"])

    def test_list_features_registered(self):
        tool = server.AGENT_TOOL_REGISTRY.get("list_features")
        self.assertIsNotNone(tool)
        self.assertEqual(tool["workspace"], "shared")
        self.assertEqual(tool["riskLevel"], "low")

    def test_sequence_stats_registered(self):
        tool = server.AGENT_TOOL_REGISTRY.get("sequence_stats")
        self.assertIsNotNone(tool)
        self.assertEqual(tool["workspace"], "shared")
        self.assertEqual(tool["riskLevel"], "low")


class TestCheckToolRegistry(unittest.TestCase):
    """Verify the three remote check tools are registered with safe contracts."""

    def _assert_check_tool(self, name: str, workspace: str) -> None:
        tool = server.AGENT_TOOL_REGISTRY.get(name)
        self.assertIsNotNone(tool)
        self.assertEqual(tool["workspace"], workspace)
        self.assertEqual(tool["riskLevel"], "low")
        self.assertTrue(tool["canAutoRun"])
        self.assertFalse(tool["requiresConfirmation"])
        self.assertIs(tool["writes_sequence"], False)
        self.assertIs(tool["may_generate_patch"], False)
        self.assertEqual(tool["output_type"], "verification")

    def test_check_rt_specificity_registered(self):
        self._assert_check_tool("check_rt_specificity", "rtqpcr")

    def test_check_sgrna_offtarget_registered(self):
        self._assert_check_tool("check_sgrna_offtarget", "sgrna")

    def test_check_sirna_offtarget_registered(self):
        self._assert_check_tool("check_sirna_offtarget", "sirna")

    def test_check_tools_never_write_sequence(self):
        for name in ("check_rt_specificity", "check_sgrna_offtarget", "check_sirna_offtarget"):
            descriptor = server.AGENT_TOOL_REGISTRY[name]
            self.assertIs(descriptor["writes_sequence"], False, name)


class TestDetectCheckExecute(unittest.TestCase):
    """Verify validation-only requests are routed to the registered check tools."""

    def test_rtqpcr_with_check_results_routes_to_check_tool(self):
        tool = server.detect_check_execute({"checkResults": [{"f": "AAAA", "r": "TTTT"}]}, "rtqpcr")
        self.assertEqual(tool, "check_rt_specificity")

    def test_sgrna_routes_to_check_tool(self):
        tool = server.detect_check_execute({"checkResults": [{"seq": "ACGT"}]}, "sgrna")
        self.assertEqual(tool, "check_sgrna_offtarget")

    def test_sirna_routes_to_check_tool(self):
        tool = server.detect_check_execute({"checkResults": [{"target_seq_dna": "ACGT"}]}, "sirna")
        self.assertEqual(tool, "check_sirna_offtarget")

    def test_cloning_never_routes_to_check(self):
        self.assertIsNone(server.detect_check_execute({"checkResults": [{}]}, "cloning"))

    def test_empty_check_results_does_not_route(self):
        self.assertIsNone(server.detect_check_execute({"checkResults": []}, "rtqpcr"))
        self.assertIsNone(server.detect_check_execute({}, "rtqpcr"))


class TestCheckAgentExecuteStream(unittest.TestCase):
    """Verify the check pipeline emits step events, runLog, plan, and meta."""

    def _build_payload(self) -> dict[str, Any]:
        return {
            "workspace": "rtqpcr",
            "agentMode": "plan",
            "message": "运行验证",
            "checkResults": [{"f": "AAAA", "r": "TTTT"}],
            "draft": {
                "designPayload": {
                    "species": "Sus scrofa",
                    "strain": "",
                    "selectedAccession": "NM_001",
                }
            },
        }

    def test_emits_step_events_and_complete_response(self):
        original = server.CHECK_HANDLER_BY_TOOL["check_rt_specificity"]
        server.CHECK_HANDLER_BY_TOOL["check_rt_specificity"] = lambda payload: {
            "meta": {"checked": 1, "limit": 1},
            "messages": ["已完成特异性检查。"],
            "results": [{"f": "AAAA", "r": "TTTT", "specificityCheck": {"status": "Pass"}}],
        }
        try:
            events = list(server.check_agent_execute_stream(self._build_payload(), "rtqpcr"))
        finally:
            server.CHECK_HANDLER_BY_TOOL["check_rt_specificity"] = original

        types = [event["event"] for event in events]
        self.assertEqual(types, ["step_start", "step_done", "complete"])
        step_done = events[1]["data"]
        self.assertEqual(step_done["tool"], "check_rt_specificity")
        self.assertEqual(step_done["verifyStatus"], "completed")
        complete = events[2]["data"]
        self.assertEqual(complete["meta"]["workspace"], "rtqpcr")
        self.assertEqual(complete["meta"]["verificationStatus"], "completed")
        self.assertEqual(complete["check"]["results"][0]["specificityCheck"]["status"], "Pass")
        self.assertEqual(complete["runLog"][0]["tool"], "check_rt_specificity")
        self.assertEqual(complete["plan"][0]["tool"], "check_rt_specificity")

    def test_degraded_when_handler_raises(self):
        original = server.CHECK_HANDLER_BY_TOOL["check_rt_specificity"]
        server.CHECK_HANDLER_BY_TOOL["check_rt_specificity"] = lambda payload: (_ for _ in ()).throw(
            server.ApiError("NCBI 波动")
        )
        try:
            events = list(server.check_agent_execute_stream(self._build_payload(), "rtqpcr"))
        finally:
            server.CHECK_HANDLER_BY_TOOL["check_rt_specificity"] = original

        complete = events[-1]["data"]
        self.assertEqual(complete["meta"]["verificationStatus"], "degraded")
        self.assertIn("未能完成", complete["messages"][0])
        self.assertEqual(complete["runLog"][0]["status"], "degraded")

    def test_validate_tool_execution_allows_low_risk_in_plan_mode(self):
        # Must not raise in plan mode (low risk, no confirmation required)
        server.validate_tool_execution("check_rt_specificity", "plan")

    def test_validate_tool_execution_blocks_in_review_mode(self):
        # Review mode blocks medium+ risk; check tools are read/low so this
        # should pass at the risk layer, but the execute entry blocks review
        # mode wholesale — assert the review gate on the execute path.
        with self.assertRaises(server.ApiError):
            payload = self._build_payload()
            payload["agentMode"] = "review"
            server.agent_execute_response(payload)


class TestReadOpenSequenceFrontendShape(unittest.TestCase):
    """Test run_context_read_open_sequence with TASK-018 frontend shape."""

    def test_puc19_circular_from_frontend(self):
        """circular:true should report topology=circular."""
        snapshot = make_frontend_snapshot()
        result = server.run_context_read_open_sequence(snapshot)
        self.assertIsNotNone(result)
        self.assertEqual(result["tool"], "read_open_sequence")
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["name"], PUC19_NAME)
        self.assertEqual(result["length"], len(PUC19_SEQ))
        self.assertEqual(result["topology"], "circular")
        self.assertEqual(result["accession"], "L09137")
        self.assertEqual(result["version"], "L09137.2")

    def test_linear_from_frontend(self):
        """circular:false should report topology=linear."""
        snapshot = make_frontend_snapshot(circular=False)
        result = server.run_context_read_open_sequence(snapshot)
        self.assertIsNotNone(result)
        self.assertEqual(result["topology"], "linear")

    def test_legacy_topology_fallback(self):
        """Legacy topology:string should still work."""
        snapshot = make_legacy_snapshot()
        result = server.run_context_read_open_sequence(snapshot)
        self.assertIsNotNone(result)
        self.assertEqual(result["topology"], "circular")

    def test_length_is_server_computed(self):
        """Length must come from sanitized bases, not client-provided value."""
        snapshot = make_frontend_snapshot()
        result = server.run_context_read_open_sequence(snapshot)
        self.assertIsNotNone(result)
        sanitized = server.clean_sequence_letters(PUC19_SEQ)
        self.assertEqual(result["length"], len(sanitized))

    def test_no_document_returns_none(self):
        snapshot: dict[str, Any] = {}
        result = server.run_context_read_open_sequence(snapshot)
        self.assertIsNone(result)

    def test_empty_sequence_returns_none(self):
        snapshot: dict[str, Any] = {"currentSequenceDocument": {"name": "empty", "sequence": ""}}
        result = server.run_context_read_open_sequence(snapshot)
        self.assertIsNone(result)


class TestListFeaturesFrontendShape(unittest.TestCase):
    """Test run_context_list_features with featureSummary (0-based half-open)."""

    def test_feature_count_from_summary(self):
        """featureSummary should produce correct feature count."""
        snapshot = make_frontend_snapshot()
        result = server.run_context_list_features(snapshot)
        self.assertIsNotNone(result)
        self.assertEqual(result["tool"], "list_features")
        self.assertEqual(result["featureCount"], len(PUC19_FEATURE_SUMMARY))

    def test_feature_names_from_summary(self):
        """featureSummary names should be preserved."""
        snapshot = make_frontend_snapshot()
        result = server.run_context_list_features(snapshot)
        self.assertIsNotNone(result)
        features = result["features"]
        names = {f["name"] for f in features}
        self.assertIn("lacZ", names)
        self.assertIn("ori", names)
        self.assertIn("lac promoter", names)

    def test_features_are_zero_based_half_open(self):
        """Output features should use 0-based half-open coordinates."""
        snapshot = make_frontend_snapshot(feature_summary=[
            {"type": "CDS", "name": "lacZ", "start": 9, "end": 50},
        ])
        result = server.run_context_list_features(snapshot)
        self.assertIsNotNone(result)
        feat = result["features"][0]
        # 0-based half-open: start=9, end=50
        self.assertEqual(feat["start"], 9)
        self.assertEqual(feat["end"], 50)

    def test_legacy_features_fallback(self):
        """Legacy GenBank features (1-based inclusive) should be converted to 0-based half-open."""
        snapshot = make_legacy_snapshot()
        result = server.run_context_list_features(snapshot)
        self.assertIsNotNone(result)
        self.assertEqual(result["featureCount"], len(PUC19_LEGACY_FEATURES))
        # CDS "10..50" (1-based inclusive) → 0-based half-open [9, 50)
        cds = next(f for f in result["features"] if f["type"] == "CDS")
        self.assertEqual(cds["start"], 9)
        self.assertEqual(cds["end"], 50)

    def test_selection_overlap_count(self):
        """Selection overlap should work with 0-based half-open features."""
        snapshot = make_frontend_snapshot(selection=SELECTION_FRONTEND)
        result = server.run_context_list_features(snapshot)
        self.assertIsNotNone(result)
        self.assertIn("selectedOverlapCount", result)
        # SELECTION_FRONTEND: [5, 55) 0-based half-open
        # CDS: [9, 50) → overlaps (9 < 55 and 5 < 50)
        # promoter: [59, 80) → no overlap (59 >= 55)
        # rep_origin: [99, 150) → no overlap
        self.assertEqual(result["selectedOverlapCount"], 1)

    def test_no_selection_no_overlap(self):
        snapshot = make_frontend_snapshot(selection=None)
        result = server.run_context_list_features(snapshot)
        self.assertIsNotNone(result)
        self.assertNotIn("selectedOverlapCount", result)

    def test_no_document_returns_none(self):
        result = server.run_context_list_features({})
        self.assertIsNone(result)

    def test_circular_wrapped_overlap(self):
        """Features should overlap a wrapping selection on circular sequence."""
        snapshot = make_frontend_snapshot(selection=SELECTION_WRAP)
        result = server.run_context_list_features(snapshot)
        self.assertIsNotNone(result)
        self.assertIn("selectedOverlapCount", result)
        # SELECTION_WRAP: [180, 30) wraps = [180,200) + [0,30)
        # CDS [9, 50): intersects [0,30) → overlap
        # promoter [59, 80): no overlap
        # rep_origin [99, 150): no overlap
        self.assertEqual(result["selectedOverlapCount"], 1)

    def test_empty_features(self):
        snapshot = make_frontend_snapshot(feature_summary=[])
        result = server.run_context_list_features(snapshot)
        self.assertIsNotNone(result)
        self.assertEqual(result["featureCount"], 0)
        self.assertEqual(result["features"], [])


class TestReadSelectedRegionWrapped(unittest.TestCase):
    """Test run_context_read_selected_region with wrapped selections."""

    def test_valid_non_wrapping_selection(self):
        snapshot = make_frontend_snapshot(selection=SELECTION_FRONTEND)
        result = server.run_context_read_selected_region(snapshot)
        self.assertIsNotNone(result)
        self.assertEqual(result["tool"], "read_selected_region")
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["start"], 5)
        self.assertEqual(result["end"], 55)
        self.assertEqual(result["length"], 50)
        self.assertEqual(result["displayRange"], "6..55")
        self.assertFalse(result["wrapsOrigin"])
        self.assertIn("selectedSeq", result)
        self.assertEqual(len(result["selectedSeq"]), 50)

    def test_wrapped_selection_reconstructed(self):
        """Wrapped selection should produce seq[start:] + seq[:end]."""
        snapshot = make_frontend_snapshot(selection=SELECTION_WRAP)
        result = server.run_context_read_selected_region(snapshot)
        self.assertIsNotNone(result)
        self.assertTrue(result["wrapsOrigin"])
        # [180, 30) on 200bp → seq[180:] + seq[:30] = 20 + 30 = 50 bp
        self.assertEqual(result["length"], 50)
        expected_seq = PUC19_SEQ[180:] + PUC19_SEQ[:30]
        self.assertEqual(result["selectedSeq"], expected_seq)
        self.assertEqual(result["displayRange"], "181..200 + 1..30")

    def test_wrapped_selection_gc_stats(self):
        """Selection stats for wrapped selection should use reconstructed sequence."""
        snapshot = make_frontend_snapshot(selection=SELECTION_WRAP)
        result = server.run_context_sequence_stats(snapshot, is_selection=True)
        self.assertIsNotNone(result)
        self.assertEqual(result["scope"], "selection")
        self.assertEqual(result["length"], 50)
        expected_seq = PUC19_SEQ[180:] + PUC19_SEQ[:30]
        expected_gc = server.gc_percent(expected_seq)
        self.assertAlmostEqual(result["gcPercent"], expected_gc, places=1)

    def test_no_selection_returns_none(self):
        snapshot = make_frontend_snapshot(selection=None)
        result = server.run_context_read_selected_region(snapshot)
        self.assertIsNone(result)

    def test_no_document_returns_none(self):
        snapshot: dict[str, Any] = {"currentSelection": SELECTION_NO_WRAP}
        result = server.run_context_read_selected_region(snapshot)
        self.assertIsNone(result)

    def test_one_based_display_range(self):
        snapshot = make_frontend_snapshot(selection={"start": 0, "end": 10, "wrapsOrigin": False})
        result = server.run_context_read_selected_region(snapshot)
        self.assertIsNotNone(result)
        self.assertEqual(result["displayRange"], "1..10")


class TestSequenceStatsFrontendShape(unittest.TestCase):
    """Test run_context_sequence_stats with frontend shape."""

    def test_gc_and_ambiguous_counts(self):
        snapshot = make_frontend_snapshot()
        result = server.run_context_sequence_stats(snapshot, is_selection=False)
        self.assertIsNotNone(result)
        self.assertEqual(result["tool"], "sequence_stats")
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["length"], len(PUC19_SEQ))
        self.assertEqual(result["scope"], "document")
        expected_gc = server.gc_percent(PUC19_SEQ)
        self.assertAlmostEqual(result["gcPercent"], expected_gc, places=1)
        expected_gc_count = PUC19_SEQ.count("G") + PUC19_SEQ.count("C")
        self.assertEqual(result["gcCount"], expected_gc_count)

    def test_ambiguous_base_count(self):
        seq_with_n = "ATGCNATGCNATGC"
        snapshot = make_frontend_snapshot(doc_seq=seq_with_n, feature_summary=[])
        result = server.run_context_sequence_stats(snapshot, is_selection=False)
        self.assertIsNotNone(result)
        self.assertEqual(result["ambiguousCount"], 2)
        self.assertEqual(result["length"], len(seq_with_n))

    def test_circular_topology_from_frontend(self):
        snapshot = make_frontend_snapshot(circular=True)
        result = server.run_context_sequence_stats(snapshot, is_selection=False)
        self.assertIsNotNone(result)
        self.assertEqual(result["topology"], "circular")

    def test_selection_stats_non_wrapping(self):
        snapshot = make_frontend_snapshot(selection=SELECTION_NO_WRAP)
        result = server.run_context_sequence_stats(snapshot, is_selection=True)
        self.assertIsNotNone(result)
        self.assertEqual(result["scope"], "selection")
        self.assertEqual(result["length"], 40)
        selected_seq = PUC19_SEQ[0:40]
        expected_gc = server.gc_percent(selected_seq)
        self.assertAlmostEqual(result["gcPercent"], expected_gc, places=1)

    def test_no_document_returns_none(self):
        result = server.run_context_sequence_stats({}, is_selection=False)
        self.assertIsNone(result)

    def test_no_selection_returns_none(self):
        snapshot = make_frontend_snapshot(selection=None)
        result = server.run_context_sequence_stats(snapshot, is_selection=True)
        self.assertIsNone(result)


class TestSelectionValidationAgainstDocument(unittest.TestCase):
    """Reject out-of-range, wrap-on-linear, and mismatched client metadata."""

    def test_out_of_range_start_rejected(self):
        """start >= seq_len must produce no selection result."""
        snapshot = make_frontend_snapshot(selection={"start": 200, "end": 200, "wrapsOrigin": False})
        result = server.run_context_read_selected_region(snapshot)
        self.assertIsNone(result)

    def test_out_of_range_end_rejected(self):
        """end > seq_len must produce no selection result."""
        snapshot = make_frontend_snapshot(selection={"start": 0, "end": 201, "wrapsOrigin": False})
        result = server.run_context_read_selected_region(snapshot)
        self.assertIsNone(result)

    def test_wrap_on_linear_document_rejected(self):
        """wrapsOrigin on a linear document must produce no selection result."""
        snapshot = make_frontend_snapshot(
            circular=False,
            selection={"start": 180, "end": 30, "wrapsOrigin": True},
        )
        result = server.run_context_read_selected_region(snapshot)
        self.assertIsNone(result)

    def test_mismatched_client_length_rejected(self):
        """Client length that disagrees with computed canonical length is rejected."""
        snapshot = make_frontend_snapshot(selection={"start": 0, "end": 40, "wrapsOrigin": False, "length": 999})
        result = server.run_context_read_selected_region(snapshot)
        self.assertIsNone(result)

    def test_mismatched_client_selected_sequence_rejected(self):
        """Client selectedSequence that disagrees with document is rejected."""
        snapshot = make_frontend_snapshot(selection={"start": 0, "end": 10, "wrapsOrigin": False, "selectedSequence": "XXXXXXXXXX"})
        result = server.run_context_read_selected_region(snapshot)
        self.assertIsNone(result)

    def test_no_context_output_for_out_of_range(self):
        """build_context_only_response produces no selection output for invalid range."""
        snapshot = make_frontend_snapshot(selection={"start": 0, "end": 999, "wrapsOrigin": False})
        payload: dict[str, Any] = {"message": "选区 GC 含量是多少？"}
        result = server.build_context_only_response(payload, snapshot)
        # Should either return None (no context) or have no selectionStats
        if result is not None:
            context_outputs = result["meta"].get("contextOutputs", {})
            self.assertNotIn("selectionStats", context_outputs)
            self.assertNotIn("selectedRegion", context_outputs)

    def test_no_context_output_for_wrap_on_linear(self):
        """build_context_only_response produces no selection output for wrap on linear."""
        snapshot = make_frontend_snapshot(
            circular=False,
            selection={"start": 180, "end": 30, "wrapsOrigin": True},
        )
        payload: dict[str, Any] = {"message": "选区 GC 含量是多少？"}
        result = server.build_context_only_response(payload, snapshot)
        if result is not None:
            context_outputs = result["meta"].get("contextOutputs", {})
            self.assertNotIn("selectionStats", context_outputs)
            self.assertNotIn("selectedRegion", context_outputs)

    def test_valid_client_length_accepted(self):
        """Client length matching computed canonical length is accepted."""
        snapshot = make_frontend_snapshot(selection={"start": 0, "end": 40, "wrapsOrigin": False, "length": 40})
        result = server.run_context_read_selected_region(snapshot)
        self.assertIsNotNone(result)
        self.assertEqual(result["length"], 40)

    def test_valid_client_selected_sequence_accepted(self):
        """Client selectedSequence matching document is accepted."""
        expected_seq = PUC19_SEQ[0:10]
        snapshot = make_frontend_snapshot(selection={"start": 0, "end": 10, "wrapsOrigin": False, "selectedSequence": expected_seq})
        result = server.run_context_read_selected_region(snapshot)
        self.assertIsNotNone(result)
        self.assertEqual(result["selectedSeq"], expected_seq)


class TestNumericValidation(unittest.TestCase):
    """Issue 5: reject booleans, floats, and fractional coordinates."""

    def test_reject_boolean_start(self):
        snapshot = make_frontend_snapshot(selection={"start": True, "end": 10, "wrapsOrigin": False})
        result = server.run_context_read_selected_region(snapshot)
        self.assertIsNone(result)

    def test_reject_boolean_end(self):
        snapshot = make_frontend_snapshot(selection={"start": 0, "end": False, "wrapsOrigin": False})
        result = server.run_context_read_selected_region(snapshot)
        self.assertIsNone(result)

    def test_reject_float_start(self):
        snapshot = make_frontend_snapshot(selection={"start": 1.5, "end": 10, "wrapsOrigin": False})
        result = server.run_context_read_selected_region(snapshot)
        self.assertIsNone(result)

    def test_reject_float_end(self):
        snapshot = make_frontend_snapshot(selection={"start": 0, "end": 9.7, "wrapsOrigin": False})
        result = server.run_context_read_selected_region(snapshot)
        self.assertIsNone(result)

    def test_accept_whole_number_float(self):
        """Float 10.0 should be accepted as int 10."""
        snapshot = make_frontend_snapshot(selection={"start": 0.0, "end": 10.0, "wrapsOrigin": False})
        result = server.run_context_read_selected_region(snapshot)
        self.assertIsNotNone(result)
        self.assertEqual(result["length"], 10)

    def test_reject_string_coordinates(self):
        snapshot = make_frontend_snapshot(selection={"start": "0", "end": "10", "wrapsOrigin": False})
        result = server.run_context_read_selected_region(snapshot)
        self.assertIsNone(result)

    def test_reject_negative_start(self):
        snapshot = make_frontend_snapshot(selection={"start": -1, "end": 10, "wrapsOrigin": False})
        result = server.run_context_read_selected_region(snapshot)
        self.assertIsNone(result)

    def test_strict_int_helper(self):
        self.assertEqual(server._context_strict_int(5), 5)
        self.assertEqual(server._context_strict_int(0), 0)
        self.assertIsNone(server._context_strict_int(True))
        self.assertIsNone(server._context_strict_int(False))
        self.assertIsNone(server._context_strict_int(1.5))
        self.assertEqual(server._context_strict_int(10.0), 10)
        self.assertIsNone(server._context_strict_int("5"))
        self.assertIsNone(server._context_strict_int(None))


class TestContextQuestionDetection(unittest.TestCase):
    """Test is_context_question and build_context_only_response."""

    def test_gc_question_returns_context_response(self):
        payload: dict[str, Any] = {"message": "当前序列 GC 是多少？"}
        snapshot = make_frontend_snapshot()
        result = server.build_context_only_response(payload, snapshot)
        self.assertIsNotNone(result)
        meta = result["meta"]
        self.assertEqual(meta["intent"], "context_read")
        self.assertEqual(meta["workspace"], "shared")
        self.assertFalse(meta["readyToExecute"])
        self.assertIsNone(meta["draft"])
        context_outputs = meta.get("contextOutputs", {})
        self.assertIn("sequenceStats", context_outputs)
        self.assertIn("openSequence", context_outputs)
        message = result["messages"][0]
        self.assertIn("GC", message)

    def test_context_question_no_design_draft(self):
        payload: dict[str, Any] = {"message": "当前序列长度是多少？"}
        snapshot = make_frontend_snapshot()
        result = server.build_context_only_response(payload, snapshot)
        self.assertIsNotNone(result)
        self.assertIsNone(result["meta"].get("draft"))

    def test_combined_length_and_gc_question_keeps_both_answers(self):
        payload: dict[str, Any] = {"message": "当前载体长度是多少？GC 含量是多少？"}
        snapshot = make_frontend_snapshot()
        result = server.build_context_only_response(payload, snapshot)
        self.assertIsNotNone(result)
        message = result["messages"][0]
        self.assertIn(f"长度 {len(PUC19_SEQ)} bp", message)
        self.assertIn("GC 含量", message)

    def test_design_request_not_a_context_question(self):
        payload: dict[str, Any] = {"message": "帮我设计克隆引物"}
        snapshot = make_frontend_snapshot()
        result = server.build_context_only_response(payload, snapshot)
        self.assertIsNone(result)

    def test_no_document_context_question(self):
        payload: dict[str, Any] = {"message": "当前序列 GC 是多少？"}
        result = server.build_context_only_response(payload, {})
        self.assertIsNone(result)

    def test_selection_gc_question(self):
        payload: dict[str, Any] = {"message": "选区 GC 含量是多少？"}
        snapshot = make_frontend_snapshot(selection=SELECTION_NO_WRAP)
        result = server.build_context_only_response(payload, snapshot)
        self.assertIsNotNone(result)
        context_outputs = result["meta"].get("contextOutputs", {})
        self.assertIn("selectionStats", context_outputs)

    def test_run_log_no_raw_bases(self):
        payload: dict[str, Any] = {"message": "当前序列 GC 是多少？"}
        snapshot = make_frontend_snapshot()
        result = server.build_context_only_response(payload, snapshot)
        self.assertIsNotNone(result)
        for entry in result["runLog"]:
            msg = str(entry.get("message") or "")
            self.assertNotIn(PUC19_SEQ, msg)


class TestSelectedBasesOnlyOnExplicitRequest(unittest.TestCase):
    """Issue 4: selected bases only appear on explicit short-selection request."""

    def test_no_bases_in_normal_gc_response(self):
        """Normal context question should not include selected bases."""
        payload: dict[str, Any] = {"message": "当前序列 GC 是多少？"}
        snapshot = make_frontend_snapshot(selection=SELECTION_NO_WRAP)
        result = server.build_context_only_response(payload, snapshot)
        self.assertIsNotNone(result)
        message = result["messages"][0]
        # Should NOT contain the selected sequence
        selected_seq = PUC19_SEQ[0:40]
        self.assertNotIn(selected_seq, message)

    def test_explicit_short_selection_request_includes_bases(self):
        """Explicit request for selected sequence should include bases when short."""
        payload: dict[str, Any] = {"message": "显示选区序列"}
        snapshot = make_frontend_snapshot(selection=SELECTION_NO_WRAP)
        result = server.build_context_only_response(payload, snapshot)
        self.assertIsNotNone(result)
        message = result["messages"][0]
        selected_seq = PUC19_SEQ[0:40]
        self.assertIn(selected_seq, message)

    def test_explicit_long_selection_omits_bases(self):
        """Explicit request for long selection should not include bases."""
        # Use a selection longer than 200bp
        long_seq = "ATGC" * 60  # 240 bp
        snapshot = make_frontend_snapshot(
            doc_seq=long_seq,
            selection={"start": 0, "end": 240, "wrapsOrigin": False},
            feature_summary=[],
        )
        payload: dict[str, Any] = {"message": "显示选区序列"}
        result = server.build_context_only_response(payload, snapshot)
        self.assertIsNotNone(result)
        message = result["messages"][0]
        # Should report length but not the full sequence
        self.assertNotIn(long_seq, message)

    def test_run_log_never_contains_selected_bases(self):
        """Run-log entries must never contain selected bases."""
        payload: dict[str, Any] = {"message": "显示选区序列"}
        snapshot = make_frontend_snapshot(selection=SELECTION_NO_WRAP)
        result = server.build_context_only_response(payload, snapshot)
        self.assertIsNotNone(result)
        selected_seq = PUC19_SEQ[0:40]
        for entry in result["runLog"]:
            msg = str(entry.get("message") or "")
            self.assertNotIn(selected_seq, msg)


class TestLLMSummaryNoRawSequence(unittest.TestCase):
    """Test summarize_agent_snapshot_for_llm contains metadata but no raw bases."""

    def test_summary_contains_metadata_from_frontend(self):
        snapshot = make_frontend_snapshot()
        summary = server.summarize_agent_snapshot_for_llm(snapshot)
        self.assertIn("open_document:", summary)
        self.assertIn(f"name={PUC19_NAME}", summary)
        self.assertIn("topology=circular", summary)
        self.assertIn("feature_count=3", summary)
        self.assertIn("accession=L09137", summary)
        self.assertIn("version=L09137.2", summary)

    def test_summary_no_raw_sequence(self):
        snapshot = make_frontend_snapshot()
        summary = server.summarize_agent_snapshot_for_llm(snapshot)
        self.assertNotIn(PUC19_SEQ, summary)

    def test_summary_contains_selection_metadata(self):
        snapshot = make_frontend_snapshot(selection=SELECTION_FRONTEND)
        summary = server.summarize_agent_snapshot_for_llm(snapshot)
        self.assertIn("current_selection:", summary)
        self.assertIn(f"start={SELECTION_FRONTEND['start']}", summary)
        self.assertIn(f"end={SELECTION_FRONTEND['end']}", summary)

    def test_summary_no_selection_when_absent(self):
        snapshot = make_frontend_snapshot(selection=None)
        summary = server.summarize_agent_snapshot_for_llm(snapshot)
        self.assertNotIn("current_selection:", summary)

    def test_summary_no_raw_bases_for_sequence_values(self):
        snapshot = make_frontend_snapshot()
        snapshot["formState"] = {"cloning": {"sequence": PUC19_SEQ}}
        summary = server.summarize_agent_snapshot_for_llm(snapshot)
        self.assertNotIn(PUC19_SEQ, summary)

    def test_summary_wrapped_selection_length(self):
        """Wrapped selection length should be correct in summary."""
        snapshot = make_frontend_snapshot(selection=SELECTION_WRAP)
        summary = server.summarize_agent_snapshot_for_llm(snapshot)
        self.assertIn("current_selection:", summary)
        self.assertIn("wraps_origin=True", summary)
        # Length should be (200 - 180) + 30 = 50
        self.assertIn("length=50", summary)


class TestCloningPlanningNotUsingVectorAsInsert(unittest.TestCase):
    """Normal cloning planning should not use the open vector as insert."""

    def test_cloning_still_needs_insert(self):
        payload: dict[str, Any] = {
            "message": "帮我做克隆",
            "workspace": "cloning",
            "snapshot": {
                "lastWorkbenchPage": "cloning",
                "formState": {"cloning": {}},
                "currentSequenceDocument": {
                    "name": PUC19_NAME,
                    "sequence": PUC19_SEQ,
                    "circular": True,
                    "featureSummary": PUC19_FEATURE_SUMMARY,
                },
            },
        }
        response = server.agent_chat_response(payload)
        self.assertIsInstance(response, dict)
        meta = response.get("meta") or {}
        self.assertFalse(meta.get("readyToExecute"))
        missing = meta.get("missingInputs") or []
        missing_text = " ".join(str(item) for item in missing).lower()
        self.assertTrue(
            "insert" in missing_text or "序列" in missing_text,
            f"Expected insert/序列 in missing, got: {missing_text[:200]}",
        )


class TestPlanningContextToolsPrepended(unittest.TestCase):
    """Context tool rows should be prepended to normal workflow plan/runLog."""

    def test_context_rows_prepended_to_cloning_plan(self):
        payload: dict[str, Any] = {
            "message": "帮我设计克隆引物",
            "workspace": "cloning",
            "snapshot": {
                "lastWorkbenchPage": "cloning",
                "formState": {
                    "cloning": {
                        "sequence": server.clean_sequence_letters(PUC19_SEQ),
                        "label": "test_insert",
                        "method": "gibson",
                        "leftHomology": "ATGCGTACCGTTAACCGGTT",
                        "rightHomology": "GGCCTTAACCGGTACGCATG",
                        "homologyLength": 20,
                    },
                },
                "currentSequenceDocument": {
                    "name": PUC19_NAME,
                    "sequence": PUC19_SEQ,
                    "circular": True,
                    "featureSummary": PUC19_FEATURE_SUMMARY,
                },
            },
        }
        response = server.agent_chat_response(payload)
        self.assertIsInstance(response, dict)
        plan = response.get("plan") or []
        run_log = response.get("runLog") or []
        plan_tools = [str(item.get("tool") or "") for item in plan if isinstance(item, dict)]
        self.assertIn("read_open_sequence", plan_tools)
        self.assertIn("list_features", plan_tools)
        self.assertIn("sequence_stats", plan_tools)
        run_log_tools = [str(item.get("tool") or "") for item in run_log if isinstance(item, dict)]
        self.assertIn("read_open_sequence", run_log_tools)
        self.assertIn("parse_sequence", plan_tools)
        self.assertIn("design_cloning", plan_tools)

    def test_context_outputs_in_meta(self):
        payload: dict[str, Any] = {
            "message": "帮我做克隆",
            "workspace": "cloning",
            "snapshot": {
                "lastWorkbenchPage": "cloning",
                "formState": {"cloning": {}},
                "currentSequenceDocument": {
                    "name": PUC19_NAME,
                    "sequence": PUC19_SEQ,
                    "circular": True,
                    "featureSummary": PUC19_FEATURE_SUMMARY,
                },
            },
        }
        response = server.agent_chat_response(payload)
        self.assertIsInstance(response, dict)
        meta = response.get("meta") or {}
        context_outputs = meta.get("contextOutputs")
        self.assertIsInstance(context_outputs, dict)
        self.assertIn("openSequence", context_outputs)
        self.assertIn("features", context_outputs)
        self.assertIn("sequenceStats", context_outputs)

    def test_context_rows_with_selection(self):
        payload: dict[str, Any] = {
            "message": "帮我做克隆",
            "workspace": "cloning",
            "snapshot": {
                "lastWorkbenchPage": "cloning",
                "formState": {"cloning": {}},
                "currentSequenceDocument": {
                    "name": PUC19_NAME,
                    "sequence": PUC19_SEQ,
                    "circular": True,
                    "featureSummary": PUC19_FEATURE_SUMMARY,
                },
                "currentSelection": SELECTION_NO_WRAP,
            },
        }
        response = server.agent_chat_response(payload)
        self.assertIsInstance(response, dict)
        plan = response.get("plan") or []
        plan_tools = [str(item.get("tool") or "") for item in plan if isinstance(item, dict)]
        self.assertIn("read_selected_region", plan_tools)

    def test_no_context_when_no_document(self):
        payload: dict[str, Any] = {
            "message": "帮我做克隆",
            "workspace": "cloning",
            "snapshot": {
                "lastWorkbenchPage": "cloning",
                "formState": {"cloning": {}},
            },
        }
        response = server.agent_chat_response(payload)
        self.assertIsInstance(response, dict)
        meta = response.get("meta") or {}
        self.assertNotIn("contextOutputs", meta)


class TestAgentChatContextQuestionIntegration(unittest.TestCase):
    """Test agent_chat_response with direct context questions."""

    def test_gc_question_returns_context_only(self):
        payload: dict[str, Any] = {
            "message": "当前序列 GC 是多少",
            "snapshot": {
                "currentSequenceDocument": {
                    "name": PUC19_NAME,
                    "sequence": PUC19_SEQ,
                    "circular": True,
                    "featureSummary": PUC19_FEATURE_SUMMARY,
                },
            },
        }
        response = server.agent_chat_response(payload)
        self.assertIsInstance(response, dict)
        meta = response.get("meta") or {}
        self.assertEqual(meta.get("intent"), "context_read")
        self.assertEqual(meta.get("workspace"), "shared")
        self.assertFalse(meta.get("readyToExecute"))
        messages = response.get("messages") or []
        self.assertTrue(len(messages) > 0)
        self.assertIn("GC", messages[0])

    def test_gc_question_no_design_draft(self):
        payload: dict[str, Any] = {
            "message": "当前序列 GC 是多少",
            "snapshot": {
                "currentSequenceDocument": {
                    "name": PUC19_NAME,
                    "sequence": PUC19_SEQ,
                    "circular": True,
                    "featureSummary": PUC19_FEATURE_SUMMARY,
                },
            },
        }
        response = server.agent_chat_response(payload)
        meta = response.get("meta") or {}
        self.assertIsNone(meta.get("draft"))


class TestWorkspaceStateFallsBackToOpenDocument(unittest.TestCase):
    """P1-7: deduplicated snapshots must still yield the open sequence.

    The desktop client now sends the open sequence only in the
    workspace-matching formState slot; every workspace state reader falls back
    to currentSequenceDocument.sequence so cross-workspace routing (e.g. a
    message routed to sgrna while the snapshot was built for cloning) still
    works exactly as before the dedup.
    """

    def test_sgrna_state_falls_back_to_open_document(self):
        snapshot = make_frontend_snapshot()
        snapshot["lastWorkbenchPage"] = "cloning"
        snapshot["formState"] = {"cloning": {"vectorSequence": PUC19_SEQ}}
        payload = {"snapshot": snapshot, "message": "设计几个 sgRNA"}
        state = server.sgrna_state_from_snapshot(payload)
        self.assertEqual(state["sequence"], PUC19_SEQ)

    def test_sirna_state_falls_back_to_open_document(self):
        snapshot = make_frontend_snapshot()
        snapshot["formState"] = {"custom": {"sequence": PUC19_SEQ}}
        payload = {"snapshot": snapshot, "message": "设计 siRNA"}
        state = server.sirna_state_from_snapshot(payload)
        self.assertEqual(state["sequence"], PUC19_SEQ)

    def test_mutagenesis_state_falls_back_to_open_document(self):
        snapshot = make_frontend_snapshot()
        snapshot["formState"] = {}
        payload = {"snapshot": snapshot, "message": "设计点突变引物"}
        state = server.mutagenesis_state_from_snapshot(payload)
        self.assertEqual(state["sequence"], PUC19_SEQ)

    def test_rtqpcr_state_falls_back_to_open_document(self):
        snapshot = make_frontend_snapshot()
        snapshot["formState"] = {}
        payload = {"snapshot": snapshot, "message": "设计 RT-qPCR 引物"}
        state = server.rt_state_from_snapshot(payload)
        self.assertEqual(state["query"], PUC19_SEQ)

    def test_cloning_state_vector_falls_back_to_open_document(self):
        snapshot = make_frontend_snapshot()
        snapshot["formState"] = {}
        payload = {"snapshot": snapshot, "message": "克隆到当前载体"}
        state = server.cloning_state_from_snapshot(payload)
        self.assertEqual(state["vectorSequence"], PUC19_SEQ)

    def test_snapshot_slot_still_takes_precedence_when_present(self):
        custom_seq = "A" * 120
        snapshot = make_frontend_snapshot()
        snapshot["formState"] = {"sg": {"sequence": custom_seq}}
        payload = {"snapshot": snapshot, "message": "设计 sgRNA"}
        state = server.sgrna_state_from_snapshot(payload)
        self.assertEqual(state["sequence"], custom_seq)

    def test_explicit_gene_query_keeps_priority_over_open_document(self):
        # Legacy web-app payloads can carry a gene query with an empty sequence
        # slot while an unrelated sequence is open. The fallback must not
        # silently replace the query-driven design with the open document.
        snapshot = make_frontend_snapshot()
        snapshot["formState"] = {"sg": {"query": "GAPDH", "sequence": ""}}
        payload = {"snapshot": snapshot, "message": "设计 sgRNA"}
        state = server.sgrna_state_from_snapshot(payload)
        self.assertEqual(state["query"], "GAPDH")
        self.assertEqual(state["sequence"], "")

    def test_explicit_sirna_query_keeps_priority_over_open_document(self):
        snapshot = make_frontend_snapshot()
        snapshot["formState"] = {"sirna": {"query": "NM_001101", "sequence": ""}}
        payload = {"snapshot": snapshot, "message": "设计 siRNA"}
        state = server.sirna_state_from_snapshot(payload)
        self.assertEqual(state["query"], "NM_001101")
        self.assertEqual(state["sequence"], "")


if __name__ == "__main__":
    unittest.main()
