"""Execution budgets and loop guards for the local Molecular Design Agent."""
from __future__ import annotations

from typing import Any
import hashlib
import json
import os
import time


class GuardrailViolation(RuntimeError):
    """Raised before/after a tool when a Run must stop safely."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError:
        value = default
    return max(minimum, min(maximum, value))


def _float_env(name: str, default: float, minimum: float, maximum: float) -> float:
    try:
        value = float(os.environ.get(name, str(default)))
    except ValueError:
        value = default
    return max(minimum, min(maximum, value))


def _fingerprint(tool: str, args: Any, snapshot_hash: str) -> str:
    try:
        serialized = json.dumps(args or {}, ensure_ascii=False, sort_keys=True, default=str, separators=(",", ":"))
    except (TypeError, ValueError):
        serialized = repr(args)
    raw = f"{tool}\x00{snapshot_hash}\x00{serialized}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


class ExecutionGuard:
    """Per-Run guard with conservative, configurable limits.

    A normal molecular design run is only a few deterministic tools. The
    defaults leave room for a planner retry while stopping runaway resolve/
    verify loops before they consume remote quota or produce misleading UI.
    """

    REMOTE_TOOL_PREFIXES = ("resolve_", "check_", "fetch_", "blast", "ncbi")

    def __init__(
        self,
        *,
        max_tool_calls: int | None = None,
        max_remote_calls: int | None = None,
        max_wall_time_seconds: float | None = None,
        max_repeated_calls: int | None = None,
        max_consecutive_failures: int | None = None,
        clock: Any = time.monotonic,
    ) -> None:
        self.max_tool_calls = max_tool_calls if max_tool_calls is not None else _int_env("GENECODE_AGENT_MAX_TOOL_CALLS", 24, 1, 200)
        self.max_remote_calls = max_remote_calls if max_remote_calls is not None else _int_env("GENECODE_AGENT_MAX_REMOTE_CALLS", 8, 1, 100)
        self.max_wall_time_seconds = max_wall_time_seconds if max_wall_time_seconds is not None else _float_env("GENECODE_AGENT_MAX_WALL_TIME_SECONDS", 900.0, 1.0, 7_200.0)
        self.max_repeated_calls = max_repeated_calls if max_repeated_calls is not None else _int_env("GENECODE_AGENT_MAX_REPEATED_CALLS", 2, 1, 10)
        self.max_consecutive_failures = max_consecutive_failures if max_consecutive_failures is not None else _int_env("GENECODE_AGENT_MAX_CONSECUTIVE_FAILURES", 2, 1, 10)
        self.clock = clock
        self.started_at = float(clock())
        self.tool_calls = 0
        self.remote_calls = 0
        self.consecutive_failures = 0
        self.last_fingerprint: str | None = None
        self.last_tool: str | None = None
        self.repeated_calls = 0

    @property
    def elapsed_seconds(self) -> float:
        return max(0.0, float(self.clock()) - self.started_at)

    @classmethod
    def is_remote_tool(cls, tool: str) -> bool:
        normalized = tool.strip().lower()
        return normalized.startswith(cls.REMOTE_TOOL_PREFIXES)

    def before_tool(self, tool: str, args: Any = None, snapshot_hash: str = "") -> str:
        normalized = tool.strip()
        if self.elapsed_seconds >= self.max_wall_time_seconds:
            raise GuardrailViolation(
                "wall_time_exceeded",
                f"Agent 已运行 {self.elapsed_seconds:.0f} 秒，超过单次任务上限；已停止以避免后台任务失控。",
            )
        if self.tool_calls >= self.max_tool_calls:
            raise GuardrailViolation(
                "tool_budget_exceeded",
                f"Agent 工具调用已达到上限（{self.max_tool_calls} 次）；请检查输入或重新规划。",
            )
        if self.is_remote_tool(normalized):
            if self.remote_calls >= self.max_remote_calls:
                raise GuardrailViolation(
                    "remote_budget_exceeded",
                    f"远程解析/验证调用已达到上限（{self.max_remote_calls} 次）；请补充明确的 accession 或序列后重试。",
                )
            self.remote_calls += 1

        fingerprint = _fingerprint(normalized, args, snapshot_hash)
        if fingerprint == self.last_fingerprint:
            self.repeated_calls += 1
        else:
            self.last_fingerprint = fingerprint
            self.last_tool = normalized
            self.repeated_calls = 1
        if self.repeated_calls > self.max_repeated_calls:
            raise GuardrailViolation(
                "repeated_tool_call",
                f"Agent 连续重复调用「{normalized}」且参数未变化；已停止，请补充输入或调整约束。",
            )
        self.tool_calls += 1
        return fingerprint

    def after_tool(self, tool: str, status: str, summary: str = "") -> None:
        normalized_status = status.strip().lower()
        if normalized_status in {"failed", "error", "degraded"}:
            self.consecutive_failures += 1
        elif normalized_status in {"completed", "success", "done"}:
            self.consecutive_failures = 0
        if self.consecutive_failures >= self.max_consecutive_failures:
            detail = summary.strip()[:180]
            raise GuardrailViolation(
                "repeated_failure",
                f"Agent 连续 {self.consecutive_failures} 次工具失败，已停止自动重试。{detail}",
            )

    def snapshot(self) -> dict[str, Any]:
        return {
            "toolCalls": self.tool_calls,
            "remoteCalls": self.remote_calls,
            "elapsedSeconds": round(self.elapsed_seconds, 3),
            "maxToolCalls": self.max_tool_calls,
            "maxRemoteCalls": self.max_remote_calls,
            "maxWallTimeSeconds": self.max_wall_time_seconds,
            "maxRepeatedCalls": self.max_repeated_calls,
            "consecutiveFailures": self.consecutive_failures,
        }
