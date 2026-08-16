#!/usr/bin/env python3
"""GeneCode local agent backend entry point.

A-MAINT-001: this file used to be a 17,219-line monolith. The implementation now
lives in the `server_pkg` package (config / schemas / bio / providers / agent /
api); this shim re-exports the entire module namespace so `import server` and
`python server.py` behave exactly as before.

Section map (original line ranges -> module):
  27-366, 408-428, 1184-1264, 2532-2741        -> server_pkg.config
  277-295, 586-587, 1085-1120                  -> server_pkg.schemas
  327-431, 432-583, 1123-1181, 1267-4091,      -> server_pkg.bio
  4094-7893 (bio design/cloning)
  197-239, 590-1081                           -> server_pkg.providers
  7896-16811                                  -> server_pkg.agent
  16814-17215                                 -> server_pkg.api
"""
from __future__ import annotations

from server_pkg.schemas import *  # noqa: F401,F403
from server_pkg.schemas import _to_zbho  # noqa: F401

from server_pkg.config import *  # noqa: F401,F403
from server_pkg.config import _CACHE, _CACHE_LOCK, _CANCELLED_RUNS_TTL, _DB_CONN, _LAST_REQUEST_AT, _LLM_SEMAPHORE, _REMOTE_DIAGNOSTICS, _REQUEST_LOCK, _cancelled_runs, _cancelled_runs_lock, _cleanup_cancelled_runs, _cleanup_stale_entries, _clear_cancelled_flag, _is_run_cancelled  # noqa: F401

from server_pkg.bio import *  # noqa: F401,F403
from server_pkg.bio import _NN_DELTA_H, _NN_DELTA_S, _assess_arm_pair, _cloning_context_after, _cloning_context_before, _cloning_review_status, _hairpin_delta_g  # noqa: F401

from server_pkg.providers import *  # noqa: F401,F403
from server_pkg.providers import _agent_llm_completion_inner  # noqa: F401

from server_pkg.agent import *  # noqa: F401,F403
from server_pkg.agent import _LLM_NEUTRALIZATIONS, _LLM_PLAN_STEP_LABELS, _REQUEST_IDEMPOTENCY_TTL, _RUN_ACTIVE_TTL, _RUN_RECORDS_TTL, _TOOLS_REQUIRING_CONFIRMATION, _active_runs, _active_runs_lock, _agent_auto_verify, _append_run_tool_event, _build_candidate_artifact_data, _build_next_actions, _build_ordering_data, _build_required_user_checks, _build_restriction_artifact_data, _build_risk_artifact_data, _build_risk_items_from_checks, _cancel_run, _cleanup_run_records, _compact_step_args, _confirmation_key_for_tool, _context_ambiguous_count, _context_feature_spans, _context_gc_percent, _context_sanitize_bases, _context_selection_overlap_count, _context_snapshot_document, _context_snapshot_selection, _context_strict_int, _create_run_record, _event_counter, _event_counter_lock, _event_display_summary, _extract_assumptions, _extract_known_params, _extract_warnings, _generate_execute_snapshot_hash, _get_run_record, _inject_sse_metadata, _invalidate_run, _is_blocker, _llm_plan_step_label, _next_event_id, _plan_steps_have_cycle, _record_event, _register_active_run, _replan_after_failure, _request_id_lock, _request_id_store, _require_llm_scalar, _require_llm_step_confirmation, _resolve_llm_step_ref, _review_confidence_score, _run_planning_context_tools, _run_records, _run_records_lock, _set_run_execute_hash, _sse_encode, _step_result_summary, _suggest_fix_for_check, _unregister_active_run, _update_run_status, _validate_confirmations, _validate_request_idempotency, _validate_snapshot_version  # noqa: F401

from server_pkg.api import *  # noqa: F401,F403

# A-MAINT-001: monkeypatch bridge. The unit tests patch server attributes
# (patch.object(server, "agent_llm_config", ...) etc.). After the split the
# internal callers resolve those names in their own server_pkg module globals,
# so a plain shim attribute would be invisible to them. This bridge forwards
# every setattr/delattr on this module to every module whose globals bind the
# name (the owner plus any module that imported it), keeping the 99 test patch
# sites working unchanged.
import sys as _sys
import types as _types
import server_pkg.schemas as _m_schemas
import server_pkg.config as _m_config
import server_pkg.bio as _m_bio
import server_pkg.providers as _m_providers
import server_pkg.agent as _m_agent
import server_pkg.api as _m_api
_MODULES = (_m_schemas, _m_config, _m_bio, _m_providers, _m_agent, _m_api)
_PATCH_TARGETS: dict[str, list] = {}
for _m in _MODULES:
    for _n in list(_m.__dict__):
        if not _n.startswith("__"):
            _PATCH_TARGETS.setdefault(_n, []).append(_m)

class _ServerShim(_types.ModuleType):
    def __setattr__(self, name, value):
        super().__setattr__(name, value)
        for _m in _PATCH_TARGETS.get(name, ()):
            _m.__dict__[name] = value

    def __delattr__(self, name):
        super().__delattr__(name)
        for _m in _PATCH_TARGETS.get(name, ()):
            _m.__dict__.pop(name, None)

_sys.modules[__name__].__class__ = _ServerShim

if __name__ == "__main__":
    main()
