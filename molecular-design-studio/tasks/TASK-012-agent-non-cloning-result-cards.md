# TASK-012: Agent Non-Cloning Result Cards

Status: accepted

Accepted review: `reviews/TASK-012-review-1.md`

## Objective

Show useful Agent result cards for RT-qPCR, sgRNA, siRNA, and point mutation
workspaces.

TASK-011 already lets the user select and route non-cloning Agent workspaces,
but the result display is still cloning-centric. This task should normalize and
render the existing backend result fields so the Agent feels like it actually
understands the selected molecular design mode.

## Context

The Python service already returns typed result rows. Do not change the Python
service. The desktop frontend should treat service responses as untrusted JSON
and normalize only display-safe scalar fields.

Known result shapes from the service:

- RT-qPCR rows may include:
  - `f`, `r`, `tm_f`, `tm_r`, `gc_f`, `gc_r`
  - `size`, `amplicon_gc`, `gdna`
  - optional `probe: { seq, tm, gc, start, end }`
  - `quality.tm_delta`
  - optional `conditions.anneal_c`
- sgRNA rows may include:
  - `seq`, `pam`, `score`, `gc`, `cut`
  - `guide_start`, `guide_end`, `template_length`, `direction`
  - `off`, `offtarget`, `repeat_risk`
- siRNA rows may include:
  - `sense`, `antisense`, `sense_duplex`, `antisense_duplex`
  - `target_seq`, `target_start`, `target_end`
  - `score`, `gc`, `seed_risk`, `repeat_risk`
  - `functional_region`, `shared_label`, `recommended_format`
- point mutation rows may include:
  - `mutation`, `f`, `r`, `tm_f`, `tm_r`, `gc_f`, `gc_r`, `length`
  - `binding_start`, `binding_end`, `mutation_start`, `mutation_end`
  - `quality.center_offset`, `quality.self_dimer`, `quality.hairpin_stem`
  - optional `conditions.anneal_c`

## Product Invariants

- The Agent never automatically executes a design.
- `Run molecular design` remains an explicit user action.
- Sequence edits still flow only through the existing preview/apply/reject path.
- No biological result fields should be invented client-side.
- Unknown or malformed service fields must be ignored safely.
- Cloning result cards and the copy primer order action must keep working.

## In Scope

- Extend the normalized `ResultCandidate` view model to support non-cloning
  display data.
- Normalize up to 3 candidates from `design.results`, using the response
  workspace and/or design type where available.
- Render the top candidate with:
  - title
  - summary
  - one or more sequence rows
  - compact metric chips
  - backup candidate count
- Keep the existing cloning primer table and `Copy primer order table` button
  for candidates that have forward/reverse primers.
- Add tests for realistic RT-qPCR, sgRNA, siRNA, and point mutation result
  shapes.
- Add component tests that prove non-cloning result rows are visible and the
  primer copy button does not appear for guide/siRNA-only results.

## Out of Scope

- Backend/Python changes.
- Running real biological algorithms in the frontend.
- Export/copy actions for non-cloning results.
- Streaming UI changes.
- OVE/editor/file-format changes.
- Tauri packaging changes.

## Allowed Files

- `src/agent/responseTypes.ts`
- `src/agent/responseTypes.test.ts`
- `src/components/AgentPanel.tsx`
- `src/components/AgentPanel.test.tsx`
- `src/App.css`
- `tasks/TASK-012-agent-non-cloning-result-cards.md`
- `reviews/TASK-012-review-1.md`

Do not modify:

- `src-tauri/**`
- `src/editor/**`
- `src/workspace/**`
- parent `../server.py`
- parent static demo files

## Required Implementation

1. Extend `ResultCandidate` without breaking existing cloning fields.
   - Keep all existing fields used by cloning and copy TSV.
   - Add optional normalized display fields, for example:
     - `workspace`
     - `sequenceRows: Array<{ label: string; value: string }>`
     - `metrics: string[]`
   - Use short, user-readable labels.

2. Make candidate normalization workspace-aware.
   - `normalizeResultCandidates` should accept a workspace/design type hint.
   - `normalizeAgentResponse` should pass `meta.workspace`, draft workspace,
     `design.designType`, or similar available hints.
   - Fall back safely when the hint is unknown.
   - Continue ignoring malformed array items.

3. Normalize display data for each workspace.
   - Cloning:
     - Preserve current behavior.
     - It is OK to also populate generic sequence rows/metrics as long as the
       current table and copy action still render.
   - RT-qPCR:
     - Title like `RT-qPCR candidate`.
     - Sequence rows for forward and reverse primers.
     - Include probe row when `probe.seq` exists.
     - Metrics should include useful values such as amplicon size, Tm delta,
       amplicon GC, gDNA check, anneal temperature.
   - sgRNA:
     - Sequence row for guide, optional PAM.
     - Metrics should include score, GC, cut site, direction, off-target risk,
       repeat risk when present.
   - siRNA:
     - Sequence rows for sense and antisense duplexes when present, otherwise
       sense/antisense.
     - Metrics should include score, GC, target position, seed risk, repeat risk,
       functional region, shared label, recommended format when present.
   - Point mutation:
     - Sequence rows for forward and reverse primers.
     - Title should include mutation when available.
     - Metrics should include primer length, Tm delta or Tm values, GC, binding
       region, center offset, self dimer, anneal temperature when present.

4. Update `CandidateCards`.
   - Render sequence rows for non-cloning candidates.
   - Keep the existing primer table/copy button only when a candidate should be
     orderable as a primer pair.
   - Avoid duplicate display if sequence rows and the primer table contain the
     same cloning primers.
   - Keep long sequences readable and non-overlapping in the sidebar.

5. Tests.
   - `normalizeAgentResponse` extracts RT-qPCR candidate rows.
   - `normalizeAgentResponse` extracts sgRNA guide rows and metrics.
   - `normalizeAgentResponse` extracts siRNA duplex rows and metrics.
   - `normalizeAgentResponse` extracts point mutation primer rows and metrics.
   - Existing cloning normalization tests still pass.
   - `AgentPanel` renders guide/siRNA style candidate rows.
   - `Copy primer order table` still appears for primer pair candidates and does
     not appear for guide-only candidates.

## Acceptance Criteria

- After an Agent run in any workspace, the result section shows meaningful
  design-specific details instead of only a generic count.
- Cloning result cards are not regressed.
- Long biological sequences wrap cleanly inside the Agent sidebar.
- Test coverage documents the supported result shapes.

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
- Confirm no backend, editor, workspace, or Tauri files changed.
- Confirm unknown fields are ignored rather than trusted.
- Confirm non-cloning candidates do not get cloning-only copy behavior unless
  they intentionally have a primer pair.
- Confirm failures and incomplete work are reported.

## Delivery Contract

Claude returns only the structured report requested by the orchestration
script. Keep paths and risk descriptions short; do not write a narrative
implementation summary.
