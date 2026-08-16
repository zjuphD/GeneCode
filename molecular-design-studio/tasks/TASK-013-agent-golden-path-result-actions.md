# TASK-013: Agent Golden Path Result Actions

Status: accepted

Accepted review: `reviews/TASK-013-review-1.md`

## Objective

Turn the current Agent prototype into a more usable golden-path workflow after a
tool run completes.

The Agent can already route workspaces and render design-specific result cards,
but the user still cannot reliably take the next practical step for non-cloning
results. This task should make the result area feel actionable: copy a clean
result table, copy a concise run note, and preserve the existing primer-order
flow.

## Context

Recent accepted tasks:

- TASK-011 added workspace routing for cloning, RT-qPCR, sgRNA, siRNA, and
  mutagenesis.
- TASK-012 added normalized candidate rows and metrics for non-cloning results.
- The UI was then simplified so mode selection remains explicit while starter
  prompts are lightweight examples rather than a wall of feature buttons.

The current result card still has one strong action only:

- `Copy primer order table` for primer-pair candidates.

Non-cloning results such as sgRNA and siRNA are visible but not yet directly
copyable in a clean table. That makes the demo feel incomplete.

## Product Invariants

- The Agent never automatically executes a design.
- `Run molecular design` remains an explicit user action.
- Sequence edits still flow only through the existing preview/apply/reject path.
- Do not invent biological sequences or coordinates client-side.
- Unknown or malformed service fields must be ignored safely.
- The existing primer-order copy action must keep working.

## In Scope

- Add a generic copy action for normalized non-cloning result cards.
- Add a concise copyable run note or result summary when an Agent run has
  recommendation/results metadata.
- Keep the copy payload deterministic and table-like:
  - title
  - sequence rows
  - metrics
  - optional recommendation summary
  - optional run id/status
- Preserve the existing `Copy primer order table` button for primer pairs.
- Avoid making every feature a standalone button; actions should be tied to the
  result card or run summary.
- Improve empty/after-run result language only if it helps the golden path.
- Tests for copy payloads, feedback states, and button visibility.

## Out of Scope

- Backend/Python changes.
- Real biological algorithm changes.
- Exporting files to disk.
- Printing/PDF/report generation.
- Streaming chat.
- OVE/editor/file-format changes.
- Tauri packaging changes.
- Multi-candidate comparison UI beyond existing backup count.

## Allowed Files

- `src/components/AgentPanel.tsx`
- `src/components/AgentPanel.test.tsx`
- `src/App.css`
- `tasks/TASK-013-agent-golden-path-result-actions.md`
- `reviews/TASK-013-review-1.md`

Do not modify:

- `src/agent/service.ts`
- `src/agent/useAgentSession.ts`
- `src/agent/responseTypes.ts`
- `src-tauri/**`
- `src/editor/**`
- `src/workspace/**`
- parent `../server.py`
- parent static demo files

## Required Implementation

1. Add reusable clipboard feedback behavior where appropriate.
   - Avoid duplicating timer cleanup logic if possible.
   - Keep feedback compact: `Copied` / `Copy failed`.

2. Keep primer-pair behavior intact.
   - If the top candidate has forward or reverse primer sequences, continue to
     show `Copy primer order table`.
   - The TSV payload should remain compatible with the current tests.

3. Add non-cloning result copy.
   - If the top candidate has no primer pair but has normalized `sequenceRows`
     and/or `metrics`, show a compact action such as `Copy result table`.
   - The copied text should be deterministic TSV or line-oriented text.
   - Include sequence rows and metrics.
   - Do not show this action when there is no meaningful candidate data.

4. Add run note copy.
   - When the result area has recommendation and/or candidate/run metadata, show
     an action such as `Copy run note`.
   - Include recommendation title/summary/risks/confidence when present.
   - Include top candidate title and metrics when present.
   - Include run id/status when present.
   - Do not duplicate the full primer-order table inside the run note.

5. Keep the UI compact.
   - Result actions should be visually grouped under the result card or result
     summary.
   - Do not add top-level buttons for every workspace feature.
   - Long copied-result labels must not overflow the 320px sidebar.

6. Tests.
   - Existing primer-order copy tests still pass.
   - Guide-only sgRNA candidate shows `Copy result table` and does not show
     `Copy primer order table`.
   - siRNA candidate copy payload includes duplex rows and metrics.
   - Primer-pair candidate does not show the generic non-cloning copy action.
   - `Copy run note` includes recommendation, top candidate, metrics, and run
     metadata.
   - Clipboard unavailable/failure feedback still works for the new actions.

## Acceptance Criteria

- A user can complete a result-oriented golden path from Agent run output to a
  copied, usable table or run note.
- Existing cloning primer-order behavior is not regressed.
- Non-cloning results have an obvious next action without adding workspace-level
  feature buttons.
- Tests document the copy behavior and failure states.

## Verification Commands

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

## Self-Review Checklist

- Confirm changed files are within the allowed list.
- Confirm no backend, service, hook, editor, workspace, or Tauri files changed.
- Confirm copy payloads are deterministic and do not trust unknown fields.
- Confirm primer-order copy still works.
- Confirm non-cloning copy only appears when useful.
- Confirm failures and incomplete work are reported.

## Delivery Contract

Claude returns only the structured report requested by the orchestration
script. Keep paths and risk descriptions short; do not write a narrative
implementation summary.
