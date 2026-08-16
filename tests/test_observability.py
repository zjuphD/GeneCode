#!/usr/bin/env python3
"""A-OBS-001 regression tests: per-request correlation ids (X-Request-ID
response header) and SSE runId/stepId stamping on stream frames."""

from __future__ import annotations

import http.client
import json
import os
import sys
import threading
import unittest
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ["AGENT_LLM_ENABLED"] = "0"
import server  # noqa: E402


class TestRequestIdHeader(unittest.TestCase):
    """Every response carries an X-Request-ID that correlates with logs."""

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

    def get_headers(self, path: str) -> dict[str, str]:
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request("GET", path)
        resp = conn.getresponse()
        resp.read()
        headers = {k.lower(): v for k, v in resp.getheaders()}
        conn.close()
        return headers

    def test_health_response_has_request_id(self) -> None:
        headers = self.get_headers("/api/health")
        self.assertIn("x-request-id", headers)
        self.assertTrue(headers["x-request-id"])

    def test_request_ids_differ_across_requests(self) -> None:
        first = self.get_headers("/api/health")["x-request-id"]
        second = self.get_headers("/api/health")["x-request-id"]
        self.assertNotEqual(first, second)

    def test_static_response_has_request_id(self) -> None:
        headers = self.get_headers("/")
        self.assertEqual(headers.get("x-request-id", ""), headers.get("x-request-id", "") or "")
        self.assertIn("x-request-id", headers)


class TestSseMetadata(unittest.TestCase):
    """_inject_sse_metadata stamps runId + monotonic stepId on every frame."""

    def test_injects_run_id_and_incrementing_step_ids(self) -> None:
        frames = [
            server._sse_encode("step_start", {"step": "parse", "tool": "parse_sequence"}),
            server._sse_encode("step_done", {"step": "parse", "tool": "parse_sequence"}),
            server._sse_encode("complete", {"ok": True, "runLog": []}),
        ]
        out = list(server._inject_sse_metadata(frames, "run-abc-123"))

        datas: list[dict] = []
        event_types: list[str] = []
        for frame in out:
            text = frame.decode("utf-8")
            for line in text.split("\n"):
                if line.startswith("event:"):
                    event_types.append(line[len("event:"):].strip())
            data_line = next(
                (line for line in text.split("\n") if line.startswith("data:")),
                None,
            )
            assert data_line is not None
            datas.append(json.loads(data_line[len("data:"):].strip()))

        self.assertEqual(event_types, ["step_start", "step_done", "complete"])
        self.assertEqual([d.get("runId") for d in datas], ["run-abc-123"] * 3)
        self.assertEqual([d.get("stepId") for d in datas], [1, 2, 3])

    def test_preserves_existing_payload_fields(self) -> None:
        frames = [server._sse_encode("step_start", {"step": "scan", "tool": "scan_restriction_sites"})]
        out = list(server._inject_sse_metadata(frames, "run-1"))
        text = out[0].decode("utf-8")
        data_line = next(line for line in text.split("\n") if line.startswith("data:"))
        data = json.loads(data_line[len("data:"):].strip())
        self.assertEqual(data["step"], "scan")
        self.assertEqual(data["tool"], "scan_restriction_sites")
        self.assertEqual(data["runId"], "run-1")
        self.assertEqual(data["stepId"], 1)

    def test_empty_run_id_skips_field_but_keeps_step_id(self) -> None:
        frames = [server._sse_encode("step_start", {"step": "parse"})]
        out = list(server._inject_sse_metadata(frames, ""))
        text = out[0].decode("utf-8")
        data_line = next(line for line in text.split("\n") if line.startswith("data:"))
        data = json.loads(data_line[len("data:"):].strip())
        self.assertNotIn("runId", data)
        self.assertEqual(data["stepId"], 1)


if __name__ == "__main__":
    unittest.main()
