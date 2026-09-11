"""config — GeneCode agent backend module (A-MAINT-001 split from server.py)."""
from __future__ import annotations

from typing import Any
from urllib.error import HTTPError
from pathlib import Path
from urllib.request import Request
from urllib.error import URLError
import json
import math
import os
import re
import secrets
import sqlite3
import ssl
import threading
import time
from urllib.parse import unquote
from urllib.request import urlopen

from .schemas import ApiError

#!/usr/bin/env python3

try:
    import certifi
except ImportError:  # Source installs may still rely on the system trust store.
    certifi = None
# A-MAINT-001: this module lives in server_pkg/, so the repo root is two levels up
# (previously `Path(__file__).resolve().parent` inside the single-file server.py).
BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.environ.get("PRIMER_DATA_DIR") or BASE_DIR).expanduser().resolve()
# ── Local API security boundary (A-SEC-001) ────────────────────────────────
# The API server binds loopback by default and is only reachable from the
# local machine. CORS is restricted to known local development / Tauri origins
# so a malicious webpage the user happens to visit cannot read local files or
# rewrite provider configuration. Host validation blocks DNS-rebinding attacks
# that would otherwise let remote pages reach 127.0.0.1:8000.
# ── Local API token handshake (A-API-001) ────────────────────────────────
# A random 256-bit bearer token is generated at startup (or supplied via
# --token / GENE_CODE_API_TOKEN). Every /api/* request except /api/health must
# present it in the X-GeneCode-Token header; the health endpoint stays public
# so the app can discover the service before provisioning the token. When the
# token is empty, enforcement is disabled (tests and legacy ad-hoc launches).
API_TOKEN_HEADER = "X-GeneCode-Token"
API_VERSION = "1.0.0"
API_CAPABILITIES = ["health-nonce", "bearer-token", "sse-agent-stream", "run-journal", "artifact-store", "mcp-readonly"]
def generate_api_token() -> str:
    """256-bit hex bearer token (64 hex chars)."""
    return secrets.token_hex(32)
TRUSTED_WEB_ORIGINS = frozenset(
    {
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
    }
)
# Local hosts accepted for the Host header; extend for explicit LAN use via
# the GENE_CODE_ALLOWED_HOSTS environment variable (comma-separated).
ALLOWED_HOST_NAMES = frozenset(
    {"127.0.0.1", "localhost", "::1", "[::1]"}
    | {
        h.strip().lower()
        for h in os.environ.get("GENE_CODE_ALLOWED_HOSTS", "").split(",")
        if h.strip()
    }
)
# Paths that must never be served over HTTP. The static root is the repo
# directory, so everything from API keys to the server source to the test
# suite lives inside it; deny by prefix and suffix before any file is read.
SENSITIVE_STATIC_PREFIXES = (
    "/.env",
    "/.git",
    "/.freebuff",
    "/.wrangler",
    "/.playwright-cli",
    "/.runtime-cache",
    "/.cache",
    "/.vscode",
    "/node_modules/",
    "/tests/",
    "/backups/",
    "/reports/",
    "/fixtures/",
    "/.orchestration/",
)
SENSITIVE_STATIC_SUFFIXES = (
    ".py",
    ".pyc",
    ".db",
    ".db-shm",
    ".db-wal",
    ".pem",
    ".key",
    ".p12",
    ".mobileprovision",
    ".pptx",
    ".sqlite",
)
def is_sensitive_static_path(path: str) -> bool:
    lowered = path.lower()
    # Path traversal, raw or URL-encoded (%2e%2e%2f) — SimpleHTTPRequestHandler
    # unquotes before resolving, so the deny list must see the decoded form.
    if ".." in path or ".." in unquote(lowered):
        return True
    if lowered.startswith(SENSITIVE_STATIC_PREFIXES):
        return True
    if lowered.endswith(SENSITIVE_STATIC_SUFFIXES):
        return True
    return False
def load_local_env_files() -> None:
    candidates = [DATA_DIR / ".env.local", DATA_DIR / ".env"]
    if DATA_DIR != BASE_DIR:
        candidates.extend((BASE_DIR / ".env.local", BASE_DIR / ".env"))
    for path in candidates:
        if not path.exists():
            continue
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        for raw_line in lines:
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[7:].strip()
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip()
            if not key or key in os.environ:
                continue
            if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
                value = value[1:-1]
            os.environ[key] = value
