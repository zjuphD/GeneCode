# TASK-009: Agent Result Cards and Primer Table

Status: accepted

Accepted review: `reviews/TASK-009-review-1.md`

## Objective

Make executed Agent results look like a usable molecular cloning design output,
not just a recommendation title and candidate count.

After `Run molecular design`, the panel should summarize the top tool-generated
candidate, show primer sequences and key metrics when available, expose risk
items clearly, and keep all sequence edits behind the existing preview/apply
boundary.

## Context

TASK-008 made the sidebar visibly feel like a Cloning Agent workbench. However,
the result UI still loses most deterministic tool output because
`src/agent/responseTypes.ts` only keeps `resultCount`.

The Python cloning engine can return candidate fields such as:

- `f`, `r`
- `tm_f`, `tm_r`
- `gc_f`, `gc_r`
- `insert_length`
- `full_length_f`, `full_length_r`
- `quality.tm_delta`
- `quality.cross_dimer`
- `conditions.anneal_c`
- `conditions.extension_sec`

The UI must normalize these fields conservatively from unknown JSON and ignore
malformed or unfamiliar shapes.

## Product Invariants

- No automatic design execution.
- No automatic sequence patch application.
- TASK-005 preview/apply/reject remains the only sequence edit path.
- Raw service JSON is untrusted and must cross a runtime normalization boundary.
- Do not invent biological values in the client.
- Do not change the Python service or deterministic design algorithms.

## In Scope

- Normalized result candidate view model in `src/agent/responseTypes.ts`
- Agent session state carrying normalized candidates
- Agent result UI showing:
  - top candidate summary
  - forward/reverse primer sequences when present
  - Tm and GC metrics when present
  - optional annealing/extension conditions when present
  - candidate count and confidence/risk context
- Focused tests for normalization, session state, and component rendering
- Styling for compact right-panel readability

## Out of Scope

- changing parent `../server.py`
- changing request payloads or Agent API routes
- adding export/download behavior
- persistent result history
- sequence patch generation in the client
- OVE/editor/file-format changes
- Tauri lifecycle changes

## Allowed Files

- `src/agent/responseTypes.ts`
- `src/agent/responseTypes.test.ts`
- `src/agent/useAgentSession.ts`
- `src/agent/useAgentSession.test.ts`
- `src/components/AgentPanel.tsx`
- `src/components/AgentPanel.test.tsx`
- `src/App.css`
- `tasks/TASK-009-agent-result-cards.md`
- `reviews/TASK-009-review-1.md`

Do not modify:

- `src-tauri/**`
- `src/agent/service.ts`
- `src/workspace/**`
- OVE/editor/file-format modules
- parent-directory files

## Required Implementation

1. Add a normalized result candidate model.
   - Keep at most the top three candidates.
   - Preserve only display-safe scalar values.
   - Prefer `design.results` as the source.
   - Ignore malformed candidates without failing the whole response.

2. Support cloning primer fields.
   - Normalize forward primer from `f`.
   - Normalize reverse primer from `r`.
   - Normalize `tm_f`, `tm_r`, `gc_f`, `gc_r`.
   - Normalize `full_length_f`, `full_length_r`.
   - Normalize `insert_length`.
   - Normalize `quality.tm_delta` and `quality.cross_dimer`.
   - Normalize `conditions.anneal_c` and `conditions.extension_sec`.

3. Keep the model generic enough for non-cloning results.
   - Include an optional `title` and `summary`.
   - Do not hard-code that every result has primers.
   - Continue to show candidate count even when candidate details are absent.

4. Update Agent session state.
   - Store normalized candidates from plan/execute responses.
   - Clear candidates when draft/plan/results are invalidated.

5. Update result presentation.
   - Show a compact top candidate card under `Recommended design`.
   - Show a primer pair table when forward/reverse primers exist.
   - Show metrics as small chips/rows.
   - Show risk/confidence from the recommendation package without duplicating
     raw JSON.
   - Keep long primer sequences wrapping safely inside the panel.

6. Testing.
   - Add normalization tests for realistic cloning candidate fields.
   - Add tests that malformed result items are ignored.
   - Add session tests proving candidates are stored after execution and
     cleared on invalidation.
   - Add component tests proving primer table and metrics render.

## Acceptance Criteria

- A realistic execute response with `design.results[0].f/r/tm/gc/quality` renders
  a visible primer pair and key metrics in the Agent panel.
- Candidate count still renders when candidate details are missing.
- Malformed result candidates do not crash normalization or rendering.
- Context invalidation clears stale candidate details.
- Existing chat, explicit execution, patch preview, and revert tests still pass.
- The panel remains usable in compact viewport.

## Verification Commands

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

## Self-Review Checklist

- Check every acceptance criterion once after the final edit.
- Confirm all changed files are allowed by this task.
- Confirm no client-side biological values were invented.
- Confirm no patch safety behavior was weakened.
- Confirm failures and incomplete work are reported, not hidden.

## Delivery Contract

Claude returns only the structured report requested by the orchestration
script. Keep paths and risk descriptions short; do not write a narrative
implementation summary.
