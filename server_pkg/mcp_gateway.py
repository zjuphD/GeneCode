"""Small, explicit read-only MCP-compatible JSON-RPC gateway.

The sidecar intentionally does not depend on the MCP Python SDK yet.  This
module implements the narrow JSON-RPC subset needed by local MCP clients while
keeping the safety boundary obvious: only the tools in ``MCP_TOOL_DEFINITIONS``
are callable, and every one is deterministic/read-only.  The HTTP wrapper in
``api.py`` still applies the normal loopback host, origin, and bearer-token
guards.

This is a compatibility gateway, not a claim of full Streamable HTTP MCP
transport support.  When the runtime adopts the official SDK, this module can
be replaced behind the same tool handlers and schemas.
"""
from __future__ import annotations

from typing import Any, Callable
import hashlib
import json
import time

from .agent import _run_journal, run_context_sequence_stats
from .bio import parse_sequence_response, sanitize_sequence, scan_restriction_sites_response
from .schemas import ApiError


MCP_PROTOCOL_VERSION = "2024-11-05"
MCP_SERVER_NAME = "genecode-readonly-gateway"
MCP_SERVER_VERSION = "1.0.0"
MCP_MAX_REQUEST_BYTES = 1 * 1024 * 1024
MCP_MAX_SEQUENCE_LENGTH = 100_000
MCP_MAX_RESTRICTION_SEQUENCE_LENGTH = 50_000
MCP_MAX_RESTRICTION_ENZYMES = 16
MCP_MAX_ARTIFACT_PREVIEW_BYTES = 64 * 1024
MCP_MAX_RESULT_BYTES = 1_500_000


class MCPRequestError(ValueError):
    """A user-correctable JSON-RPC parameter error."""


def _tool_schema(
    *,
    properties: dict[str, Any],
    required: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": properties,
        "required": required or [],
    }


def _read_only_annotations() -> dict[str, Any]:
    # MCP's annotations are hints; the real enforcement is the explicit
    # allowlist and the absence of write-capable handlers below.
    return {
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": False,
    }


def _tool_definition(name: str, description: str, schema: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": name,
        "description": description,
        "inputSchema": schema,
        "annotations": _read_only_annotations(),
        "_meta": {
            "genecode": {
                "risk": "read",
                "writesSequence": False,
                "mayGeneratePatch": False,
                "transport": "local-loopback-jsonrpc",
            }
        },
    }


MCP_TOOL_DEFINITIONS: list[dict[str, Any]] = [
    _tool_definition(
        "parse_sequence",
        "Parse FASTA, GenBank, or raw DNA into a normalized sequence document.",
        _tool_schema(
            properties={
                "text": {"type": "string", "description": "FASTA, GenBank, or raw sequence text."},
                "sequence": {"type": "string", "description": "Alias for text for a raw sequence."},
                "name": {"type": "string"},
                "filename": {"type": "string"},
                "runId": {"type": "string", "maxLength": 160, "description": "Optional existing Run ID for audit correlation."},
            },
        ),
    ),
    _tool_definition(
        "sequence_stats",
        "Compute length, GC percentage, GC count, ambiguity count, and topology.",
        _tool_schema(
            properties={
                "sequence": {"type": "string", "description": "DNA sequence or FASTA/GenBank text."},
                "name": {"type": "string"},
                "topology": {"type": "string", "enum": ["linear", "circular"]},
                "runId": {"type": "string", "maxLength": 160, "description": "Optional existing Run ID for audit correlation."},
            },
            required=["sequence"],
        ),
    ),
    _tool_definition(
        "scan_restriction_sites",
        "Scan a sequence, optionally against a vector and selected restriction enzymes.",
        _tool_schema(
            properties={
                "sequence": {"type": "string", "description": "Insert sequence or sequence document text."},
                "vectorSequence": {"type": "string"},
                "enzymes": {"type": "array", "items": {"type": "string"}, "maxItems": MCP_MAX_RESTRICTION_ENZYMES},
                "label": {"type": "string"},
                "topology": {"type": "string", "enum": ["linear", "circular"]},
                "vectorTopology": {"type": "string", "enum": ["linear", "circular"]},
                "runId": {"type": "string", "maxLength": 160, "description": "Optional existing Run ID for audit correlation."},
            },
            required=["sequence"],
        ),
    ),
    _tool_definition(
        "read_run",
        "Read a bounded, durable Agent Run Journal record by run ID.",
        _tool_schema(
            properties={"runId": {"type": "string", "minLength": 1, "maxLength": 160}},
            required=["runId"],
        ),
    ),
    _tool_definition(
        "read_artifact_preview",
        "Read bounded metadata and a UTF-8 preview of a stored Agent artifact.",
        _tool_schema(
            properties={
                "runId": {"type": "string", "minLength": 1, "maxLength": 160},
                "artifactId": {"type": "string", "minLength": 1, "maxLength": 160},
                "maxBytes": {"type": "integer", "minimum": 1024, "maximum": MCP_MAX_ARTIFACT_PREVIEW_BYTES},
            },
            required=["runId", "artifactId"],
        ),
    ),
]