load_local_env_files()
def persist_local_env_overrides(overrides: dict[str, str]) -> None:
    """Update AGENT_LLM_* keys in the local .env file without touching other lines.

    Used by the runtime model-switch endpoint so the new model survives a
    service restart. Never writes the API key back to the terminal/logs.
    """
    env_path = DATA_DIR / ".env.local"
    lines: list[str] = []
    if env_path.exists():
        try:
            lines = env_path.read_text(encoding="utf-8").splitlines()
        except OSError:
            lines = []
    keys = set(overrides)
    updated: set[str] = set()
    out: list[str] = []
    for raw in lines:
        line = raw.strip()
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" in line and line.split("=", 1)[0].strip() in keys:
            key = line.split("=", 1)[0].strip()
            out.append(f"{key}={overrides[key]}")
            updated.add(key)
        else:
            out.append(raw)
    for key, value in overrides.items():
        if key not in updated:
            out.append(f"{key}={value}")
    try:
        env_path.write_text("\n".join(out) + "\n", encoding="utf-8")
    except OSError as exc:
        raise ApiError(f"无法写入 {env_path.name}，模型配置仅在本次运行中生效。")
NCBI_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
ENSEMBL_BASE = "https://rest.ensembl.org"
BLAST_BASE = "https://blast.ncbi.nlm.nih.gov/Blast.cgi"
def build_ssl_context() -> ssl.SSLContext:
    if os.environ.get("PRIMER_SSL_VERIFY", "1") == "0":
        return ssl._create_unverified_context()
    if certifi is not None:
        return ssl.create_default_context(cafile=certifi.where())
    return ssl.create_default_context()
SSL_CONTEXT = build_ssl_context()
ACCESSION_RE = re.compile(r"^[A-Z]{1,4}_[0-9]+(?:\.[0-9]+)?$")
# v2: request body size limit — reject payloads larger than this (bytes)
MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024  # 10 MB
# v2: per-workspace sequence length upper bounds
MAX_SEQUENCE_LENGTH = {
    "rtqpcr": 10_000,
    "sgrna": 50_000,
    "sirna": 20_000,
    "mutagenesis": 10_000,
    "cloning": 50_000,
    "default": 100_000,
}
# v2: max concurrent LLM calls
MAX_LLM_CONCURRENCY = 3
_LLM_SEMAPHORE = threading.Semaphore(MAX_LLM_CONCURRENCY)
NCBI_CACHE_TTL = 6 * 60 * 60
ENSEMBL_CACHE_TTL = 24 * 60 * 60
BLAST_CACHE_TTL = 24 * 60 * 60
PERSISTENT_CACHE_FILE = DATA_DIR / ".runtime-cache" / "api_cache.db"
HTTP_RETRY_ATTEMPTS = 3
try:
    AGENT_LLM_TIMEOUT = max(
        5.0,
        min(180.0, float(os.environ.get("AGENT_LLM_TIMEOUT", "18"))),
    )
except ValueError:
    AGENT_LLM_TIMEOUT = 18.0
DEFAULT_AGENT_LLM_BASE_URL = "https://api.openai.com/v1"
REQUEST_MIN_GAP = {
    "ncbi": 0.34,
    "ensembl": 0.12,
    "blast": 1.0,
}
_CACHE: dict[str, tuple[float, Any]] = {}
_CACHE_LOCK = threading.Lock()
_REQUEST_LOCK = threading.Lock()
_LAST_REQUEST_AT: dict[str, float] = {}
_REMOTE_DIAGNOSTICS = threading.local()
REMOTE_SERVICE_LABELS = {
    "ncbi": "NCBI",
    "ensembl": "Ensembl",
    "blast": "NCBI BLAST",
}
AGENT_SPECIES_ALIASES = [
    (("homo sapiens", "human", "人的", "人源", "人类"), "Homo sapiens"),
    (("mus musculus", "mouse", "mice", "小鼠", "鼠源"), "Mus musculus"),
    (("rattus norvegicus", "rat", "大鼠"), "Rattus norvegicus"),
    (("sus scrofa", "pig", "swine", "猪"), "Sus scrofa"),
    (("suid alphaherpesvirus 1", "prv", "pseudorabies virus", "伪狂犬"), "Suid alphaherpesvirus 1"),
]
AGENT_QUERY_STOPWORDS = {
    "hello", "hi", "hey", "please", "help", "design", "generate", "make", "build",
    "for", "with", "and", "the", "this", "that", "current", "best", "stable",
    "human", "mouse", "mice", "rat", "pig", "swine", "prv",
    "qpcr", "qper", "rt", "pcr", "rtqpcr", "rt-qpcr", "rtpcr", "rt-pcr", "q-pcr", "primer", "primers",
    "taqman", "probe", "transcript", "accession", "sequence", "seq", "cdna", "mrna",
    "dna", "rna", "sgrna", "sirna", "crispr", "guide", "guides", "ko", "ki", "pam",
    "cloning", "clone", "gibson", "restriction", "insert", "vector", "golden", "gate", "type",
    "mutagenesis", "mutation", "mutant", "result", "results", "explain", "compare", "why",
}
CLONING_COMMON_INSERT_ALIASES = {
    "GFP", "EGFP", "EYFP", "ECFP", "CFP", "YFP", "BFP", "RFP", "MCHERRY", "DSRED",
    "MNEONGREEN", "SCARLET", "LUC", "LUC2", "LUCIFERASE", "FLAG", "HA", "MYC", "V5", "HIS",
}
def cache_key(namespace: str, payload: dict[str, Any]) -> str:
    return f"{namespace}:{json.dumps(payload, ensure_ascii=False, sort_keys=True)}"
