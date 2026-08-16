# TASK-019 Review 1

Status: accepted

## Review Result

Accepted after two correctness revisions.

- Context tools consume the exact TASK-018 `circular` and `featureSummary`
  snapshot shape, with legacy fields only as fallback.
- Circular wrapped selections use tail-plus-head reconstruction.
- Invalid, stale, mismatched, linear-wrap, and out-of-range selections are
  rejected instead of clamped.
- Open sequence, selection, features, and statistics are deterministic
  read-only tools with visible planning-stage traces.
- Full raw sequence bases are excluded from run logs and LLM summaries.
- The open vector is not treated as a cloning insert.

## Verification

- `python3 -m py_compile server.py tests/test_agent_sequence_context.py`
- `python3 -m unittest tests/test_agent_sequence_context.py` (`71` passed)
- `python3 tests/run_agent_harness.py` (`21` scenarios passed)
- Browser: `read_open_sequence`, `read_selected_region`, `list_features`, and
  `sequence_stats` all completed against the live pUC19 editor snapshot.
