"""api — GeneCode agent backend module (A-MAINT-001 split from server.py)."""
from __future__ import annotations

from typing import Any
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler
from http.server import ThreadingHTTPServer
import argparse
import hmac
import json
import os
from functools import partial
import secrets
from urllib.parse import parse_qs, urlparse

from .schemas import ApiError
from .config import ALLOWED_HOST_NAMES, API_CAPABILITIES, API_TOKEN_HEADER, API_VERSION, BASE_DIR, MAX_REQUEST_BODY_BYTES, TRUSTED_WEB_ORIGINS, begin_remote_diagnostics, clear_remote_diagnostics, generate_api_token, is_sensitive_static_path, merge_remote_diagnostics, summarize_remote_diagnostics
from .bio import design_cloning_response, design_mutagenesis_response, design_rt_batch_response, design_rt_response, design_sgrna_response, design_sirna_response, export_sequence_response, parse_sequence_response, resolve_rt_target_response, resolve_sgrna_target_response, resolve_sirna_target_response, scan_restriction_sites_response
from .providers import agent_llm_config, agent_llm_public_status, set_agent_llm_model_response, test_agent_llm_connection_response
from .agent import _cancel_run, _inject_sse_metadata, _run_journal, agent_chat_response, agent_confirm_response, agent_execute_response, agent_execute_sse_generator, check_rt_specificity_response, check_sgrna_offtarget_response, check_sirna_offtarget_response, incoming_agent_run_id
from .mcp_gateway import MCP_MAX_REQUEST_BYTES, handle_mcp_jsonrpc