def cache_namespace(key: str) -> str:
    return key.split(":", 1)[0]
PERSISTENT_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
_DB_CONN = sqlite3.connect(PERSISTENT_CACHE_FILE, check_same_thread=False)
try:
    _DB_CONN.execute("PRAGMA journal_mode=WAL")
    _DB_CONN.execute("CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT, expires_at REAL)")
    _DB_CONN.execute("CREATE INDEX IF NOT EXISTS idx_expires_at ON cache(expires_at)")
    _DB_CONN.commit()
except sqlite3.DatabaseError:
    # In case of DB corruption, purge and recreate
    PERSISTENT_CACHE_FILE.unlink()
    _DB_CONN = sqlite3.connect(PERSISTENT_CACHE_FILE, check_same_thread=False)
    _DB_CONN.execute("CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT, expires_at REAL)")
    _DB_CONN.commit()
def cache_fetch(key: str, allow_stale: bool = False) -> tuple[bool, Any | None, bool]:
    now = time.time()
    with _CACHE_LOCK:
        try:
            cursor = _DB_CONN.execute("SELECT value, expires_at FROM cache WHERE key = ?", (key,))
            row = cursor.fetchone()
        except sqlite3.Error:
            return False, None, False

        if not row:
            return False, None, False

        value_raw, expires_at = row
        try:
            value = json.loads(value_raw)
        except Exception:
            try:
                _DB_CONN.execute("DELETE FROM cache WHERE key = ?", (key,))
                _DB_CONN.commit()
            except sqlite3.Error:
                pass
            return False, None, False

        if expires_at < now:
            if allow_stale:
                return True, value, True
            try:
                _DB_CONN.execute("DELETE FROM cache WHERE key = ?", (key,))
                _DB_CONN.commit()
            except sqlite3.Error:
                pass
            return False, None, False

        return True, value, False
def cache_get(key: str) -> Any | None:
    found, value, is_stale = cache_fetch(key)
    if not found or is_stale:
        return None
    return value
def cache_set(key: str, value: Any, ttl: int = NCBI_CACHE_TTL) -> Any:
    now = time.time()
    with _CACHE_LOCK:
        try:
            value_raw = json.dumps(value, ensure_ascii=False)
            _DB_CONN.execute(
                "INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)",
                (key, value_raw, now + ttl)
            )
            if id(value) % 10 == 0:  # Random periodic cleanup
                _DB_CONN.execute("DELETE FROM cache WHERE expires_at < ?", (now,))
            _DB_CONN.commit()
        except Exception:
            pass
    return value
def wait_for_request_slot(service: str) -> None:
    delay = REQUEST_MIN_GAP.get(service, 0)
    if delay <= 0:
        return
    with _REQUEST_LOCK:
        now = time.time()
        wait_time = max(0.0, delay - (now - _LAST_REQUEST_AT.get(service, 0.0)))
        if wait_time > 0:
            time.sleep(wait_time)
        _LAST_REQUEST_AT[service] = time.time()
def retryable_http_status(code: int) -> bool:
    return code in {408, 425, 429, 500, 502, 503, 504}
