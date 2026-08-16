#!/usr/bin/env python3
"""A-SEC-001 regression tests: the local API must never serve secrets,
must not allow cross-origin reads/writes from arbitrary web pages, and must
reject DNS-rebinding Host headers."""

from __future__ import annotations

import http.client
import json
import os
import sys
import tempfile
import threading
import unittest
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ["AGENT_LLM_ENABLED"] = "0"
import server  # noqa: E402


class LocalApiSecurityTestBase(unittest.TestCase):
    """Boot a real AppHandler on an ephemeral loopback port."""

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

    def request(
        self,
        method: str,
        path: str,
        *,
        origin: str | None = None,
        host: str | None = None,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, dict[str, str], bytes]:
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        headers = dict(headers or {})
        if origin is not None:
            headers["Origin"] = origin
        if host is not None:
            headers["Host"] = host
        if body is not None:
            headers["Content-Type"] = "application/json"
        conn.request(method, path, body=body, headers=headers)
        resp = conn.getresponse()
        raw = resp.read()
        response_headers = {k.lower(): v for k, v in resp.getheaders()}
        conn.close()
        return resp.status, response_headers, raw


class TestStaticFileDenial(LocalApiSecurityTestBase):
    def test_env_local_is_forbidden(self) -> None:
        status, _, _ = self.request("GET", "/.env.local")
        self.assertEqual(status, 403)

    def test_server_source_is_forbidden(self) -> None:
        status, _, _ = self.request("GET", "/server.py")
        self.assertEqual(status, 403)

    def test_any_python_source_is_forbidden(self) -> None:
        status, _, _ = self.request("GET", "/some_internal_module.py")
        self.assertEqual(status, 403)

    def test_tests_directory_is_forbidden(self) -> None:
        status, _, _ = self.request("GET", "/tests/README.md")
        self.assertEqual(status, 403)

    def test_dotfile_prefixes_are_forbidden(self) -> None:
        for path in ("/.freebuff/run.md", "/.wrangler/cache/account.json", "/.git/config"):
            status, _, _ = self.request("GET", path)
            self.assertEqual(status, 403, path)

    def test_sqlite_databases_are_forbidden(self) -> None:
        status, _, _ = self.request("GET", "/.freebuff/desktop-v2.db")
        self.assertEqual(status, 403)

    def test_legacy_static_page_still_served(self) -> None:
        status, _, _ = self.request("GET", "/")
        self.assertEqual(status, 200)

    def test_api_paths_without_health_return_404(self) -> None:
        status, _, _ = self.request("GET", "/api/agent/model")
        self.assertEqual(status, 404)


class TestHeadBypass(LocalApiSecurityTestBase):
    """HEAD must enforce the same guards as GET (A-SEC-001 regression)."""

    def test_head_env_local_is_forbidden(self) -> None:
        status, _, _ = self.request("HEAD", "/.env.local")
        self.assertEqual(status, 403)

    def test_head_server_source_is_forbidden(self) -> None:
        status, _, _ = self.request("HEAD", "/server.py")
        self.assertEqual(status, 403)

    def test_head_rebinding_host_is_rejected(self) -> None:
        status, _, _ = self.request("HEAD", "/api/health", host="evil.example")
        self.assertEqual(status, 403)

    def test_head_health_ok(self) -> None:
        status, _, _ = self.request("HEAD", "/api/health")
        self.assertEqual(status, 200)


class TestCorsBoundary(LocalApiSecurityTestBase):
    def test_evil_origin_gets_no_cors_header(self) -> None:
        status, headers, _ = self.request("GET", "/api/health", origin="https://evil.example")
        self.assertEqual(status, 200)
        self.assertNotIn("access-control-allow-origin", headers)

    def test_trusted_dev_origin_gets_cors_header(self) -> None:
        status, headers, _ = self.request("GET", "/api/health", origin="http://localhost:1420")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("access-control-allow-origin"), "http://localhost:1420")

    def test_preflight_from_evil_origin_is_blocked(self) -> None:
        _, headers, _ = self.request("OPTIONS", "/api/agent/model", origin="https://evil.example")
        self.assertNotIn("access-control-allow-origin", headers)

    def test_encoded_traversal_is_forbidden(self) -> None:
        for path in ("/%2e%2e/.env.local", "/%2e%2e%2fserver.py", "/..%2f.env.local"):
            status, _, _ = self.request("GET", path)
            self.assertEqual(status, 403, path)

    def test_preflight_from_tauri_origin_is_allowed(self) -> None:
        _, headers, _ = self.request("OPTIONS", "/api/agent/model", origin="tauri://localhost")
        self.assertEqual(headers.get("access-control-allow-origin"), "tauri://localhost")

    def test_static_read_from_evil_origin_is_unreadable(self) -> None:
        # Even a non-blocked static path must not come back with CORS headers,
        # so a malicious page cannot read the response body.
        status, headers, body = self.request("GET", "/", origin="https://evil.example")
        self.assertEqual(status, 200)
        self.assertNotIn("access-control-allow-origin", headers)
        self.assertTrue(body)

    def test_model_write_from_evil_origin_is_rejected(self) -> None:
        payload = json.dumps({"provider": "test", "model": "evil", "endpoint": "https://evil.example/v1"}).encode()
        with patch.object(server, "persist_local_env_overrides") as persist:
            status, _, _ = self.request(
                "POST", "/api/agent/model", origin="https://evil.example", body=payload
            )
        self.assertEqual(status, 403)
        persist.assert_not_called()

    def test_any_post_from_evil_origin_is_rejected(self) -> None:
        # Even a text/plain JSON "simple request" from an evil page must not
        # drive any API route (LLM/agent cost abuse vector).
        payload = json.dumps({"sequence": "ACGT"}).encode()
        for path in (
            "/api/agent/chat",
            "/api/agent/execute",
            "/api/scan/restriction-sites",
            "/api/parse/sequence",
        ):
            with self.subTest(path=path):
                status, _, _ = self.request("POST", path, origin="https://evil.example", body=payload)
                self.assertEqual(status, 403, path)

    def test_same_origin_post_from_server_origin_is_allowed(self) -> None:
        # The legacy static app served from this very origin keeps working.
        payload = json.dumps({"sequence": "ATGCATGC", "format": "fasta"}).encode()
        origin = f"http://127.0.0.1:{self.port}"
        status, _, body = self.request("POST", "/api/parse/sequence", origin=origin, body=payload)
        self.assertEqual(status, 200, body.decode("utf-8", "replace"))

    def test_model_write_from_local_client_is_allowed(self) -> None:
        payload = json.dumps({"provider": "test", "model": "x", "endpoint": "http://127.0.0.1:9/v1"}).encode()
        with tempfile.TemporaryDirectory() as tmp, patch.object(server, "DATA_DIR", Path(tmp)):
            status, _, body = self.request("POST", "/api/agent/model", body=payload)
        self.assertEqual(status, 200, body.decode("utf-8", "replace"))


