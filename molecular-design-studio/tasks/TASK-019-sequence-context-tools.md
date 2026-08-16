# TASK-019: Sequence Context Tools

Status: accepted

Accepted review: `reviews/TASK-019-review-1.md`

## Objective

Add deterministic, read-only Agent tools that consume the editor context sent
by TASK-018. The local Agent must actually inspect the open sequence and
selection, expose truthful tool activity, and answer simple context questions
without treating the open vector as a missing cloning insert.

This task is implemented from the parent Primer Design Studio directory because
the local Agent service lives outside the desktop repository.

## Product Invariants

- Deterministic Python functions are the source of truth for sequence context.
- Context tools are read-only, low-risk, auto-runnable, and require no
  confirmation.
- The open document remains vector/editor context, never an implicit insert.
- The selected region remains context unless the user explicitly asks a later
  workflow to use it as a target/input.
- Raw full-length sequences must not be inserted into the LLM summary or
  ordinary task-stream messages.
- Invalid snapshot data must degrade to explicit no-document/no-selection
  results, never fabricated values.

## In Scope

- Four backend context tools: open sequence, selected region, features, stats.
- Snapshot validation and deterministic result builders.
- Compact LLM snapshot metadata for document/selection awareness.
- Planning-stage context tool trace in `plan` and `runLog`.
- Direct, concise responses to simple questions about the current document,
  selection, annotations, length, topology, and GC percentage.
- Focused direct-function regression tests.

## Out of Scope

- Frontend changes.
- Sequence editing or patches.
- Automatically using an open vector as cloning insert.
- New design algorithms or third-party dependencies.
- Sending complete raw sequence text to the LLM.
- Cloud services or persistence.

## Allowed Files

- `server.py`
- `tests/test_agent_sequence_context.py`

Do not modify the desktop repository or existing harness/case files.

## Required Implementation

1. Register four tools in `AGENT_TOOL_REGISTRY`.
   - `read_open_sequence`
   - `read_selected_region`
   - `list_features`
   - `sequence_stats`
   - All use workspace `shared`, risk `low`, `canAutoRun: True`, and
     `requiresConfirmation: False`.

2. Validate editor context defensively.
   - Read `snapshot.currentSequenceDocument` and
     `snapshot.currentSelection` only when they are dictionaries of the
     expected shape.
   - Sanitize sequence bases with existing sequence utilities.
   - Validate canonical zero-based half-open coordinates and selected length.
   - Never trust a client-provided GC percentage or feature count.
   - No document/selection is a normal explicit result, not an exception.

3. Implement deterministic read-only tool functions.
   - `read_open_sequence`: name, sanitized length, circular/linear topology,
     accession/version when available.
   - `read_selected_region`: canonical coordinates, one-based display range,
     length, wraps-origin flag, and exact selected sequence from the validated
     snapshot. Do not echo bases in the run-log message.
   - `list_features`: normalized feature summaries and selected-overlap count
     where a valid selection exists. Handle circular wrapped overlap.
   - `sequence_stats`: length, GC percentage, GC count, ambiguous-base count,
     topology, and whether stats describe document or selection. Compute values
     on the server.

4. Execute context tools during planning.
   - When a valid document exists, run `read_open_sequence`, `list_features`,
     and `sequence_stats` before returning an Agent chat response.
   - Run `read_selected_region` when a valid selection exists.
   - Prepend completed plan and run-log rows to the normal workflow response.
   - Keep run-log messages compact: document name/length/topology, annotation
     count, selected range/length, and GC summary only.
   - Include structured context outputs under a stable response metadata key
     so future UI layers can consume them.
   - Do not mark unavailable context as completed.

5. Answer direct context questions.
   - Recognize conservative Chinese/English requests about the current/open
     sequence, selected region, annotations/features, length/topology, or GC.
   - Return a context-only response without creating a molecular-design draft.
   - Use computed context outputs and concise Chinese messages.
   - Do not print a full document sequence. Do not print selected bases unless
     the request explicitly asks for the selected sequence and the selection is
     short enough for a normal response; otherwise report coordinates/length.

6. Improve LLM context safely.
   - Add document name, length, topology, accession/version, feature count,
     and selection coordinates/length/wrap metadata to
     `summarize_agent_snapshot_for_llm`.
   - Do not include raw document or selected sequence bases.

7. Preserve normal workflows.
   - Existing cloning/RT-qPCR/sgRNA/siRNA/mutagenesis routing and readiness
     remain unchanged after context rows are prepended.
   - Context rows must be attached before Agent-run metadata is derived so the
     task trace remains internally consistent.
   - Existing response normalization fields remain valid.

8. Add direct-function tests.
   - Open sequence metadata and server-computed length.
   - GC and ambiguous-base statistics.
   - Valid selection and no-selection behavior.
   - Circular wrapped feature overlap.
   - LLM summary contains metadata but no raw sequence.
   - Direct context question returns no executable draft.
   - Normal cloning planning retains its original design plan after context
     rows and does not use vector sequence as insert.

## Acceptance Criteria

- A chat request carrying the open pUC19 snapshot returns completed context
  tool rows based on the actual sequence.
- With an OVE selection, the response reports its exact range and computed
  statistics without displaying raw bases in normal tool activity.
- Asking “当前序列 GC 是多少” returns a computed answer and no design draft.
- Asking for a cloning design still requires a real insert when missing.
- No raw full sequence appears in the LLM snapshot summary.
- Existing Agent harness cases continue to pass.

## Verification Commands

```bash
python3 -m unittest tests/test_agent_sequence_context.py
python3 tests/run_agent_harness.py
python3 -m py_compile server.py tests/test_agent_sequence_context.py
```

## Self-Review Checklist

- Confirm only allowed files changed.
- Confirm all sequence statistics are recomputed server-side.
- Confirm normal tool logs never contain raw bases.
- Confirm LLM summary contains metadata only.
- Confirm vector sequence is not mapped to insert sequence.
- Confirm existing workflow plan rows and readiness survive decoration.
- Report failures rather than hiding them.

## Delivery Contract

Claude returns only a compact implementation report with changed files,
verification commands, blockers, and residual risks. Do not commit.