_MCP_TOOL_NAMES = frozenset(item["name"] for item in MCP_TOOL_DEFINITIONS)


def _require_object(value: Any, label: str = "params") -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise MCPRequestError(f"{label} 必须是 JSON 对象。")
    return value


def _optional_string(args: dict[str, Any], key: str, *, max_chars: int = 2_000_000) -> str:
    value = args.get(key, "")
    if value is None:
        return ""
    if not isinstance(value, str):
        raise MCPRequestError(f"参数 {key} 必须是字符串。")
    if len(value) > max_chars:
        raise MCPRequestError(f"参数 {key} 过长。")
    return value


def _bounded_sequence(args: dict[str, Any], key: str, *, maximum: int) -> str:
    raw = _optional_string(args, key, max_chars=2_000_000)
    if not raw.strip():
        raise MCPRequestError(f"缺少有效的 {key}。")
    sequence = sanitize_sequence(raw)
    if not sequence:
        raise MCPRequestError(f"{key} 中没有可识别的核酸序列。")
    if len(sequence) > maximum:
        raise MCPRequestError(f"{key} 长度 {len(sequence)} bp 超过只读 MCP 上限 {maximum} bp。")
    return sequence


def _parse_sequence(args: dict[str, Any]) -> dict[str, Any]:
    text = _optional_string(args, "text") or _optional_string(args, "sequence")
    if not text.strip():
        raise MCPRequestError("请提供 text 或 sequence。")
    # parse_sequence_response performs format-aware validation and preserves
    # GenBank features.  Its raw input is bounded separately from normalized
    # sequence length so a pathological header cannot expand the request.
    if len(text) > 2_000_000:
        raise MCPRequestError("序列文本过长。")
    payload = {
        "text": text,
        "name": _optional_string(args, "name", max_chars=200) or _optional_string(args, "filename", max_chars=200),
    }
    try:
        result = parse_sequence_response(payload)
    except ApiError as exc:
        raise MCPRequestError(str(exc)) from exc
    document = result.get("document") if isinstance(result, dict) else None
    sequence = document.get("sequence") if isinstance(document, dict) else ""
    if not isinstance(sequence, str) or not sequence:
        raise MCPRequestError("无法从输入中解析有效序列。")
    if len(sequence) > MCP_MAX_SEQUENCE_LENGTH:
        raise MCPRequestError(f"序列长度超过只读 MCP 上限 {MCP_MAX_SEQUENCE_LENGTH} bp。")
    return result


def _sequence_stats(args: dict[str, Any]) -> dict[str, Any]:
    sequence = _bounded_sequence(args, "sequence", maximum=MCP_MAX_SEQUENCE_LENGTH)
    topology = _optional_string(args, "topology", max_chars=16).lower() or "linear"
    if topology not in {"linear", "circular"}:
        raise MCPRequestError("topology 只能是 linear 或 circular。")
    snapshot = {
        "currentSequenceDocument": {
            "name": _optional_string(args, "name", max_chars=200) or "MCP Sequence",
            "sequence": sequence,
            "topology": topology,
        }
    }
    result = run_context_sequence_stats(snapshot, is_selection=False)
    if result is None:  # defensive; _bounded_sequence already rejects empty data
        raise MCPRequestError("无法计算序列统计。")
    return result


def _scan_restriction_sites(args: dict[str, Any]) -> dict[str, Any]:
    sequence = _bounded_sequence(args, "sequence", maximum=MCP_MAX_RESTRICTION_SEQUENCE_LENGTH)
    vector = _optional_string(args, "vectorSequence", max_chars=2_000_000)
    if vector:
        vector = sanitize_sequence(vector)
        if not vector:
            raise MCPRequestError("vectorSequence 中没有可识别的核酸序列。")
        if len(vector) > MCP_MAX_RESTRICTION_SEQUENCE_LENGTH:
            raise MCPRequestError(f"vectorSequence 长度超过只读 MCP 上限 {MCP_MAX_RESTRICTION_SEQUENCE_LENGTH} bp。")
    enzymes = args.get("enzymes")
    if enzymes is None:
        normalized_enzymes: list[str] = []
    elif not isinstance(enzymes, list) or any(not isinstance(item, str) for item in enzymes):
        raise MCPRequestError("enzymes 必须是字符串数组。")
    else:
        normalized_enzymes = [item.strip() for item in enzymes if item.strip()]
        if len(normalized_enzymes) > MCP_MAX_RESTRICTION_ENZYMES:
            raise MCPRequestError(f"enzymes 最多允许 {MCP_MAX_RESTRICTION_ENZYMES} 项。")
    payload = {
        "sequence": sequence,
        "vectorSequence": vector,
        "enzymes": normalized_enzymes,
        "label": _optional_string(args, "label", max_chars=200) or "MCP Restriction Scan",
        "topology": _optional_string(args, "topology", max_chars=16) or "linear",
        "vectorTopology": _optional_string(args, "vectorTopology", max_chars=16) or "circular",
    }
    try:
        result = scan_restriction_sites_response(payload)
    except ApiError as exc:
        raise MCPRequestError(str(exc)) from exc
    return _bounded_scan_result(result)