class AppHandler(SimpleHTTPRequestHandler):
    # A-API-001: set by main() at startup (or left empty to disable
    # enforcement). Tests set a value explicitly to exercise the 401 path.
    API_TOKEN: str = ""
    # Per-process random nonce for restart detection. Class attribute so the
    # health payload is stable for the lifetime of the process.
    API_NONCE: str = secrets.token_hex(16)

    def __init__(self, *args: Any, directory: str | None = None, **kwargs: Any) -> None:
        # A-OBS-001: per-request correlation id, echoed on every response
        # header and included in access + error logs. Must be set BEFORE the
        # base-class init because SimpleHTTPRequestHandler.__init__ already
        # runs handle() for the request.
        self.request_id = secrets.token_hex(8)
        super().__init__(*args, directory=directory or str(BASE_DIR), **kwargs)

    def log_message(self, format: str, *args: Any) -> None:
        try:
            req = getattr(self, "request_id", "-")
            print(
                f"[{self.log_date_time_string()}] req={req} {format % args}",
                flush=True,
            )
        except OSError:
            pass

    # v2: CORS support — restricted to trusted local origins only (A-SEC-001).
    def end_headers(self) -> None:
        origin = self.headers.get("Origin")
        if self._origin_is_trusted(origin):
            if origin:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header(
                "Access-Control-Allow-Headers",
                f"Content-Type, {API_TOKEN_HEADER}",
            )
        # A-OBS-001: correlate responses with access/error logs.
        self.send_header("X-Request-ID", self.request_id)
        super().end_headers()

    # A-API-001: constant-time bearer-token check. Empty class token disables
    # enforcement (tests / ad-hoc launches); when set, all API routes except
    # /api/health require an exact match.
    def _token_presented(self) -> bool:
        expected = type(self).API_TOKEN
        if not expected:
            return True
        presented = (self.headers.get(API_TOKEN_HEADER) or "").strip()
        return bool(presented) and hmac.compare_digest(presented, expected)

    def _reject_if_bad_token(self) -> bool:
        """Return True when the request was rejected with 401."""
        if self._token_presented():
            return False
        try:
            self.write_json(
                HTTPStatus.UNAUTHORIZED,
                {"ok": False, "error": "Missing or invalid API token."},
            )
        except OSError:
            pass
        return True

    def _host_allowed(self) -> bool:
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip().lower()
        return host in ALLOWED_HOST_NAMES

    def _origin_is_trusted(self, origin: str | None) -> bool:
        """True for known dev/Tauri origins and for the server's own origin.

        Requests with no Origin header (curl, non-browser IPC) are treated as
        trusted — they cannot be forged by a remote webpage.
        """
        if not origin:
            return True
        if origin in TRUSTED_WEB_ORIGINS:
            return True
        try:
            parts = urlparse(origin)
        except ValueError:
            return False
        if parts.scheme == "http" and parts.hostname in ("127.0.0.1", "localhost", "::1"):
            server_port = getattr(self.server, "server_address", (None, None))[1]
            if parts.port is None or parts.port == server_port:
                return True
        return False

    def _reject_if_untrusted_host(self) -> bool:
        """Reject requests whose Host header isn't a known local host.

        Guards against DNS rebinding: a remote page resolving its own domain to
        127.0.0.1 would otherwise bypass the CORS boundary because the browser
        would treat the request as same-origin.

        Returns True when the request was rejected and must not be processed.
        """
        if self._host_allowed():
            return False
        try:
            self.send_response(HTTPStatus.FORBIDDEN)
            body = json.dumps({"ok": False, "error": "Untrusted Host header."}).encode("utf-8")
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except OSError:
            pass
        return True

    def _request_blocked(self, path: str) -> bool:
        """Shared guard for GET and HEAD: host validation, API 404s and the
        sensitive-static-path deny list must apply to both verb methods
        (HEAD previously bypassed every check).
        """
        if self._reject_if_untrusted_host():
            return True
        journal_route = path == "/api/agent/runs" or path.startswith("/api/agent/runs/")
        if path.startswith("/api/") and path != "/api/health":
            if not self._token_presented():
                self.write_json(
                    HTTPStatus.UNAUTHORIZED,
                    {"ok": False, "error": "Missing or invalid API token."},
                )
                return True
            if not journal_route:
                self.write_json(HTTPStatus.NOT_FOUND, {"error": "Unknown API route"})
                return True
        if is_sensitive_static_path(path):
            self.write_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "Forbidden."})
            return True
        return False

    def do_OPTIONS(self) -> None:
        if self._reject_if_untrusted_host():
            return
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if self._request_blocked(path):
            return
        if path == "/api/health":
            self.write_json(HTTPStatus.OK, self._health_payload())
            return
        if path == "/api/agent/runs":
            query = parse_qs(urlparse(self.path).query)
            raw_limit = query.get("limit", ["50"])[0]
            try:
                limit = int(raw_limit)
            except (TypeError, ValueError):
                limit = 50
            self.write_json(HTTPStatus.OK, {"ok": True, "runs": _run_journal.list_runs(limit)})
            return
        if path.startswith("/api/agent/runs/"):
            parts = path.strip("/").split("/")
            if len(parts) == 4:
                run_id = parts[3]
                record = _run_journal.load_run(run_id)
                if record is None:
                    self.write_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Run not found."})
                else:
                    self.write_json(HTTPStatus.OK, {"ok": True, "run": record})
                return
            if len(parts) == 6 and parts[4] == "artifacts":
                query = parse_qs(urlparse(self.path).query)
                preview = query.get("preview", ["0"])[0] in {"1", "true", "yes"}
                raw_max_bytes = query.get("maxBytes", ["32768" if preview else "2000000"])[0]
                try:
                    max_bytes = int(raw_max_bytes)
                except (TypeError, ValueError):
                    max_bytes = 2_000_000
                artifact = _run_journal.get_artifact(
                    parts[3],
                    parts[5],
                    include_data=True,
                    max_bytes=max_bytes,
                )
                if artifact is None:
                    self.write_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Artifact not found."})
                else:
                    self.write_json(HTTPStatus.OK, {"ok": True, "artifact": artifact})
                return
            self.write_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Unknown run route."})
            return
        super().do_GET()

    def _health_payload(self) -> dict[str, Any]:
        """A-API-001: public identity + restart-detection nonce. The nonce is
        per-process random so clients can detect a server restart and
        re-provision their token instead of silently sending a stale one.
        requiresToken tells clients whether enforcement is on, so a 401 can
        be attributed to a missing token rather than a broken server."""
        return {
            "ok": True,
            "nonce": type(self).API_NONCE,
            "apiVersion": API_VERSION,
            "requiresToken": bool(type(self).API_TOKEN),
            "capabilities": API_CAPABILITIES,
            "llm": agent_llm_public_status(agent_llm_config()),
        }

    def do_HEAD(self) -> None:
        """HEAD must enforce the same host/deny guards as GET; otherwise it
        bypasses every protection (the original audit PoC used HEAD)."""
        path = urlparse(self.path).path
        if self._request_blocked(path):
            return
        if path == "/api/health":
            body = json.dumps(self._health_payload()).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return
        f = self.send_head()
        if f:
            try:
                f.close()
            except OSError:
                pass

    def do_POST(self) -> None:
        if self._reject_if_untrusted_host():
            return
        # A-SEC-001: browsers always send Origin on POSTs. Any page whose
        # origin isn't a known local/Tauri origin must not be able to drive
        # the API at all (LLM calls, agent runs, config writes) — not even as
        # a CORS "simple request" with a text/plain JSON body.
        if not self._origin_is_trusted(self.headers.get("Origin")):
            self.write_json(
                HTTPStatus.FORBIDDEN,
                {"ok": False, "error": "Cross-origin requests are blocked."},
            )
            return
        # A-API-001: the bearer token is required for every POST route.
        if self._reject_if_bad_token():
            return
        route = urlparse(self.path).path
        if route not in {
            "/api/design/rtqpcr",
            "/api/design/cloning",
            "/api/design/mutagenesis",
            "/api/design/sgrna",
            "/api/design/sirna",
            "/api/agent/chat",
            "/api/agent/test-llm",
            "/api/agent/model",
            "/api/agent/execute",
            "/api/agent/execute/stream",
            "/api/agent/cancel",
            "/api/agent/confirm",
            "/api/resolve/rtqpcr-target",
            "/api/resolve/sgrna-target",
            "/api/resolve/sirna-target",
            "/api/design/rtqpcr-batch",
            "/api/check/rtqpcr-specificity",
            "/api/check/sirna-offtarget",
            "/api/check/sgrna-offtarget",
            "/api/parse/sequence",
            "/api/export/sequence",
            "/api/scan/restriction-sites",
            "/api/mcp",
        }:
            self.write_json(HTTPStatus.NOT_FOUND, {"error": "Unknown API route"})
            return

        # v2: request body size guard
        length = int(self.headers.get("Content-Length", "0"))
        if length > MAX_REQUEST_BODY_BYTES:
            self.write_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"ok": False, "error": f"请求体过大（{length} bytes），上限 {MAX_REQUEST_BODY_BYTES // (1024*1024)} MB。"})
            return

        # Narrow MCP-compatible JSON-RPC route.  It is intentionally handled
        # before the design/Agent routes so MCP cannot accidentally fall
        # through to a write-capable endpoint.  Host/origin/token guards above
        # remain mandatory for this local integration point.
        if route == "/api/mcp":
            if length > MCP_MAX_REQUEST_BYTES:
                self.write_json(
                    HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                    {"ok": False, "error": f"MCP 请求体过大，上限 {MCP_MAX_REQUEST_BYTES // 1024} KB。"},
                )
                return
            try:
                message = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            except json.JSONDecodeError:
                self.write_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "MCP 请求体不是合法 JSON。"})
                return
            response = handle_mcp_jsonrpc(message)
            if response is None:
                self.send_response(HTTPStatus.NO_CONTENT)
                self.end_headers()
            else:
                self.write_json(HTTPStatus.OK, response)
            return

        # A-AGT-003: server-side task cancellation.  The client sends the same
        # run_id it used for the execute request; the run is flagged so the SSE
        # generator and the LLM subprocess stop at the next boundary.
        if route == "/api/agent/cancel":
            try:
                payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            except json.JSONDecodeError:
                self.write_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "请求体不是合法 JSON。"})
                return
            run_id = incoming_agent_run_id(payload)
            if not run_id:
                self.write_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "缺少 run_id，无法取消任务。"})
                return
            was_pending = _cancel_run(run_id)
            self.write_json(HTTPStatus.OK, {
                "ok": True,
                "run_id": run_id,
                "status": "cancelled",
                "pending": was_pending,
            })
            return

        # v3: SSE streaming route — handled separately (no write_json wrapper)
        if route == "/api/agent/execute/stream":
            try:
                payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            except json.JSONDecodeError:
                self.write_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "请求体不是合法 JSON。"})
                return
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            try:
                run_id = incoming_agent_run_id(payload)
                for frame in _inject_sse_metadata(
                    agent_execute_sse_generator(payload), run_id
                ):
                    self.wfile.write(frame)
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                # A-AGT-003: a dropped socket is also a Stop.  Cancel the run
                # so the LLM subprocess and remaining tools stop at the next
                # boundary instead of burning model quota until timeout.
                _cancel_run(incoming_agent_run_id(payload))
            return

        begin_remote_diagnostics()
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            if route == "/api/design/rtqpcr":
                body = design_rt_response(payload)
            elif route == "/api/design/cloning":
                body = design_cloning_response(payload)
            elif route == "/api/design/mutagenesis":
                body = design_mutagenesis_response(payload)
            elif route == "/api/design/sgrna":
                body = design_sgrna_response(payload)
            elif route == "/api/design/sirna":
                body = design_sirna_response(payload)
            elif route == "/api/agent/chat":
                body = agent_chat_response(payload)
            elif route == "/api/agent/test-llm":
                body = test_agent_llm_connection_response()
            elif route == "/api/agent/model":
                body = set_agent_llm_model_response(payload)
            elif route == "/api/agent/execute":
                body = agent_execute_response(payload)
            elif route == "/api/agent/confirm":
                body = agent_confirm_response(payload)
            elif route == "/api/resolve/rtqpcr-target":
                body = resolve_rt_target_response(payload)
            elif route == "/api/resolve/sgrna-target":
                body = resolve_sgrna_target_response(payload)
            elif route == "/api/resolve/sirna-target":
                body = resolve_sirna_target_response(payload)
            elif route == "/api/check/rtqpcr-specificity":
                body = check_rt_specificity_response(payload)
            elif route == "/api/check/sirna-offtarget":
                body = check_sirna_offtarget_response(payload)
            elif route == "/api/check/sgrna-offtarget":
                body = check_sgrna_offtarget_response(payload)
            elif route == "/api/parse/sequence":
                body = parse_sequence_response(payload)
            elif route == "/api/export/sequence":
                body = export_sequence_response(payload)
            elif route == "/api/scan/restriction-sites":
                body = scan_restriction_sites_response(payload)
            elif route == "/api/design/rtqpcr-batch":
                body = design_rt_batch_response(payload)
            else:
                # v2: should never reach here since route is in the whitelist
                self.write_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": "Unhandled route."})
                return
            diagnostics = summarize_remote_diagnostics()
            self.write_json(HTTPStatus.OK, {"ok": True, **merge_remote_diagnostics(body, diagnostics)})
        except ApiError as exc:
            diagnostics = summarize_remote_diagnostics()
            error_body: dict[str, Any] = {"ok": False, "error": str(exc)}
            self.write_json(HTTPStatus.BAD_REQUEST, merge_remote_diagnostics(error_body, diagnostics))
        except json.JSONDecodeError:
            self.write_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "请求体不是合法 JSON。"})
        except Exception as exc:
            # v2: sanitize exception — don't leak internal details to client
            diagnostics = summarize_remote_diagnostics()
            print(f"[ERROR] req={self.request_id} {route}: {exc}", flush=True)
            error_body = {"ok": False, "error": "服务端内部错误，请稍后重试。"}
            self.write_json(HTTPStatus.INTERNAL_SERVER_ERROR, merge_remote_diagnostics(error_body, diagnostics))
        finally:
            clear_remote_diagnostics()

    def write_json(self, status: HTTPStatus, body: dict[str, Any]) -> None:
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)
def main() -> None:
    parser = argparse.ArgumentParser(description="Primer Design Studio local server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8000, type=int)
    parser.add_argument(
        "--token",
        default=None,
        help="256-bit bearer token for the local API (A-API-001). "
        "Defaults to GENE_CODE_API_TOKEN or a fresh random token.",
    )
    args = parser.parse_args()

    # A-API-001: provision the bearer token before the server accepts any
    # request. Explicit --token wins, then the environment, then a fresh
    # 256-bit random value generated at startup.
    AppHandler.API_TOKEN = (
        args.token
        or os.environ.get("GENE_CODE_API_TOKEN", "").strip()
        or generate_api_token()
    )
    if not AppHandler.API_TOKEN:
        print(
            "[WARN] API token enforcement is DISABLED (no --token and empty "
            "GENE_CODE_API_TOKEN). Start with --token for the authenticated "
            "local API (A-API-001).",
            flush=True,
        )
    token_hint = (
        "generated at startup"
        if not (args.token or os.environ.get("GENE_CODE_API_TOKEN", "").strip())
        else ("from --token" if args.token else "from GENE_CODE_API_TOKEN")
    )
    print(f"[api] bearer token {token_hint} ({len(AppHandler.API_TOKEN)} hex chars)", flush=True)

    handler = partial(AppHandler, directory=str(BASE_DIR))
    loopback_hosts = {"127.0.0.1", "localhost", "::1"}
    if str(args.host) not in loopback_hosts:
        print(
            "[WARN] Binding to a non-loopback interface exposes the local API and static "
            "files to the network. Prefer 127.0.0.1; set GENE_CODE_ALLOWED_HOSTS to "
            "allowlist specific LAN hosts.",
            flush=True,
        )
    with ThreadingHTTPServer((args.host, args.port), handler) as httpd:
        print(f"Primer Design Studio running at http://{args.host}:{args.port}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
