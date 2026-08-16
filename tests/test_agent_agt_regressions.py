#!/usr/bin/env python3
"""A-AGT-001/002/003 regression tests.

- A-AGT-001: user-named restriction enzymes must be scanned faithfully and
  positions must be reported; the LLM plan path must forward ``enzymes``.
- A-AGT-002: degraded/skipped verification must never claim the design is
  valid — the response separates execution / validation / claim axes.
- A-AGT-003: Stop must reach the server (cancel endpoint + flag mechanics +
  cancellable LLM subprocess + SSE generator stopping at the next boundary).
"""

from __future__ import annotations

import http.client
import json
import sys
import threading
import unittest
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import server  # noqa: E402


def rt_payload(**overrides) -> dict:
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


PUC19_SEQ = (
    "GAATTCGGATCCCTCGAGGTACCAAGCTTGGATCCGAATTCGTCGACTCTAGA"  # contains EcoRI ×2, BamHI ×2, HindIII, XhoI
    "GATCTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT"
)


class TestEnzymeExtraction(unittest.TestCase):
    """A-AGT-001: deterministic extraction of user-named enzymes."""

    def test_names_extracted_in_order(self) -> None:
        names = server.extract_requested_restriction_enzymes("请扫描 EcoRI 和 HindIII 的酶切位点")
        self.assertEqual(names, ["EcoRI", "HindIII"])

    def test_digit_alias(self) -> None:
        self.assertEqual(server.extract_requested_restriction_enzymes("看看 EcoR1 有没有位点"), ["EcoRI"])

    def test_upper_lower_mixed(self) -> None:
        self.assertEqual(server.extract_requested_restriction_enzymes("用 ecoRI 和 bamH1 扫描"), ["EcoRI", "BamHI"])

    def test_no_false_positives_inside_words(self) -> None:
        # "EcoRI" must not match inside an unrelated word boundary.
        self.assertEqual(server.extract_requested_restriction_enzymes("对比 ECOLI 的参考序列"), [])

    def test_unknown_names_ignored(self) -> None:
        self.assertEqual(server.extract_requested_restriction_enzymes("用 FakeZyme 和 EcoRI 扫"), ["EcoRI"])

    def test_empty_message(self) -> None:
        self.assertEqual(server.extract_requested_restriction_enzymes("   "), [])


class TestRestrictionScanContextFaithful(unittest.TestCase):
    """A-AGT-001: named-enzyme scans only those enzymes and return positions."""

    def _snapshot(self) -> dict:
        return {
            "currentSequenceDocument": {
                "sequence": PUC19_SEQ,
                "name": "pUC19",
                "circular": False,
                "featureSummary": [],
            },
            "currentRestrictionAnalysis": {},
        }

    def test_requested_enzymes_only_with_positions(self) -> None:
        response = server.build_restriction_scan_context_response(
            {"message": "用 EcoRI 和 HindIII 扫描酶切位点"},
            self._snapshot(),
        )
        self.assertIsNotNone(response)
        analysis = response["meta"]["restrictionAnalysis"]
        # Canonical schema retained (chosenEnzymes), enriched with the request.
        self.assertEqual(sorted(analysis["requestedEnzymes"]), ["EcoRI", "HindIII"])
        self.assertEqual(analysis["unrecognized"], [])
        chosen = {item["name"]: item for item in analysis["chosenEnzymes"]}
        self.assertEqual(sorted(chosen), ["EcoRI", "HindIII"])
        self.assertGreaterEqual(chosen["EcoRI"]["insert"]["hit_count"], 1)
        self.assertGreaterEqual(len(chosen["EcoRI"]["insert"]["positions"]), 1)
        # canonical analysis keeps the standard keys the frontend map needs
        self.assertIn("summary", analysis)
        self.assertIn("insertLength", analysis)
        self.assertEqual(response["meta"]["claimLevel"], "validated")
        # message mentions the positions and both enzymes
        self.assertIn("位置", response["messages"][0])
        self.assertIn("EcoRI", response["messages"][0])
        self.assertIn("HindIII", response["messages"][0])

    def test_scope_label_names_the_request(self) -> None:
        response = server.build_restriction_scan_context_response(
            {"message": "EcoRI 酶切位点在哪"},
            self._snapshot(),
        )
        self.assertEqual(response["meta"]["restrictionScope"], "用户指定酶（1 种）")

    def test_library_fallback_when_no_names(self) -> None:
        response = server.build_restriction_scan_context_response(
            {"message": "有哪些常见酶的酶切位点"},
            self._snapshot(),
        )
        self.assertIsNotNone(response)
        # 34 种 = 32 baseline + BbsI/AarI (A-ALG-002 single source of truth).
        self.assertEqual(response["meta"]["restrictionScope"], "内置常见酶库（34 种）")

    def test_scan_response_with_named_enzymes_reports_counts(self) -> None:
        response = server.scan_restriction_sites_response(
            {"sequence": PUC19_SEQ, "enzymes": ["EcoRI"]},
        )
        joined = " ".join(response["messages"])
        self.assertIn("EcoRI", joined)
        self.assertIn("2 个", joined)  # GAATTC appears twice
        analysis = response["meta"]["restrictionAnalysis"]
        chosen = {item["name"]: item for item in analysis.get("chosenEnzymes") or []}
        self.assertIn("EcoRI", chosen)
        self.assertEqual(chosen["EcoRI"]["insert"]["hit_count"], 2)


