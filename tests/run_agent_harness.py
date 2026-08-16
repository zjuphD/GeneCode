#!/usr/bin/env python3
"""Deterministic release-gate harness for the GeneCode Design Agent.

The default direct transport calls server.py without a browser, network service,
or API key. The optional HTTP transport exercises the real local API routes.
Both transports validate routing, run safety, molecular-design invariants,
artifacts, and result provenance.
"""

from __future__ import annotations

import argparse
import copy
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import server  # noqa: E402


DEFAULT_CASES = ROOT / "tests" / "agent_cases.json"
DEFAULT_FIXTURES = ROOT / "tests" / "fixtures" / "offline_sequences.json"
DEFAULT_JSON_REPORT = ROOT / "tests" / "reports" / "agent-harness-report.json"
DEFAULT_HTML_REPORT = ROOT / "tests" / "reports" / "agent-harness-report.html"
DEFAULT_BASE_URL = "http://127.0.0.1:8000"

HARNESS_SCHEMA_VERSION = 3
ARTIFACT_CONTRACT_VERSION = "backend_artifact_package_v1"
REQUIRED_ARTIFACT_TYPES = {
    "candidate_table",
    "restriction_site_table",
    "risk_report",
    "protocol_draft",
    "ordering_table",
}
VALID_AGENT_STATUSES = {
    "created",
    "planning",
    "awaiting_input",
    "waiting_for_confirmation",
    "ready",
    "executing",
    "reviewing",
    "completed",
    "blocked",
    "failed",
    "cancelled",
    "stale",
}
VALID_CHECK_STATUSES = {"pass", "warning", "need-confirmation", "fail", "info"}
VALID_IUPAC = frozenset("ACGTRYSWKMBDHVN")
IUPAC_COMPLEMENT = str.maketrans(
    "ACGTRYSWKMBDHVN",
    "TGCAYRSWMKVHDBN",
)


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def clean_sequence(value: Any) -> str:
    return re.sub(r"[^A-Za-z]", "", str(value or "")).upper().replace("U", "T")


def reverse_complement(value: Any) -> str:
    return clean_sequence(value).translate(IUPAC_COMPLEMENT)[::-1]


def numeric(value: Any) -> float | None:
    try:
        if value in ("", None):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def deep_merge(base: Any, override: Any) -> Any:
    if isinstance(base, dict) and isinstance(override, dict):
        merged = copy.deepcopy(base)
        for key, value in override.items():
            merged[key] = deep_merge(merged.get(key), value)
        return merged
    return copy.deepcopy(override)


def resolve_fixtures(value: Any, fixtures: dict[str, Any]) -> Any:
    if isinstance(value, str) and value.startswith("$fixture:"):
        key = value.split(":", 1)[1]
        if key not in fixtures:
            raise KeyError(f"Unknown fixture: {key}")
        return fixtures[key]
    if isinstance(value, dict):
        return {key: resolve_fixtures(item, fixtures) for key, item in value.items()}
    if isinstance(value, list):
        return [resolve_fixtures(item, fixtures) for item in value]
    return value


def make_payload(case: dict[str, Any], defaults: dict[str, Any], fixtures: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "message": case.get("prompt", ""),
        "workspace": case.get("workspace", "auto"),
        "snapshot": resolve_fixtures(copy.deepcopy(case.get("snapshot", {})), fixtures),
        "history": resolve_fixtures(copy.deepcopy(case.get("history", [])), fixtures),
        "llm": copy.deepcopy(defaults.get("llm", {"enabled": False})),
    }
    if isinstance(case.get("llm"), dict):
        payload["llm"].update(case["llm"])
    # v2: pass runMode if specified in case
    if case.get("runMode"):
        payload["runMode"] = case["runMode"]
    for key in ("agentMode", "structuredInputs", "attachments", "planSnapshotHash"):
        if key in case:
            payload[key] = resolve_fixtures(copy.deepcopy(case[key]), fixtures)
    if case.get("requestId") == "$auto":
        payload["requestId"] = f"harness-{case.get('id')}-{time.time_ns()}"
    elif case.get("requestId"):
        payload["requestId"] = str(case["requestId"])
    return payload


def post_json(base_url: str, route: str, payload: dict[str, Any]) -> dict[str, Any]:
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}{route}",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body)
            detail = parsed.get("error") or parsed.get("message") or body
        except json.JSONDecodeError:
            detail = body
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Agent HTTP service unavailable: {exc.reason}") from exc
    parsed = json.loads(body)
    if not isinstance(parsed, dict):
        raise RuntimeError(f"Expected JSON object from {route}.")
    return parsed


def call_agent_chat(payload: dict[str, Any], transport: str, base_url: str) -> dict[str, Any]:
    if transport == "http":
        return post_json(base_url, "/api/agent/chat", payload)
    return server.agent_chat_response(payload)


def call_agent_execute(payload: dict[str, Any], transport: str, base_url: str) -> dict[str, Any]:
    if transport == "http":
        return post_json(base_url, "/api/agent/execute", payload)
    return server.agent_execute_response(payload)


def fetch_health(base_url: str) -> dict[str, Any]:
    try:
        with urllib.request.urlopen(f"{base_url.rstrip('/')}/api/health", timeout=5) as response:
            parsed = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Agent HTTP health check failed: {exc}") from exc
    if not isinstance(parsed, dict) or not parsed.get("ok"):
        raise RuntimeError(f"Agent HTTP health check failed: {parsed}")
    return parsed


def plan_tools(response: dict[str, Any]) -> list[str]:
    return [
        str(item.get("tool") or "")
        for item in response.get("plan") or []
        if isinstance(item, dict) and item.get("tool")
    ]