def _sequence_document_summary(value: Any) -> Any:
    if not isinstance(value, dict):
        return value
    document = dict(value)
    sequence = document.pop("sequence", None)
    if isinstance(sequence, str):
        document["sequenceLength"] = len(sequence)
        document["sequenceSha256"] = hashlib.sha256(sequence.encode("ascii", errors="ignore")).hexdigest()
        document["sequencePreview"] = sequence[:120]
    return document


def _bounded_scan_result(result: dict[str, Any]) -> dict[str, Any]:
    """Keep the MCP response bounded without changing the underlying API."""
    meta = result.get("meta") if isinstance(result, dict) else None
    if not isinstance(meta, dict):
        return result
    compact_meta = dict(meta)
    if "sequenceDocument" in compact_meta:
        compact_meta["sequenceDocument"] = _sequence_document_summary(compact_meta["sequenceDocument"])
    if "vectorSequenceDocument" in compact_meta:
        compact_meta["vectorSequenceDocument"] = _sequence_document_summary(compact_meta["vectorSequenceDocument"])
    compact = {**result, "meta": compact_meta}
    try:
        if len(json.dumps(compact, ensure_ascii=False).encode("utf-8")) <= MCP_MAX_RESULT_BYTES:
            return compact
    except (TypeError, ValueError):
        pass
    analysis = compact_meta.get("restrictionAnalysis")
    compact_analysis: dict[str, Any] = {}
    if isinstance(analysis, dict):
        for key in ("insertLength", "vectorLength", "summary", "coordinate_system"):
            if key in analysis:
                compact_analysis[key] = analysis[key]
        for key in ("chosenEnzymes", "recommendedPairs"):
            value = analysis.get(key)
            if isinstance(value, list):
                compact_analysis[key] = value[:16]
        compact_analysis["truncated"] = True
    compact_meta["restrictionAnalysis"] = compact_analysis
    return {
        "meta": compact_meta,
        "messages": [str(item) for item in (result.get("messages") or [])[:12]],
        "results": [],
        "truncated": True,
    }


def _require_id(args: dict[str, Any], key: str) -> str:
    value = args.get(key)
    if not isinstance(value, str) or not value.strip():
        raise MCPRequestError(f"缺少 {key}。")
    if len(value) > 160:
        raise MCPRequestError(f"{key} 过长。")
    return value.strip()


def _read_run(args: dict[str, Any]) -> dict[str, Any]:
    run_id = _require_id(args, "runId")
    record = _run_journal.load_run(run_id)
    if record is None:
        raise MCPRequestError("未找到该 Run，或 Run Journal 当前不可用。")
    events = record.get("events") if isinstance(record, dict) else None
    if isinstance(events, list) and len(events) > 200:
        record = {
            **record,
            "events": events[-200:],
            "eventsTruncated": True,
            "eventCount": len(events),
        }
    try:
        if len(json.dumps(record, ensure_ascii=False, default=str).encode("utf-8")) > MCP_MAX_RESULT_BYTES:
            events = record.get("events") if isinstance(record.get("events"), list) else []
            record = {
                key: record.get(key)
                for key in ("run_id", "mode", "task_type", "workspace", "status", "created_at", "updated_at")
                if key in record
            }
            record.update({
                "events": events[-50:],
                "eventsTruncated": True,
                "eventCount": len(events),
                "resultTruncated": True,
            })
    except (TypeError, ValueError):
        pass
    return record


def _read_artifact_preview(args: dict[str, Any]) -> dict[str, Any]:
    run_id = _require_id(args, "runId")
    artifact_id = _require_id(args, "artifactId")
    raw_max = args.get("maxBytes", 32 * 1024)
    if isinstance(raw_max, bool) or not isinstance(raw_max, int):
        raise MCPRequestError("maxBytes 必须是整数。")
    max_bytes = max(1_024, min(raw_max, MCP_MAX_ARTIFACT_PREVIEW_BYTES))
    artifact = _run_journal.get_artifact(run_id, artifact_id, include_data=True, max_bytes=max_bytes)
    if artifact is None:
        raise MCPRequestError("未找到该 Artifact，或 Artifact Store 当前不可用。")
    return artifact