class TestExecuteLlmPlanForwardsEnzymes(unittest.TestCase):
    """A-AGT-001: the LLM-plan executor must forward/inject enzymes."""

    def _cloning_payload(self, message: str) -> dict:
        return rt_payload(
            message=message,
            workspace="cloning",
            draft={
                "workspace": "cloning",
                "designType": "cloning",
                "confirmations": {"cloning-restriction-pair": True},
                "designPayload": {"method": "gibson", "sequence": PUC19_SEQ, "label": "Cloning"},
            },
        )

    def test_scan_step_gets_requested_enzymes_injected(self) -> None:
        plan = {
            "goal": "扫描酶切位点",
            "workspace": "cloning",
            "steps": [
                {
                    "tool": "scan_restriction_sites",
                    "args": {"sequence": PUC19_SEQ},
                    "dependsOn": [],
                    "rationale": "扫描用户指定的酶",
                },
            ],
        }
        with patch.object(server, "scan_restriction_sites_response") as mock_scan:
            mock_scan.return_value = {
                "meta": {"restrictionAnalysis": {"chosenEnzymes": [{"name": "EcoRI", "insert": {"hit_count": 2, "positions": [0, 6]}}]}},
                "messages": ["ok"],
                "results": [],
            }
            events = list(server.execute_llm_plan(
                self._cloning_payload("扫描 EcoRI 的酶切位点"),
                "cloning",
                plan,
            ))
        call_payload = mock_scan.call_args.args[0]
        # Deterministic extraction must reach the tool args even though the
        # planner's step omitted ``enzymes``.
        self.assertEqual(call_payload.get("enzymes"), ["EcoRI"])
        complete = events[-1]["data"]
        self.assertEqual(complete["meta"]["plannedBy"], "llm")

    def test_scan_step_surfaces_reconciliation_warning(self) -> None:
        plan = {
            "goal": "扫描酶切位点",
            "workspace": "cloning",
            "steps": [
                {
                    "tool": "scan_restriction_sites",
                    "args": {"sequence": PUC19_SEQ},
                    "dependsOn": [],
                    "rationale": "扫描",
                },
            ],
        }
        # The handler forgets to include the requested enzyme — the executor
        # must attach a reconciliation warning instead of a clean pass.
        with patch.object(server, "scan_restriction_sites_response") as mock_scan:
            mock_scan.return_value = {
                "meta": {"restrictionAnalysis": {"chosenEnzymes": []}},
                "messages": ["ok"],
                "results": [],
            }
            events = list(server.execute_llm_plan(
                self._cloning_payload("扫描 EcoRI 的酶切位点"),
                "cloning",
                plan,
            ))
        complete = events[-1]["data"]
        run_row = complete["runLog"][0]
        self.assertEqual(run_row.get("reconciliation"), "warning")
        self.assertIn("EcoRI", run_row["message"])