def retry_delay_seconds(service: str, attempt: int, retry_after: float | None = None) -> float:
    base = 0.6 if service == "ensembl" else 1.0 if service == "ncbi" else 1.8
    suggested = base * (attempt + 1)
    if retry_after is not None and retry_after > 0:
        suggested = max(suggested, retry_after)
    return min(12.0, suggested)
def parse_retry_after_seconds(raw_value: str | None) -> float | None:
    if raw_value in (None, ""):
        return None
    try:
        return max(0.0, float(str(raw_value).strip()))
    except (TypeError, ValueError):
        return None
def begin_remote_diagnostics() -> None:
    _REMOTE_DIAGNOSTICS.state = {"services": {}}
def clear_remote_diagnostics() -> None:
    if hasattr(_REMOTE_DIAGNOSTICS, "state"):
        delattr(_REMOTE_DIAGNOSTICS, "state")
def remote_diagnostics_state() -> dict[str, Any] | None:
    return getattr(_REMOTE_DIAGNOSTICS, "state", None)
def remote_diagnostics_service(service: str) -> dict[str, Any] | None:
    state = remote_diagnostics_state()
    if state is None:
        return None
    services = state.setdefault("services", {})
    return services.setdefault(
        service,
        {
            "fresh_cache_hits": 0,
            "stale_cache_hits": 0,
            "retries": 0,
            "rate_limit_hits": 0,
            "retry_after_sec": 0.0,
            "last_error": "",
            "last_status": None,
        },
    )
def record_remote_cache_hit(service: str, *, stale: bool = False) -> None:
    stats = remote_diagnostics_service(service)
    if not stats:
        return
    key = "stale_cache_hits" if stale else "fresh_cache_hits"
    stats[key] += 1
def record_remote_retry(service: str, *, status_code: int | None = None, retry_after_sec: float | None = None) -> None:
    stats = remote_diagnostics_service(service)
    if not stats:
        return
    stats["retries"] += 1
    if status_code == 429:
        stats["rate_limit_hits"] += 1
    if status_code is not None:
        stats["last_status"] = status_code
    if retry_after_sec and retry_after_sec > stats["retry_after_sec"]:
        stats["retry_after_sec"] = retry_after_sec
def record_remote_error(service: str, message: str, *, status_code: int | None = None, rate_limited: bool = False) -> None:
    stats = remote_diagnostics_service(service)
    if not stats:
        return
    stats["last_error"] = message
    if status_code is not None:
        stats["last_status"] = status_code
    if rate_limited:
        stats["rate_limit_hits"] += 1
def summarize_remote_diagnostics() -> dict[str, Any] | None:
    state = remote_diagnostics_state()
    services = state.get("services") if isinstance(state, dict) else None
    if not services:
        return None

    summary: dict[str, dict[str, Any]] = {}
    messages: list[str] = []
    used_stale_cache = False
    for service, raw in services.items():
        label = REMOTE_SERVICE_LABELS.get(service, service.upper())
        item = {
            "label": label,
            "freshCacheHits": int(raw.get("fresh_cache_hits") or 0),
            "staleCacheHits": int(raw.get("stale_cache_hits") or 0),
            "retries": int(raw.get("retries") or 0),
            "rateLimitHits": int(raw.get("rate_limit_hits") or 0),
            "retryAfterSec": round(float(raw.get("retry_after_sec") or 0), 2),
            "lastStatus": raw.get("last_status"),
            "lastError": raw.get("last_error") or "",
        }
        summary[service] = item

        if item["staleCacheHits"] > 0:
            used_stale_cache = True
            messages.append(f"{label} 当前波动，已回退到缓存结果；建议稍后再刷新一次确认最新数据。")
            continue
        if item["rateLimitHits"] > 0 and item["retries"] > 0:
            wait_hint = ""
            if item["retryAfterSec"] >= 1:
                wait_hint = f"（自动等待约 {math.ceil(item['retryAfterSec'])} 秒）"
            messages.append(f"{label} 本次请求遇到限流，系统已自动重试成功{wait_hint}。")
            continue
        if item["retries"] > 0:
            messages.append(f"{label} 本次请求自动重试 {item['retries']} 次后成功。")

    return {
        "services": summary,
        "usedStaleCache": used_stale_cache,
        "messages": messages,
    }