_MCP_HANDLERS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
    "parse_sequence": _parse_sequence,
    "sequence_stats": _sequence_stats,
    "scan_restriction_sites": _scan_restriction_sites,
    "read_run": _read_run,
    "read_artifact_preview": _read_artifact_preview,
}


def _jsonrpc_result(request_id: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def _jsonrpc_error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def _audit_mcp_call(run_id: str | None, tool: str, args: dict[str, Any], status: str) -> None:
    """Attach an MCP call to an existing Run without creating implicit runs."""
    if not run_id or _run_journal.load_run(run_id) is None:
        return
    try:
        args_hash = "sha256:" + hashlib.sha256(
            json.dumps(args, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")
        ).hexdigest()
        event_id = f"mcp-{time.time_ns()}-{hashlib.sha1(args_hash.encode()).hexdigest()[:10]}"
        _run_journal.append_event({
            "run_id": run_id,
            "event_id": event_id,
            "type": "mcp_tool_call",
            "tool": tool,
            "status": status,
            "timestamp": time.time(),
            "argsHash": args_hash,
            "transport": "local-loopback-jsonrpc",
        })
    except Exception:
        # Journal persistence is best-effort and must never turn a read-only
        # result into a failed design request.
        return


def _call_tool(tool: str, arguments: Any) -> dict[str, Any]:
    if tool not in _MCP_TOOL_NAMES or tool not in _MCP_HANDLERS:
        raise MCPRequestError(f"工具 {tool or '-'} 不在只读 MCP 白名单中。")
    args = _require_object(arguments, "arguments")
    run_id = args.get("runId") if isinstance(args.get("runId"), str) else None
    if run_id is not None and len(run_id) > 160:
        raise MCPRequestError("runId 过长。")
    try:
        result = _MCP_HANDLERS[tool](args)
    except MCPRequestError:
        _audit_mcp_call(run_id, tool, args, "invalid_params")
        raise
    except Exception as exc:  # pragma: no cover - defensive boundary
        _audit_mcp_call(run_id, tool, args, "error")
        if isinstance(exc, ApiError):
            raise MCPRequestError(str(exc)) from exc
        raise RuntimeError("只读工具执行失败。") from exc
    _audit_mcp_call(run_id, tool, args, "completed")
    return result


def handle_mcp_jsonrpc(message: Any) -> dict[str, Any] | None:
    """Handle one bounded JSON-RPC MCP message.

    ``None`` represents a notification response (HTTP callers should return
    204).  Batch messages are intentionally rejected until a full MCP
    transport implementation is adopted.
    """
    if not isinstance(message, dict):
        return _jsonrpc_error(None, -32600, "Invalid Request")
    if message.get("jsonrpc") != "2.0":
        return _jsonrpc_error(message.get("id"), -32600, "jsonrpc 必须是 2.0。")
    request_id = message.get("id")
    method = message.get("method")
    if not isinstance(method, str) or not method:
        return _jsonrpc_error(request_id, -32600, "缺少有效的 method。")
    params = message.get("params")
    if method in {"notifications/initialized", "notifications/cancelled"} and "id" not in message:
        return None
    if method == "ping":
        return _jsonrpc_result(request_id, {})
    if method == "initialize":
        return _jsonrpc_result(request_id, {
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": MCP_SERVER_NAME, "version": MCP_SERVER_VERSION},
            "instructions": "只读兼容网关：不提供设计、导出、写回、确认或远程副作用工具。",
        })
    if method == "tools/list":
        return _jsonrpc_result(request_id, {"tools": MCP_TOOL_DEFINITIONS})
    if method == "tools/call":
        try:
            call_params = _require_object(params)
            tool = call_params.get("name")
            if not isinstance(tool, str) or not tool.strip():
                raise MCPRequestError("tools/call 缺少 name。")
            result = _call_tool(tool.strip(), call_params.get("arguments") or {})
            text = json.dumps(result, ensure_ascii=False, sort_keys=True, default=str)
            return _jsonrpc_result(request_id, {
                "content": [{"type": "text", "text": text}],
                "structuredContent": result,
                "isError": False,
            })
        except MCPRequestError as exc:
            return _jsonrpc_error(request_id, -32602, str(exc))
        except RuntimeError as exc:
            return _jsonrpc_error(request_id, -32603, str(exc))
    return _jsonrpc_error(request_id, -32601, f"Method not found: {method}")


__all__ = [
    "MCP_MAX_REQUEST_BYTES",
    "MCP_TOOL_DEFINITIONS",
    "handle_mcp_jsonrpc",
]