class TestClaimStates(unittest.TestCase):
    """A-AGT-002: execution / validation / claim separation."""

    def test_fast_mode_never_claims_validated(self) -> None:
        with patch.object(server, "agent_llm_config", return_value={"available": False}), \
             patch.object(server, "design_rt_response") as mock_design:
            mock_design.return_value = {"meta": {}, "messages": [], "results": [{"size": 120}]}
            final = server.design_agent_execute_response(
                rt_payload(runMode="fast"), "rtqpcr",
            )
        self.assertEqual(final["meta"]["verificationStatus"], "skipped")
        self.assertEqual(final["meta"]["claimLevel"], "unvalidated")
        self.assertEqual(final["meta"]["executionStatus"], "completed")
        self.assertFalse(any("仍然有效" in str(msg) for msg in final["messages"]))

    def test_degraded_verification_does_not_claim_valid(self) -> None:
        def _boom(*_args, **_kwargs):
            raise RuntimeError("verifier crashed")

        with patch.object(server, "agent_llm_config", return_value={"available": False}), \
             patch.object(server, "design_rt_response") as mock_design, \
             patch.object(server, "_agent_auto_verify", side_effect=_boom):
            mock_design.return_value = {"meta": {}, "messages": [], "results": [{"size": 120}]}
            final = server.design_agent_execute_response(rt_payload(), "rtqpcr")
        self.assertEqual(final["meta"]["verificationStatus"], "degraded")
        self.assertEqual(final["meta"]["claimLevel"], "unvalidated")
        self.assertEqual(final["meta"]["executionStatus"], "completed")
        all_text = json.dumps(final, ensure_ascii=False)
        self.assertNotIn("仍然有效", all_text)
        self.assertIn("未经验证", all_text)

    def test_check_track_degraded_message_reworded(self) -> None:
        def _boom(*_args, **_kwargs):
            raise server.ApiError("NCBI down")

        # check_agent_execute_stream reads the handler from the module-level
        # registry dict, so patch the dict entry in place.
        with patch.dict(server.CHECK_HANDLER_BY_TOOL, {"check_rt_specificity": _boom}):
            final = server.check_agent_execute_response(
                rt_payload(checkResults=[{"f": "AACCGG", "r": "GGTTCC"}]), "rtqpcr",
            )
        self.assertEqual(final["meta"]["verificationStatus"], "degraded")
        self.assertEqual(final["meta"]["claimLevel"], "unvalidated")
        all_text = json.dumps(final, ensure_ascii=False)
        self.assertNotIn("仍然有效", all_text)
        self.assertIn("未经验证", all_text)