def merge_remote_diagnostics(body: dict[str, Any], diagnostics: dict[str, Any] | None) -> dict[str, Any]:
    if not diagnostics or not diagnostics.get("services"):
        return body
    meta = body.setdefault("meta", {})
    meta["remoteDiagnostics"] = diagnostics
    messages = diagnostics.get("messages") or []
    if messages:
        existing = body.get("messages")
        if isinstance(existing, list):
            for message in messages:
                if message not in existing:
                    existing.append(message)
        elif isinstance(existing, str) and existing.strip():
            body["messages"] = [existing, *[message for message in messages if message != existing]]
        elif existing in (None, ""):
            body["messages"] = list(messages)
    return body
def remote_text_request(
    url: str,
    *,
    headers: dict[str, str],
    timeout: int,
    service: str,
    rate_limit_message: str,
    http_error_label: str,
    connection_message: str,
) -> str:
    last_http: HTTPError | None = None
    last_url_error: URLError | None = None
    for attempt in range(HTTP_RETRY_ATTEMPTS):
        wait_for_request_slot(service)
        req = Request(url, headers=headers)
        try:
            with urlopen(req, timeout=timeout, context=SSL_CONTEXT) as response:
                return response.read().decode("utf-8", "ignore")
        except HTTPError as exc:
            last_http = exc
            retry_after = parse_retry_after_seconds(exc.headers.get("Retry-After") if exc.headers else None)
            if retryable_http_status(exc.code) and attempt < HTTP_RETRY_ATTEMPTS - 1:
                record_remote_retry(service, status_code=exc.code, retry_after_sec=retry_after)
                time.sleep(retry_delay_seconds(service, attempt, retry_after))
                continue
            if exc.code == 429:
                record_remote_error(service, rate_limit_message, status_code=exc.code, rate_limited=True)
            else:
                record_remote_error(service, f"{http_error_label}: HTTP {exc.code}", status_code=exc.code)
            if exc.code == 429:
                wait_hint = ""
                if retry_after and retry_after >= 1:
                    wait_hint = f" 建议约 {math.ceil(retry_after)} 秒后再试。"
                raise ApiError(f"{rate_limit_message}{wait_hint}") from exc
            raise ApiError(f"{http_error_label}: HTTP {exc.code}") from exc
        except URLError as exc:
            last_url_error = exc
            if attempt < HTTP_RETRY_ATTEMPTS - 1:
                record_remote_retry(service)
                time.sleep(retry_delay_seconds(service, attempt))
                continue
            record_remote_error(service, connection_message)
            raise ApiError(connection_message) from exc

    if last_http:
        if last_http.code == 429:
            raise ApiError(rate_limit_message) from last_http
        raise ApiError(f"{http_error_label}: HTTP {last_http.code}") from last_http
    if last_url_error:
        raise ApiError(connection_message) from last_url_error
    raise ApiError(connection_message)
# A-AGT-003: server-side cancellation flags.  A run that the client asked to
# stop is marked here; the SSE generator and the LLM subprocess poll this set
# between steps / while waiting, so the backend stops consuming model quota
# and CPU instead of only dropping the client's socket.  Entries carry a
# timestamp and are TTL-evicted like the other in-memory stores so a cancel
# for a never-executed (or already-finished) run cannot grow the set forever.
_CANCELLED_RUNS_TTL = 600  # 10 minutes
_cancelled_runs: dict[str, float] = {}
_cancelled_runs_lock = threading.Lock()
def _cleanup_cancelled_runs() -> None:
    """Evict cancellation flags older than the TTL (caller holds the lock)."""
    cutoff = time.time() - _CANCELLED_RUNS_TTL
    stale = [k for k, t in _cancelled_runs.items() if t < cutoff]
    for k in stale:
        _cancelled_runs.pop(k, None)
def _is_run_cancelled(run_id: str) -> bool:
    """True when the run has been cancelled and not yet cleared."""
    if not run_id:
        return False
    with _cancelled_runs_lock:
        _cleanup_cancelled_runs()
        return run_id in _cancelled_runs
def _clear_cancelled_flag(run_id: str) -> None:
    """Remove the cancellation flag once the run's generator has exited."""
    if not run_id:
        return
    with _cancelled_runs_lock:
        _cancelled_runs.pop(run_id, None)
def _cleanup_stale_entries(store: dict[str, float], ttl: float) -> None:
    """Remove entries older than ttl from an in-memory store."""
    cutoff = time.time() - ttl
    stale = [k for k, t in store.items() if t < cutoff]
    for k in stale:
        store.pop(k, None)