class TestHostValidation(LocalApiSecurityTestBase):
    def test_rebinding_host_is_rejected(self) -> None:
        status, _, _ = self.request("GET", "/api/health", host="evil.example")
        self.assertEqual(status, 403)

    def test_rebinding_host_rejected_for_posts(self) -> None:
        payload = json.dumps({"ok": True}).encode()
        status, _, _ = self.request("POST", "/api/parse/sequence", host="rebind.test", body=payload)
        self.assertEqual(status, 403)

    def test_loopback_host_is_accepted(self) -> None:
        status, _, _ = self.request("GET", "/api/health", host="127.0.0.1")
        self.assertEqual(status, 200)


class TestApiTokenHandshake(LocalApiSecurityTestBase):
    """A-API-001: with a token provisioned, every API route except /api/health
    requires the X-GeneCode-Token header; the health payload carries a nonce,
    api version and capabilities."""

    API_TOKEN = "deadbeef" * 8  # 64 hex chars — 256-bit equivalent

    @classmethod
    def setUpClass(cls) -> None:
        previous = server.AppHandler.API_TOKEN
        server.AppHandler.API_TOKEN = cls.API_TOKEN
        cls._previous_token = previous
        super().setUpClass()

    @classmethod
    def tearDownClass(cls) -> None:
        super().tearDownClass()
        server.AppHandler.API_TOKEN = cls._previous_token

    def request(self, *args: Any, token: str | None = None, **kwargs: Any) -> tuple[int, dict[str, str], bytes]:
        headers = kwargs.setdefault("headers", {})
        if token is not None:
            headers["X-GeneCode-Token"] = token
        return super().request(*args, **kwargs)

    def test_health_stays_public_and_carries_identity(self) -> None:
        status, _, body = self.request("GET", "/api/health")
        self.assertEqual(status, 200)
        payload = json.loads(body.decode("utf-8"))
        self.assertTrue(payload["ok"])
        self.assertIsInstance(payload.get("nonce"), str)
        self.assertTrue(payload["nonce"])
        self.assertEqual(payload.get("apiVersion"), server.API_VERSION)
        self.assertIn("bearer-token", payload.get("capabilities", []))
        self.assertTrue(payload.get("requiresToken") is True)

    def test_health_nonce_is_stable_per_process(self) -> None:
        _, _, first = self.request("GET", "/api/health")
        _, _, second = self.request("GET", "/api/health")
        self.assertEqual(
            json.loads(first.decode())["nonce"],
            json.loads(second.decode())["nonce"],
        )

    def test_post_without_token_is_rejected(self) -> None:
        payload = json.dumps({"sequence": "ACGT"}).encode()
        status, _, _ = self.request("POST", "/api/parse/sequence", body=payload)
        self.assertEqual(status, 401)

    def test_post_with_wrong_token_is_rejected(self) -> None:
        payload = json.dumps({"sequence": "ACGT"}).encode()
        status, _, _ = self.request("POST", "/api/parse/sequence", body=payload, token="f" * 64)
        self.assertEqual(status, 401)

    def test_post_with_correct_token_is_accepted(self) -> None:
        payload = json.dumps({"sequence": "ACGT", "format": "fasta"}).encode()
        status, _, body = self.request(
            "POST", "/api/parse/sequence", body=payload, token=self.API_TOKEN
        )
        self.assertEqual(status, 200, body.decode("utf-8", "replace"))

    def test_get_api_route_without_token_is_rejected(self) -> None:
        status, _, _ = self.request("GET", "/api/agent/model")
        self.assertEqual(status, 401)

    def test_sensitive_static_with_valid_token_still_forbidden(self) -> None:
        # The token authorizes API access only; static secrets stay 403.
        status, _, _ = self.request("GET", "/.env.local", token=self.API_TOKEN)
        self.assertEqual(status, 403)

    def test_static_public_without_token_still_served(self) -> None:
        status, _, _ = self.request("GET", "/")
        self.assertEqual(status, 200)

    def test_cors_preflight_allows_token_header(self) -> None:
        _, headers, _ = self.request(
            "OPTIONS", "/api/agent/model", origin="http://localhost:1420"
        )
        self.assertIn(
            server.API_TOKEN_HEADER,
            headers.get("access-control-allow-headers", ""),
        )


if __name__ == "__main__":
    unittest.main()