def design_results(execute_response: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not execute_response:
        return []
    design = execute_response.get("design") or {}
    results = design.get("results") if isinstance(design, dict) else []
    return [item for item in (results or []) if isinstance(item, dict)]


def agent_run(response: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(response, dict):
        return {}
    meta = response.get("meta") if isinstance(response.get("meta"), dict) else {}
    run = meta.get("agentRun") if isinstance(meta.get("agentRun"), dict) else {}
    return run


def final_review(response: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(response, dict):
        return {}
    meta = response.get("meta") if isinstance(response.get("meta"), dict) else {}
    review = meta.get("finalReview") if isinstance(meta.get("finalReview"), dict) else {}
    if not review:
        run = agent_run(response)
        review = run.get("finalReview") if isinstance(run.get("finalReview"), dict) else {}
    return review


def recommendation_package(response: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(response, dict):
        return {}
    meta = response.get("meta") if isinstance(response.get("meta"), dict) else {}
    package = meta.get("recommendationPackage") if isinstance(meta.get("recommendationPackage"), dict) else {}
    if not package:
        run = agent_run(response)
        package = run.get("recommendationPackage") if isinstance(run.get("recommendationPackage"), dict) else {}
    return package


def artifact_package(response: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(response, dict):
        return {}
    meta = response.get("meta") if isinstance(response.get("meta"), dict) else {}
    package = meta.get("artifactPackage") if isinstance(meta.get("artifactPackage"), dict) else {}
    if not package:
        run = agent_run(response)
        package = run.get("artifactPackage") if isinstance(run.get("artifactPackage"), dict) else {}
    return package


def add_check(
    checks: list[dict[str, Any]],
    name: str,
    ok: bool,
    detail: str = "",
    *,
    group: str = "contract",
    critical: bool = True,
) -> None:
    checks.append(
        {
            "name": name,
            "ok": bool(ok),
            "detail": detail,
            "group": group,
            "critical": critical,
        }
    )


def run_runtime_contract_case() -> dict[str, Any]:
    started = time.perf_counter()
    checks: list[dict[str, Any]] = []
    registry = server.AGENT_TOOL_REGISTRY
    policies = server.AGENT_MODE_POLICY

    add_check(checks, "tool registry is populated", len(registry) >= 10, f"{len(registry)} tool(s)", group="runtime")
    for name, descriptor in registry.items():
        required = {
            "workspace",
            "description",
            "risk",
            "riskLevel",
            "canAutoRun",
            "requiresConfirmation",
            "writes_sequence",
            "may_generate_patch",
            "output_type",
            "visualArtifactTypes",
        }
        missing = sorted(required - set(descriptor))
        add_check(
            checks,
            f"tool contract: {name}",
            not missing,
            "complete" if not missing else f"missing {', '.join(missing)}",
            group="runtime",
        )
        add_check(
            checks,
            f"tool cannot directly write: {name}",
            descriptor.get("writes_sequence") is False,
            f"writes_sequence={descriptor.get('writes_sequence')}",
            group="safety",
        )

    add_check(
        checks,
        "agent modes present",
        {"review", "plan", "auto"}.issubset(policies),
        ", ".join(sorted(policies)),
        group="runtime",
    )
    for mode, policy in policies.items():
        add_check(
            checks,
            f"{mode} mode blocks direct apply",
            policy.get("can_apply_patch") is False and "write" in (policy.get("blocked_risks") or []),
            f"can_apply_patch={policy.get('can_apply_patch')}, blocked={policy.get('blocked_risks')}",
            group="safety",
        )

    elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
    return {
        "id": "runtime_harness_contract",
        "name": "Runtime harness: tool, mode, and write-safety contract",
        "category": "runtime",
        "tags": ["contract", "safety"],
        "passed": all(item["ok"] for item in checks),
        "durationMs": elapsed_ms,
        "error": "",
        "checks": checks,
        "chat": {
            "workspace": "shared",
            "readyToExecute": None,
            "messages": [],
            "planTools": sorted(registry),
            "agentRunId": None,
            "agentRunStatus": None,
            "finalReview": None,
            "recommendation": None,
            "llm": None,
        },
        "execute": {
            "messages": [],
            "runLog": [],
            "agentRunId": None,
            "agentRunStatus": None,
            "observations": 0,
            "finalReview": None,
            "recommendation": None,
            "artifactStatus": None,
            "resultCount": 0,
        },
    }


def validate_agent_run_shape(
    response: dict[str, Any],
    expected_workspace: str,
    checks: list[dict[str, Any]],
    *,
    stage: str,
    expect_observations: bool = False,
) -> None:
    run = agent_run(response)
    run_id = str(run.get("runId") or "")
    status = str(run.get("status") or "")
    add_check(checks, f"{stage} agentRun present", run_id.startswith("run_"), run_id, group="runtime")
    add_check(checks, f"{stage} agentRun workspace", run.get("workspace") == expected_workspace, f"{run.get('workspace')} == {expected_workspace}")
    add_check(
        checks,
        f"{stage} agentRun status",
        status in VALID_AGENT_STATUSES,
        status,
        group="runtime",
    )

    steps = run.get("steps") if isinstance(run.get("steps"), list) else []
    if response.get("plan"):
        add_check(checks, f"{stage} agentRun steps", len(steps) == len(response.get("plan") or []), f"{len(steps)} == {len(response.get('plan') or [])}")
        tool_meta_count = sum(1 for item in steps if isinstance(item, dict) and isinstance(item.get("toolMeta"), dict))
        add_check(checks, f"{stage} tool metadata", tool_meta_count == len(steps), f"{tool_meta_count}/{len(steps)}")
        for step in steps:
            if not isinstance(step, dict):
                continue
            tool_name = str(step.get("tool") or "")
            descriptor = server.AGENT_TOOL_REGISTRY.get(tool_name)
            add_check(
                checks,
                f"{stage} registered tool: {tool_name or '-'}",
                bool(descriptor),
                tool_name or "missing tool",
                group="safety",
            )
            if descriptor:
                meta = step.get("toolMeta") if isinstance(step.get("toolMeta"), dict) else {}
                add_check(
                    checks,
                    f"{stage} tool risk contract: {tool_name}",
                    str(meta.get("riskLevel") or "") == str(descriptor.get("riskLevel") or ""),
                    f"{meta.get('riskLevel')} == {descriptor.get('riskLevel')}",
                    group="safety",
                )
                add_check(
                    checks,
                    f"{stage} no direct sequence write: {tool_name}",
                    descriptor.get("writes_sequence") is False,
                    f"writes_sequence={descriptor.get('writes_sequence')}",
                    group="safety",
                )

    review = final_review(response)
    add_check(checks, f"{stage} final review", bool(review.get("overall") and isinstance(review.get("checks"), list)), str(review.get("overall") or ""))
    review_checks = review.get("checks") if isinstance(review.get("checks"), list) else []
    invalid_review_statuses = sorted(
        {
            str(item.get("status") or "")
            for item in review_checks
            if isinstance(item, dict) and str(item.get("status") or "") not in VALID_CHECK_STATUSES
        }
    )
    add_check(
        checks,
        f"{stage} review status contract",
        not invalid_review_statuses,
        "valid" if not invalid_review_statuses else ", ".join(invalid_review_statuses),
        group="review",
    )

    observations = run.get("observations") if isinstance(run.get("observations"), list) else []
    timeline = run.get("timeline") if isinstance(run.get("timeline"), list) else []
    add_check(checks, f"{stage} timeline", len(timeline) >= len(observations), f"{len(timeline)} event(s), {len(observations)} observation(s)")
    if expect_observations:
        add_check(checks, f"{stage} observations", len(observations) > 0, f"{len(observations)} observation(s)")
        tool_events = [item for item in timeline if isinstance(item, dict) and item.get("kind") == "tool_call"]
        add_check(checks, f"{stage} tool timeline", len(tool_events) >= len(observations), f"{len(tool_events)} tool event(s)")


def validate_oligo(
    value: Any,
    label: str,
    checks: list[dict[str, Any]],
    *,
    min_length: int = 18,
    max_length: int = 120,
) -> str:
    sequence = clean_sequence(value)
    invalid = sorted(set(sequence) - VALID_IUPAC)
    add_check(
        checks,
        f"{label} sequence alphabet",
        bool(sequence) and not invalid,
        f"{len(sequence)} nt" if not invalid else f"invalid: {''.join(invalid)}",
        group="biology",
    )
    add_check(
        checks,
        f"{label} sequence length",
        min_length <= len(sequence) <= max_length,
        f"{len(sequence)} nt in {min_length}-{max_length}",
        group="biology",
    )
    return sequence


def validate_primer_row(
    row: dict[str, Any],
    template: str,
    checks: list[dict[str, Any]],
    label: str,
) -> None:
    forward = validate_oligo(row.get("f"), f"{label} forward primer", checks)
    reverse = validate_oligo(row.get("r"), f"{label} reverse primer", checks)
    forward_core = clean_sequence(row.get("forward_core"))
    reverse_core = clean_sequence(row.get("reverse_core"))
    forward_tail = clean_sequence(row.get("forward_tail"))
    reverse_tail = clean_sequence(row.get("reverse_tail"))

    if forward_core:
        add_check(
            checks,
            f"{label} forward architecture",
            forward == forward_tail + forward_core,
            f"tail {len(forward_tail)} + core {len(forward_core)} = {len(forward)}",
            group="biology",
        )
    if reverse_core:
        add_check(
            checks,
            f"{label} reverse architecture",
            reverse == reverse_tail + reverse_core,
            f"tail {len(reverse_tail)} + core {len(reverse_core)} = {len(reverse)}",
            group="biology",
        )

    template_sequence = clean_sequence(template)
    if template_sequence and forward_core:
        add_check(
            checks,
            f"{label} forward core binds template",
            template_sequence.startswith(forward_core),
            forward_core[:24],
            group="biology",
        )
    if template_sequence and reverse_core:
        expected_reverse = reverse_complement(template_sequence[-len(reverse_core):])
        add_check(
            checks,
            f"{label} reverse core binds template",
            reverse_core == expected_reverse,
            f"{reverse_core[:18]} == {expected_reverse[:18]}",
            group="biology",
        )

    for field, sequence in (("forward", forward), ("reverse", reverse)):
        declared = row.get(f"full_length_{'f' if field == 'forward' else 'r'}")
        if declared is not None:
            add_check(
                checks,
                f"{label} {field} declared length",
                int(declared) == len(sequence),
                f"{declared} == {len(sequence)}",
                group="contract",
            )

    tm_f = numeric(row.get("tm_f"))
    tm_r = numeric(row.get("tm_r"))
    gc_f = numeric(row.get("gc_f"))
    gc_r = numeric(row.get("gc_r"))
    add_check(
        checks,
        f"{label} core Tm range",
        tm_f is not None and tm_r is not None and 45 <= tm_f <= 75 and 45 <= tm_r <= 75,
        f"{tm_f} / {tm_r} C",
        group="biology",
    )
    add_check(
        checks,
        f"{label} core GC range",
        gc_f is not None and gc_r is not None and 20 <= gc_f <= 80 and 20 <= gc_r <= 80,
        f"{gc_f}% / {gc_r}%",
        group="biology",
    )

    binding_target_length = int(row.get("binding_target_length") or len(template_sequence) or 0)
    for suffix, core in (("f", forward_core), ("r", reverse_core)):
        start = row.get(f"binding_start_{suffix}")
        end = row.get(f"binding_end_{suffix}")
        if start is None or end is None or not core:
            continue
        start_i = int(start)
        end_i = int(end)
        add_check(
            checks,
            f"{label} {suffix} coordinate contract",
            0 <= start_i < end_i <= binding_target_length and end_i - start_i == len(core),
            f"[{start_i}, {end_i}) of {binding_target_length}; core {len(core)}",
            group="biology",
        )


def validate_construct_review(
    top: dict[str, Any],
    method: str,
    fragment_count: int,
    checks: list[dict[str, Any]],
) -> None:
    review = top.get("construct_review") if isinstance(top.get("construct_review"), dict) else {}
    add_check(
        checks,
        "cloning construct review present",
        bool(review),
        str(review.get("summary") or ""),
        group="review",
    )
    if not review:
        return
    add_check(
        checks,
        "cloning construct review method",
        str(review.get("method") or "") == method,
        f"{review.get('method')} == {method}",
        group="review",
    )
    junctions = review.get("junctions") if isinstance(review.get("junctions"), list) else []
    expected_junctions = fragment_count + 1 if fragment_count > 1 else 2
    add_check(
        checks,
        "cloning junction count",
        len(junctions) == expected_junctions,
        f"{len(junctions)} == {expected_junctions}",
        group="biology",
    )
    review_checks = review.get("checks") if isinstance(review.get("checks"), list) else []
    invalid_statuses = sorted(
        {
            str(item.get("status") or "")
            for item in review_checks
            if isinstance(item, dict) and str(item.get("status") or "") not in {"passed", "review", "blocked", "warning"}
        }
    )
    add_check(
        checks,
        "cloning review check statuses",
        not invalid_statuses,
        "valid" if not invalid_statuses else ", ".join(invalid_statuses),
        group="review",
    )


def validate_cloning_biology(
    top: dict[str, Any],
    design_payload: dict[str, Any],
    checks: list[dict[str, Any]],
) -> None:
    method = str(top.get("method") or design_payload.get("method") or "")
    fragments = design_payload.get("fragments") if isinstance(design_payload.get("fragments"), list) else []
    fragments = [item for item in fragments if isinstance(item, dict) and clean_sequence(item.get("sequence"))]
    if not fragments:
        fragments = [{"name": design_payload.get("label") or "Insert", "sequence": design_payload.get("sequence") or ""}]
    fragment_count = len(fragments)
    primer_rows = top.get("fragment_primers") if isinstance(top.get("fragment_primers"), list) else []

    add_check(
        checks,
        "cloning supported method",
        method in {"gibson", "restriction", "golden_gate"},
        method,
        group="biology",
    )
    add_check(
        checks,
        "cloning insert length",
        int(top.get("insert_length") or 0) == sum(len(clean_sequence(item.get("sequence"))) for item in fragments),
        f"{top.get('insert_length')} bp across {fragment_count} fragment(s)",
        group="biology",
    )

    if fragment_count > 1:
        add_check(
            checks,
            "multi-fragment primer set count",
            len(primer_rows) == fragment_count,
            f"{len(primer_rows)} == {fragment_count}",
            group="biology",
        )
        for index, fragment in enumerate(fragments):
            if index >= len(primer_rows) or not isinstance(primer_rows[index], dict):
                continue
            validate_primer_row(
                primer_rows[index],
                str(fragment.get("sequence") or ""),
                checks,
                f"fragment {index + 1}",
            )
    else:
        validate_primer_row(top, str(fragments[0].get("sequence") or ""), checks, "cloning")

    if method == "gibson":
        left = clean_sequence(design_payload.get("leftHomology"))
        right = clean_sequence(design_payload.get("rightHomology"))
        rows = primer_rows if primer_rows else [top]
        if left and rows:
            add_check(
                checks,
                "Gibson left vector overlap",
                clean_sequence(rows[0].get("forward_tail")) == left,
                left,
                group="biology",
            )
        if right and rows:
            add_check(
                checks,
                "Gibson right vector overlap",
                clean_sequence(rows[-1].get("reverse_tail")) == reverse_complement(right),
                right,
                group="biology",
            )
        if len(rows) > 1:
            homology_length = int(design_payload.get("homologyLength") or len(left) or 20)
            for index in range(len(rows) - 1):
                current_sequence = clean_sequence(fragments[index].get("sequence"))
                next_sequence = clean_sequence(fragments[index + 1].get("sequence"))
                current_row = rows[index]
                next_row = rows[index + 1]
                add_check(
                    checks,
                    f"Gibson junction {index + 1} reverse overlap",
                    clean_sequence(current_row.get("reverse_tail")) == reverse_complement(next_sequence[:homology_length]),
                    f"uses next fragment first {homology_length} bp",
                    group="biology",
                )
                add_check(
                    checks,
                    f"Gibson junction {index + 1} forward overlap",
                    clean_sequence(next_row.get("forward_tail")) == current_sequence[-homology_length:],
                    f"uses previous fragment last {homology_length} bp",
                    group="biology",
                )

    elif method == "restriction":
        forward_site = clean_sequence(top.get("forward_site") or "")
        reverse_site = clean_sequence(top.get("reverse_site") or "")
        add_check(
            checks,
            "restriction sites embedded in primers",
            bool(forward_site and reverse_site)
            and forward_site in clean_sequence(top.get("forward_tail"))
            and reverse_site in clean_sequence(top.get("reverse_tail")),
            f"{forward_site} / {reverse_site}",
            group="biology",
        )
        assessment = top.get("restriction_pair_assessment") if isinstance(top.get("restriction_pair_assessment"), dict) else {}
        add_check(
            checks,
            "restriction pair is directional and insert-safe",
            assessment.get("directionality") == "Directional"
            and assessment.get("insert_safe_both") is True,
            f"{assessment.get('directionality')}; insert_safe={assessment.get('insert_safe_both')}",
            group="biology",
        )

    elif method == "golden_gate":
        type_iis_site = clean_sequence(top.get("type_iis_site"))
        expected_overhangs = [
            clean_sequence(design_payload.get("leftOverhang")),
            *[
                clean_sequence(item)
                for item in (
                    design_payload.get("fragmentOverhangs")
                    or design_payload.get("junctionOverhangs")
                    or []
                )
            ],
            clean_sequence(design_payload.get("rightOverhang")),
        ]
        expected_overhangs = [item for item in expected_overhangs if item]
        actual_overhangs = top.get("overhangs") if isinstance(top.get("overhangs"), list) else [
            top.get("left_overhang"),
            top.get("right_overhang"),
        ]
        actual_overhangs = [clean_sequence(item) for item in actual_overhangs if clean_sequence(item)]
        add_check(
            checks,
            "Golden Gate overhang order",
            actual_overhangs == expected_overhangs,
            f"{actual_overhangs} == {expected_overhangs}",
            group="biology",
        )
        add_check(
            checks,
            "Golden Gate overhang directionality",
            bool(expected_overhangs)
            and all(len(item) == int(top.get("type_iis_overhang_length") or 4) for item in expected_overhangs)
            and len(set(expected_overhangs)) == len(expected_overhangs),
            ", ".join(expected_overhangs),
            group="biology",
        )
        rows = primer_rows if primer_rows else [top]
        tails = [
            clean_sequence(row.get(key))
            for row in rows
            if isinstance(row, dict)
            for key in ("forward_tail", "reverse_tail")
        ]
        add_check(
            checks,
            "Golden Gate Type IIS site in every primer tail",
            bool(type_iis_site) and bool(tails) and all(type_iis_site in tail for tail in tails),
            f"{type_iis_site} across {len(tails)} tail(s)",
            group="biology",
        )
        review = top.get("construct_review") if isinstance(top.get("construct_review"), dict) else {}
        internal_check = next(
            (
                item
                for item in (review.get("checks") or [])
                if isinstance(item, dict) and item.get("key") == "type_iis_internal_sites"
            ),
            None,
        )
        add_check(
            checks,
            "Golden Gate internal Type IIS scan",
            isinstance(internal_check, dict) and internal_check.get("status") == "passed",
            str((internal_check or {}).get("detail") or ""),
            group="biology",
        )

    validate_construct_review(top, method, fragment_count, checks)


def validate_result_shape(
    workspace: str,
    results: list[dict[str, Any]],
    expect: dict[str, Any],
    checks: list[dict[str, Any]],
    *,
    design_payload: dict[str, Any] | None = None,
) -> None:
    min_results = int(expect.get("minResults") or 0)
    if min_results:
        add_check(checks, "result count", len(results) >= min_results, f"{len(results)} >= {min_results}")
    if not results:
        return

    top = results[0]
    if workspace == "rtqpcr":
        size = int(top.get("size") or 0)
        result_checks = expect.get("resultChecks") or {}
        min_size = int(result_checks.get("ampliconMin") or 70)
        max_size = int(result_checks.get("ampliconMax") or 200)
        add_check(checks, "rt primer pair", bool(top.get("f") and top.get("r")), "forward/reverse present")
        add_check(checks, "rt amplicon size", min_size <= size <= max_size, f"{size} bp in {min_size}-{max_size}")
        validate_oligo(top.get("f"), "RT-qPCR forward primer", checks, max_length=60)
        validate_oligo(top.get("r"), "RT-qPCR reverse primer", checks, max_length=60)
        tm_f = numeric(top.get("tm_f"))
        tm_r = numeric(top.get("tm_r"))
        gc_f = numeric(top.get("gc_f"))
        gc_r = numeric(top.get("gc_r"))
        add_check(
            checks,
            "RT-qPCR primer thermodynamics",
            tm_f is not None and tm_r is not None and abs(tm_f - tm_r) <= 3
            and gc_f is not None and gc_r is not None
            and 30 <= gc_f <= 70 and 30 <= gc_r <= 70,
            f"Tm {tm_f}/{tm_r}; GC {gc_f}/{gc_r}",
            group="biology",
        )
    elif workspace == "sgrna":
        add_check(checks, "sgRNA guide", bool(top.get("seq") and top.get("pam")), "guide/PAM present")
        add_check(checks, "sgRNA score", top.get("score") is not None, f"score={top.get('score')}")
        guide = clean_sequence(top.get("seq"))
        pam = clean_sequence(top.get("pam"))
        score = numeric(top.get("score"))
        add_check(checks, "sgRNA guide length", len(guide) == 20, f"{len(guide)} nt", group="biology")
        add_check(
            checks,
            "sgRNA PAM contract",
            len(pam) >= 2 and set(pam) <= VALID_IUPAC,
            pam,
            group="biology",
        )
        add_check(
            checks,
            "sgRNA score range",
            score is not None and 0 <= score <= 100,
            str(score),
            group="biology",
        )
    elif workspace == "sirna":
        add_check(checks, "siRNA duplex", bool(top.get("sense") and top.get("antisense")), "sense/antisense present")
        add_check(checks, "siRNA risk", bool(top.get("seed_risk")), f"seed={top.get('seed_risk')}")
        sense = clean_sequence(top.get("sense"))
        antisense = clean_sequence(top.get("antisense"))
        add_check(
            checks,
            "siRNA duplex length",
            len(sense) in {19, 21} and len(antisense) in {19, 21},
            f"{len(sense)} / {len(antisense)} nt",
            group="biology",
        )
    elif workspace == "cloning":
        add_check(checks, "cloning primers", bool(top.get("f") and top.get("r")), "forward/reverse present")
        add_check(checks, "cloning method", bool(top.get("method")), f"method={top.get('method')}")
        validate_cloning_biology(top, design_payload or {}, checks)
    elif workspace == "mutagenesis":
        add_check(checks, "mutation primers", bool(top.get("f") and top.get("r")), "forward/reverse present")
        add_check(checks, "mutation label", bool(top.get("mutation") or top.get("amino_acid_mutation")), str(top.get("mutation") or top.get("amino_acid_mutation") or ""))
        validate_oligo(top.get("f"), "mutagenesis forward primer", checks, min_length=20, max_length=80)
        validate_oligo(top.get("r"), "mutagenesis reverse primer", checks, min_length=20, max_length=80)


def validate_recommendation_package(
    response: dict[str, Any],
    workspace: str,
    checks: list[dict[str, Any]],
    *,
    expect_failure: bool = False,
) -> None:
    package = recommendation_package(response)
    add_check(checks, "recommendation package", bool(package), str(package.get("source") or ""))
    if not package:
        return
    add_check(checks, "recommendation workspace", package.get("workspace") == workspace, f"{package.get('workspace')} == {workspace}")
    recommendation = package.get("recommendation") if isinstance(package.get("recommendation"), dict) else {}
    alternative = package.get("alternative") if isinstance(package.get("alternative"), dict) else {}
    risk = package.get("risk") if isinstance(package.get("risk"), dict) else {}
    metrics = package.get("keyMetrics") if isinstance(package.get("keyMetrics"), list) else []
    confidence = package.get("confidence") if isinstance(package.get("confidence"), dict) else {}
    add_check(checks, "recommendation title", bool(recommendation.get("title")), str(recommendation.get("title") or ""))
    add_check(checks, "alternative summary", bool(alternative.get("summary")), str(alternative.get("summary") or ""))
    add_check(checks, "risk items", bool(risk.get("items")), str(risk.get("items") or ""))
    add_check(checks, "key metrics", len(metrics) > 0, f"{len(metrics)} metric(s)")
    add_check(checks, "confidence score", isinstance(confidence.get("score"), int), str(confidence.get("score") or ""))
    if expect_failure:
        add_check(checks, "recommendation failed status", package.get("status") == "fail", str(package.get("status") or ""))


def validate_artifact_package(
    response: dict[str, Any],
    workspace: str,
    checks: list[dict[str, Any]],
    *,
    expect_failure: bool = False,
) -> None:
    package = artifact_package(response)
    add_check(checks, "artifact package", bool(package), str(package.get("source") or ""))
    if not package:
        return
    artifacts = package.get("artifacts") if isinstance(package.get("artifacts"), list) else []
    summary = str(package.get("summaryMarkdown") or "")
    add_check(checks, "artifact workspace", package.get("workspace") == workspace, f"{package.get('workspace')} == {workspace}")
    add_check(
        checks,
        "artifact contract version",
        package.get("source") == ARTIFACT_CONTRACT_VERSION,
        str(package.get("source") or ""),
        group="artifact",
    )
    add_check(checks, "artifact count", len(artifacts) >= 5, f"{len(artifacts)} artifact(s)", group="artifact")
    add_check(checks, "artifact summary", "推荐方案" in summary and "Final Review" in summary, summary[:180])
    seen_types = {str(item.get("type") or "") for item in artifacts if isinstance(item, dict)}
    add_check(
        checks,
        "artifact types",
        REQUIRED_ARTIFACT_TYPES.issubset(seen_types),
        ", ".join(sorted(seen_types)),
        group="artifact",
    )
    artifact_ids = [
        str(item.get("artifact_id") or "")
        for item in artifacts
        if isinstance(item, dict)
    ]
    add_check(
        checks,
        "artifact ids are unique",
        all(artifact_ids) and len(set(artifact_ids)) == len(artifact_ids),
        f"{len(set(artifact_ids))}/{len(artifact_ids)} unique",
        group="artifact",
    )
    artifacts_by_type = {
        str(item.get("type") or ""): item
        for item in artifacts
        if isinstance(item, dict)
    }
    for artifact_type in REQUIRED_ARTIFACT_TYPES:
        artifact = artifacts_by_type.get(artifact_type)
        add_check(
            checks,
            f"artifact payload: {artifact_type}",
            bool(
                artifact
                and artifact.get("title")
                and artifact.get("filename")
                and isinstance(artifact.get("data"), dict)
            ),
            str((artifact or {}).get("filename") or "missing"),
            group="artifact",
        )
    if expect_failure:
        add_check(checks, "artifact failed status", package.get("status") == "failed", str(package.get("status") or ""))
    else:
        add_check(checks, "artifact available status", package.get("status") == "available", str(package.get("status") or ""))
        candidate_data = (artifacts_by_type.get("candidate_table") or {}).get("data") or {}
        ordering_data = (artifacts_by_type.get("ordering_table") or {}).get("data") or {}
        risk_data = (artifacts_by_type.get("risk_report") or {}).get("data") or {}
        protocol_data = (artifacts_by_type.get("protocol_draft") or {}).get("data") or {}
        add_check(
            checks,
            "candidate artifact has rows",
            bool(candidate_data.get("candidates")),
            f"{len(candidate_data.get('candidates') or [])} row(s)",
            group="artifact",
        )
        add_check(
            checks,
            "ordering artifact has rows",
            bool(ordering_data.get("items")),
            f"{len(ordering_data.get('items') or [])} row(s)",
            group="artifact",
        )
        add_check(
            checks,
            "risk artifact has review checks",
            bool(risk_data.get("checks")),
            f"{len(risk_data.get('checks') or [])} check(s)",
            group="artifact",
        )
        add_check(
            checks,
            "protocol artifact has summary",
            "Final Review" in str(protocol_data.get("summaryMarkdown") or ""),
            str(protocol_data.get("summaryMarkdown") or "")[:120],
            group="artifact",
        )


def add_contains_checks(
    checks: list[dict[str, Any]],
    name: str,
    haystack: str,
    needles: list[Any],
) -> None:
    lowered = haystack.lower()
    for needle in [str(item).lower() for item in needles]:
        add_check(checks, f"{name}: {needle}", needle in lowered, haystack[:260])


def run_case(
    case: dict[str, Any],
    defaults: dict[str, Any],
    fixtures: dict[str, Any],
    *,
    transport: str = "direct",
    base_url: str = DEFAULT_BASE_URL,
) -> dict[str, Any]:
    started = time.perf_counter()
    checks: list[dict[str, Any]] = []
    payload = make_payload(case, defaults, fixtures)
    expect = case.get("expect") or {}
    execute_response: dict[str, Any] | None = None
    error = ""

    try:
        chat_response = call_agent_chat(payload, transport, base_url)
        meta = chat_response.get("meta") or {}
        workspace = str(meta.get("workspace") or "")
        ready = bool(meta.get("readyToExecute"))
        tools = plan_tools(chat_response)

        expected_workspace = expect.get("workspace")
        if expected_workspace:
            add_check(checks, "workspace", workspace == expected_workspace, f"{workspace} == {expected_workspace}")
            validate_agent_run_shape(chat_response, expected_workspace, checks, stage="chat")

        if "readyToExecute" in expect:
            add_check(checks, "readyToExecute", ready == bool(expect["readyToExecute"]), f"{ready} == {bool(expect['readyToExecute'])}")

        # v2: runMode checks
        expected_run_mode = expect.get("runMode")
        if expected_run_mode:
            actual_run_mode = str(meta.get("runMode") or "")
            add_check(checks, "runMode", actual_run_mode == expected_run_mode, f"{actual_run_mode} == {expected_run_mode}")

        if "usedRewrite" in expect:
            llm_meta = meta.get("llm") or {}
            actual_rewrite = bool(llm_meta.get("usedRewrite"))
            add_check(checks, "usedRewrite", actual_rewrite == bool(expect["usedRewrite"]), f"{actual_rewrite} == {bool(expect['usedRewrite'])}")

        if "finalReviewContains" in expect:
            fr = final_review(chat_response)
            fr_checks = fr.get("checks") or []
            fr_labels = " ".join(str(c.get("label") or "") + " " + str(c.get("note") or "") for c in fr_checks).lower()
            for needle in expect["finalReviewContains"]:
                add_check(checks, f"finalReview contains: {needle}", needle.lower() in fr_labels, fr_labels[:200])

        if "chatErrorContains" in expect and not error:
            # If we expected a chat error but didn't get one, that's a failure
            pass  # handled in the except block below

        # v2: autoExecute flag check
        if "autoExecute" in expect:
            actual_auto = bool(meta.get("autoExecute"))
            add_check(checks, "autoExecute", actual_auto == bool(expect["autoExecute"]), f"{actual_auto} == {bool(expect['autoExecute'])}")

        expected_method = expect.get("recommendedMethod")
        if expected_method:
            method = str(meta.get("recommendedMethod") or ((meta.get("draft") or {}).get("mode") if isinstance(meta.get("draft"), dict) else ""))
            add_check(checks, "recommended method", method == expected_method, f"{method} == {expected_method}")

        for tool in expect.get("tools") or []:
            add_check(checks, f"planned tool: {tool}", tool in tools, ", ".join(tools) or "-")

        missing_needles = [str(item).lower() for item in expect.get("missingContains") or []]
        if missing_needles:
            missing_text = " ".join(str(item) for item in (meta.get("missingInputs") or []) + (chat_response.get("messages") or [])).lower()
            for needle in missing_needles:
                add_check(checks, f"missing mentions: {needle}", needle in missing_text, missing_text[:220])

        should_execute = bool(expect.get("execute"))
        expected_execute_errors = expect.get("executeErrorContains") or []
        if should_execute:
            add_check(checks, "can execute", ready, "chat produced executable draft")
            if ready:
                chat_run_id = str(agent_run(chat_response).get("runId") or "")
                execute_payload = {
                    **payload,
                    "runId": chat_run_id,
                    "workspace": workspace,
                    "draft": meta.get("draft"),
                    "plan": chat_response.get("plan") or [],
                }
                execute_overrides = resolve_fixtures(
                    copy.deepcopy(case.get("executeOverrides", {})),
                    fixtures,
                )
                if execute_overrides:
                    execute_payload = deep_merge(execute_payload, execute_overrides)
                try:
                    execute_response = call_agent_execute(execute_payload, transport, base_url)
                    if expected_execute_errors:
                        execution_error = (execute_response.get("meta") or {}).get("executionError") if isinstance(execute_response, dict) else {}
                        error_text = " ".join(
                            [
                                str((execution_error or {}).get("message") or ""),
                                str((execution_error or {}).get("tool") or ""),
                                " ".join(str(item) for item in execute_response.get("messages") or []) if isinstance(execute_response, dict) else "",
                            ]
                        )
                        add_check(checks, "structured execute error", bool(execution_error), error_text)
                        add_contains_checks(checks, "execute error contains", error_text, expected_execute_errors)
                        validate_agent_run_shape(execute_response, workspace, checks, stage="execute", expect_observations=True)
                        add_check(checks, "failed agent status", agent_run(execute_response).get("status") == "failed", str(agent_run(execute_response).get("status") or ""))
                        add_check(checks, "failed final review", final_review(execute_response).get("overall") == "fail", str(final_review(execute_response).get("overall") or ""))
                        validate_recommendation_package(execute_response, workspace, checks, expect_failure=True)
                        validate_artifact_package(execute_response, workspace, checks, expect_failure=True)
                    else:
                        validate_agent_run_shape(execute_response, workspace, checks, stage="execute", expect_observations=True)
                        execute_run_id = str(agent_run(execute_response).get("runId") or "")
                        add_check(checks, "run continuity", bool(chat_run_id and execute_run_id and chat_run_id == execute_run_id), f"{chat_run_id} -> {execute_run_id}")
                        results = design_results(execute_response)
                        draft = meta.get("draft") if isinstance(meta.get("draft"), dict) else {}
                        design_payload = draft.get("designPayload") if isinstance(draft.get("designPayload"), dict) else {}
                        validate_result_shape(
                            workspace,
                            results,
                            expect,
                            checks,
                            design_payload=design_payload,
                        )
                        validate_recommendation_package(execute_response, workspace, checks)
                        validate_artifact_package(execute_response, workspace, checks)
                        # v2: runLogContains check
                        run_log_needles = expect.get("runLogContains") or []
                        if run_log_needles:
                            run_log_text = " ".join(
                                str(item.get("step") or "") + " " + str(item.get("message") or "")
                                for item in (execute_response.get("runLog") or [])
                                if isinstance(item, dict)
                            )
                            for needle in run_log_needles:
                                add_check(checks, f"runLog contains: {needle}", needle in run_log_text, run_log_text[:200])
                        repeat_error_needles = expect.get("repeatExecuteErrorContains") or []
                        if repeat_error_needles:
                            repeat_error = ""
                            try:
                                call_agent_execute(execute_payload, transport, base_url)
                            except Exception as exc:  # noqa: BLE001 - expected idempotency rejection
                                repeat_error = f"{type(exc).__name__}: {exc}"
                            add_check(
                                checks,
                                "duplicate execute rejected",
                                bool(repeat_error),
                                repeat_error[:220],
                                group="safety",
                            )
                            add_contains_checks(
                                checks,
                                "repeat execute error contains",
                                repeat_error,
                                repeat_error_needles,
                            )
                except Exception as exc:  # noqa: BLE001 - expected failures are part of the harness
                    execute_error = f"{type(exc).__name__}: {exc}"
                    if expected_execute_errors:
                        add_contains_checks(checks, "execute error contains", execute_error, expected_execute_errors)
                    else:
                        raise
        elif expect.get("execute") is False:
            add_check(checks, "does not execute", not ready, "case is expected to stop before execution")

    except Exception as exc:  # noqa: BLE001 - harness should report every failure
        chat_response = {}
        error = f"{type(exc).__name__}: {exc}"
        expected_chat_errors = expect.get("chatErrorContains") or []
        if expected_chat_errors:
            add_contains_checks(checks, "chat error contains", error, expected_chat_errors)
        else:
            add_check(checks, "unexpected exception", False, error)

    elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
    passed = all(item["ok"] for item in checks)
    return {
        "id": case.get("id"),
        "name": case.get("name") or case.get("id"),
        "category": case.get("category") or expect.get("workspace") or "agent",
        "tags": case.get("tags") or [],
        "passed": passed,
        "durationMs": elapsed_ms,
        "error": error,
        "checks": checks,
        "chat": {
            "workspace": (chat_response.get("meta") or {}).get("workspace") if isinstance(chat_response, dict) else None,
            "readyToExecute": (chat_response.get("meta") or {}).get("readyToExecute") if isinstance(chat_response, dict) else None,
            "messages": chat_response.get("messages", []) if isinstance(chat_response, dict) else [],
            "planTools": plan_tools(chat_response) if isinstance(chat_response, dict) else [],
            "agentRunId": agent_run(chat_response).get("runId") if isinstance(chat_response, dict) else None,
            "agentRunStatus": agent_run(chat_response).get("status") if isinstance(chat_response, dict) else None,
            "finalReview": final_review(chat_response).get("overall") if isinstance(chat_response, dict) else None,
            "recommendation": recommendation_package(chat_response).get("recommendation", {}).get("title") if isinstance(chat_response, dict) else None,
            "llm": (chat_response.get("meta") or {}).get("llm") if isinstance(chat_response, dict) else None,
        },
        "execute": {
            "messages": execute_response.get("messages", []) if execute_response else [],
            "runLog": execute_response.get("runLog", []) if execute_response else [],
            "agentRunId": agent_run(execute_response).get("runId") if execute_response else None,
            "agentRunStatus": agent_run(execute_response).get("status") if execute_response else None,
            "observations": len(agent_run(execute_response).get("observations") or []) if execute_response else 0,
            "finalReview": final_review(execute_response).get("overall") if execute_response else None,
            "recommendation": recommendation_package(execute_response).get("recommendation", {}).get("title") if execute_response else None,
            "artifactStatus": artifact_package(execute_response).get("status") if execute_response else None,
            "resultCount": len(design_results(execute_response)),
        },
    }


def render_html_report(report: dict[str, Any]) -> str:
    rows: list[str] = []
    for case in report["cases"]:
        status = "PASS" if case["passed"] else "FAIL"
        check_items = "".join(
            f"<li class=\"{'ok' if check['ok'] else 'bad'}\"><strong>{html.escape(check['name'])}</strong> "
            f"<em>{html.escape(str(check.get('group') or 'contract'))}</em> "
            f"<span>{html.escape(str(check.get('detail') or ''))}</span></li>"
            for check in case["checks"]
        )
        messages = "<br>".join(html.escape(str(item)) for item in case["chat"].get("messages") or [])
        tools = ", ".join(html.escape(str(item)) for item in case["chat"].get("planTools") or []) or "-"
        tags = " ".join(f"<span class=\"tag\">{html.escape(str(item))}</span>" for item in case.get("tags") or [])
        rows.append(
            f"""
            <section class="case {'passed' if case['passed'] else 'failed'}">
              <div class="case-head">
                <div>
                  <div class="case-id">{html.escape(str(case.get('category') or 'agent'))} · {html.escape(str(case['id']))}</div>
                  <h2>{html.escape(str(case['name']))}</h2>
                  <div class="tags">{tags}</div>
                </div>
                <span class="badge">{status}</span>
              </div>
              <div class="meta">
                <span>workspace: {html.escape(str(case['chat'].get('workspace')))}</span>
                <span>ready: {html.escape(str(case['chat'].get('readyToExecute')))}</span>
                <span>results: {case['execute'].get('resultCount', 0)}</span>
                <span>{case['durationMs']} ms</span>
              </div>
              <div class="tools">tools: {tools}</div>
              <div class="messages">{messages}</div>
              <ul>{check_items}</ul>
              {f"<pre>{html.escape(case['error'])}</pre>" if case.get('error') else ""}
            </section>
            """
        )
    groups = "".join(
        (
            f"<span class=\"group {'ok' if group['failed'] == 0 else 'bad'}\">"
            f"{html.escape(name)}: {group['passed']}/{group['total']}</span>"
        )
        for name, group in sorted((report.get("groups") or {}).items())
    )
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>Agent Harness Report</title>
  <style>
    body {{ margin: 0; padding: 40px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f5f7fb; color: #122033; }}
    header {{ max-width: 1100px; margin: 0 auto 24px; }}
    h1 {{ margin: 0 0 8px; font-size: 32px; }}
    .summary {{ color: #526074; }}
    .groups {{ display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }}
    .group {{ padding: 6px 10px; border-radius: 6px; background: #dcfce7; color: #166534; font-size: 12px; font-weight: 700; }}
    .group.bad {{ background: #fee2e2; color: #991b1b; }}
    main {{ max-width: 1100px; margin: 0 auto; display: grid; gap: 16px; }}
    .case {{ background: #fff; border: 1px solid #dfe7f1; border-radius: 8px; padding: 20px; box-shadow: 0 12px 32px rgba(18, 32, 51, 0.06); }}
    .case.failed {{ border-color: #fecaca; box-shadow: 0 18px 45px rgba(127, 29, 29, 0.08); }}
    .case-head {{ display: flex; justify-content: space-between; gap: 16px; align-items: start; }}
    .case-id {{ font-size: 12px; color: #64748b; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }}
    h2 {{ margin: 4px 0 0; font-size: 20px; }}
    .tags {{ min-height: 18px; margin-top: 8px; display: flex; gap: 6px; }}
    .tag {{ color: #526074; background: #eef2f7; border-radius: 4px; padding: 3px 6px; font-size: 11px; }}
    .badge {{ border-radius: 999px; padding: 7px 12px; font-size: 12px; font-weight: 800; background: #dcfce7; color: #166534; }}
    .failed .badge {{ background: #fee2e2; color: #991b1b; }}
    .meta {{ display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0 8px; }}
    .meta span, .tools {{ background: #f1f5f9; border-radius: 999px; padding: 7px 10px; color: #475569; font-size: 13px; }}
    .tools {{ display: inline-block; border-radius: 12px; margin-bottom: 10px; }}
    .messages {{ color: #334155; line-height: 1.65; margin: 8px 0 12px; }}
    ul {{ margin: 0; padding-left: 20px; display: grid; gap: 6px; }}
    li.ok {{ color: #166534; }}
    li.bad {{ color: #991b1b; }}
    li em {{ color: #64748b; font-style: normal; font-size: 11px; border: 1px solid #d7e0eb; border-radius: 4px; padding: 1px 4px; margin-left: 5px; }}
    li span {{ color: #64748b; margin-left: 6px; }}
    pre {{ white-space: pre-wrap; background: #fff1f2; color: #991b1b; padding: 12px; border-radius: 12px; }}
  </style>
</head>
<body>
  <header>
    <h1>GeneCode Agent Harness v{report['schemaVersion']}</h1>
    <div class="summary">{report['passed']}/{report['total']} passed · {html.escape(report['transport'])} transport · {report['checks']['passed']}/{report['checks']['total']} checks · generated at {html.escape(report['generatedAt'])}</div>
    <div class="groups">{groups}</div>
  </header>
  <main>
    {''.join(rows)}
  </main>
</body>
</html>
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="Run GeneCode Agent release-gate harness cases.")
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    parser.add_argument("--fixtures", type=Path, default=DEFAULT_FIXTURES)
    parser.add_argument("--json", type=Path, default=DEFAULT_JSON_REPORT)
    parser.add_argument("--html", type=Path, default=DEFAULT_HTML_REPORT)
    parser.add_argument("--case", action="append", dest="case_ids", help="Run only the selected case id. Can be repeated.")
    parser.add_argument(
        "--transport",
        choices=("direct", "http"),
        default="direct",
        help="Call server.py directly or exercise the live local HTTP API.",
    )
    parser.add_argument(
        "--base-url",
        default=os.environ.get("GENECODE_AGENT_BASE_URL", DEFAULT_BASE_URL),
        help="Base URL used by --transport http.",
    )
    args = parser.parse_args()

    cases_doc = load_json(args.cases)
    fixtures = load_json(args.fixtures)
    defaults = cases_doc.get("defaults") or {}
    cases = cases_doc.get("cases") or []
    if args.case_ids:
        selected = set(args.case_ids)
        cases = [case for case in cases if case.get("id") in selected]
    if not cases:
        raise SystemExit("No harness cases selected.")

    health: dict[str, Any] | None = None
    if args.transport == "http":
        health = fetch_health(args.base_url)

    results: list[dict[str, Any]] = []
    if not args.case_ids:
        results.append(run_runtime_contract_case())
    results.extend(
        run_case(
            case,
            defaults,
            fixtures,
            transport=args.transport,
            base_url=args.base_url,
        )
        for case in cases
    )
    passed = sum(1 for item in results if item["passed"])
    all_checks = [
        check
        for result in results
        for check in result.get("checks") or []
        if isinstance(check, dict)
    ]
    check_passed = sum(1 for check in all_checks if check.get("ok"))
    groups: dict[str, dict[str, int]] = {}
    for item in results:
        category = str(item.get("category") or "agent")
        group = groups.setdefault(category, {"total": 0, "passed": 0, "failed": 0})
        group["total"] += 1
        if item["passed"]:
            group["passed"] += 1
        else:
            group["failed"] += 1
    report = {
        "schemaVersion": HARNESS_SCHEMA_VERSION,
        "caseDocumentVersion": cases_doc.get("version"),
        "artifactContractVersion": ARTIFACT_CONTRACT_VERSION,
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "transport": args.transport,
        "baseUrl": args.base_url if args.transport == "http" else None,
        "health": health,
        "gatePassed": passed == len(results),
        "total": len(results),
        "passed": passed,
        "failed": len(results) - passed,
        "checks": {
            "total": len(all_checks),
            "passed": check_passed,
            "failed": len(all_checks) - check_passed,
        },
        "groups": groups,
        "cases": results,
    }

    args.json.parent.mkdir(parents=True, exist_ok=True)
    args.html.parent.mkdir(parents=True, exist_ok=True)
    args.json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    args.html.write_text(render_html_report(report), encoding="utf-8")

    for item in results:
        status = "PASS" if item["passed"] else "FAIL"
        print(f"{status} {item['id']} ({item['durationMs']} ms)")
        if not item["passed"]:
            for check in item["checks"]:
                if not check["ok"]:
                    print(f"  - [{check.get('group') or 'contract'}] {check['name']}: {check.get('detail') or ''}")
    print(
        f"\nGate: {'PASS' if report['gatePassed'] else 'FAIL'} · "
        f"{passed}/{len(results)} cases · {check_passed}/{len(all_checks)} checks · "
        f"{args.transport} transport"
    )
    print(f"\nReport JSON: {args.json}")
    print(f"Report HTML: {args.html}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