class TestServerSideCancellation(unittest.TestCase):
    """A-AGT-003: cancellation flag mechanics + cancellable LLM call."""

    def setUp(self) -> None:
        self.run_id = "agt-test-run-001"

    def tearDown(self) -> None:
        server._clear_cancelled_flag(self.run_id)

    def test_cancel_flag_lifecycle(self) -> None:
        server._register_active_run(self.run_id)
        self.assertFalse(server._is_run_cancelled(self.run_id))
        server._cancel_run(self.run_id)
        self.assertTrue(server._is_run_cancelled(self.run_id))
        server._clear_cancelled_flag(self.run_id)
        self.assertFalse(server._is_run_cancelled(self.run_id))

    def test_cancel_updates_run_record(self) -> None:
        record = server._create_run_record(self.run_id, "plan", "rtqpcr")
        server._cancel_run(self.run_id)
        self.assertEqual(record["status"], "cancelled")

    def test_llm_completion_aborts_when_run_precancelled(self) -> None:
        config = {
            "available": True,
            "endpoint": "https://example.invalid/v1/chat/completions",
            "apiKey": "sk-test",
            "model": "deepseek-v4-flash",
            "provider": "test",
        }
        server._cancel_run(self.run_id)
        with patch("subprocess.Popen") as mock_popen:
            with self.assertRaises(server.ApiError) as ctx:
                server.agent_llm_completion(
                    config,
                    [{"role": "user", "content": "hi"}],
                    run_id=self.run_id,
                )
            # No subprocess should ever be forked for an already-cancelled run.
            mock_popen.assert_not_called()
        self.assertIn("取消", str(ctx.exception))

    @staticmethod
    def _parse_sse_frame(frame: bytes) -> tuple[str, dict]:
        event_type = ""
        data: dict = {}
        for line in frame.decode("utf-8").splitlines():
            if line.startswith("event: "):
                event_type = line[len("event: "):]
            elif line.startswith("data: "):
                data = json.loads(line[len("data: "):])
        return event_type, data

    def test_sse_generator_stops_on_cancel_between_events(self) -> None:
        payload = rt_payload(
            runId=self.run_id,
            requestId="",
            snapshot={
                "documentHash": "abc",
                "currentSequenceDocument": {
                    "sequence": PUC19_SEQ,
                    "circular": False,
                    "featureSummary": [],
                },
            },
        )

        def fake_stream(_payload, _workspace):
            yield {"event": "step_start", "data": {"tool": "design_rtqpcr", "label": "设计", "summary": "s1"}}
            yield {"event": "step_done", "data": {"tool": "design_rtqpcr", "label": "设计", "summary": "s2", "status": "completed"}}
            yield {"event": "complete", "data": {"meta": {}, "messages": [], "results": [], "plan": [], "runLog": []}}

        with patch.object(server, "design_agent_execute_stream", side_effect=fake_stream):
            gen = server.agent_execute_sse_generator(payload)
            frames = []
            for frame in gen:
                frames.append(frame)
                if not server._is_run_cancelled(self.run_id):
                    # Cancel after the first intermediate event is emitted —
                    # the generator must stop at the next boundary instead of
                    # consuming the remaining events.
                    server._cancel_run(self.run_id)
        events = [self._parse_sse_frame(f) for f in frames]
        last = events[-1]
        # The run must terminate with a cancellation frame, never a normal
        # completion, and nothing may follow it.
        self.assertEqual(last[0], "complete")
        self.assertEqual(last[1]["meta"]["runStatus"], "cancelled")
        self.assertEqual(last[1]["meta"]["claimLevel"], "unvalidated")
        for event_type, _ in events[:-1]:
            self.assertNotEqual(event_type, "complete")


class CancelHttpEndpointTest(unittest.TestCase):
    """A-AGT-003: POST /api/agent/cancel over real HTTP."""

    @classmethod
    def setUpClass(cls) -> None:
        handler = partial(server.AppHandler, directory=str(server.BASE_DIR))
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def post_json(self, path: str, body: dict) -> tuple[int, dict]:
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        trusted_origin = next(iter(server.TRUSTED_WEB_ORIGINS)) if server.TRUSTED_WEB_ORIGINS else "http://localhost:1420"
        conn.request(
            "POST",
            path,
            body=json.dumps(body),
            headers={
                "Content-Type": "application/json",
                "Origin": trusted_origin,
            },
        )
        resp = conn.getresponse()
        raw = resp.read()
        data = json.loads(raw.decode("utf-8") or "{}") if resp.status == 200 else {}
        conn.close()
        return resp.status, data

    def test_cancel_endpoint_accepts_run_id(self) -> None:
        status, data = self.post_json("/api/agent/cancel", {"runId": "http-cancel-run-1"})
        self.assertEqual(status, 200)
        self.assertTrue(data["ok"])
        self.assertEqual(data["status"], "cancelled")

    def test_cancel_requires_run_id(self) -> None:
        status, _ = self.post_json("/api/agent/cancel", {})
        self.assertEqual(status, 400)

    def test_cancel_is_idempotent(self) -> None:
        status1, _ = self.post_json("/api/agent/cancel", {"runId": "http-cancel-run-2"})
        status2, _ = self.post_json("/api/agent/cancel", {"runId": "http-cancel-run-2"})
        self.assertEqual(status1, 200)
        self.assertEqual(status2, 200)


if __name__ == "__main__":
    unittest.main()
