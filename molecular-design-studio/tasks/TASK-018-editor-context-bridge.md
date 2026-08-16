# TASK-018: Editor Context Bridge

Status: accepted

Accepted review: `reviews/TASK-018-review-3.md`

## Objective

Connect the live OVE editor context to the Agent. The Agent request snapshot
must contain the currently open sequence document and the current OVE sequence
selection, while the Agent task stream must show which context will be used.

This task is the frontend half of the sequence-context tool layer. A separate
backend task will consume the new snapshot and execute read-only tools.

## Product Invariants

- The canonical sequence model remains independent of OVE internals.
- Canonical coordinates are zero-based half-open intervals.
- OVE selection coordinates are zero-based inclusive and must be converted at
  one tested boundary.
- A circular selection may wrap the sequence origin.
- The open document is vector/editor context. It must never silently become a
  cloning insert or another missing biological input.
- Every Agent request uses the latest document and selection at send/execute
  time.
- Do not display full raw sequences in the task stream.
- Sequence changes still require the existing structured preview/apply flow.

## In Scope

- Add a canonical sequence-selection type and pure OVE conversion helper.
- Subscribe to OVE `onSelectionOrCaretChanged`.
- Store the current selection in the shared workspace.
- Clear stale selections when the document changes, is opened, committed,
  patched, reverted, or remounted.
- Pass selection from App through AgentPanel into Agent requests.
- Extend `AgentSnapshot` with structured current-selection context.
- Preserve planning-stage `runLog` returned by the backend.
- Show selected range and length in the Agent Context node.
- Add focused tests for conversion, state, snapshot, request routing, and UI.

## Out of Scope

- Python/backend changes.
- New biological design algorithms.
- Sending the full sequence to an LLM prompt.
- Upload/paste/project-picker UI.
- Editing sequence from the Agent without patch review.
- Layout or palette redesign.

## Allowed Files

- `src/types/index.ts`
- `src/editor/selection.ts`
- `src/editor/selection.test.ts`
- `src/types/ambient.d.ts`
- `src/components/OveEditorHost.tsx`
- `src/components/OveEditorHost.test.tsx`
- `src/components/Editor.tsx`
- `src/components/Editor.test.tsx`
- `src/workspace/useWorkspace.ts`
- `src/workspace/useWorkspace.test.ts`
- `src/App.tsx`
- `src/agent/service.ts`
- `src/agent/service.test.ts`
- `src/agent/useAgentSession.ts`
- `src/agent/useAgentSession.test.ts`
- `src/components/AgentPanel.tsx`
- `src/components/AgentPanel.test.tsx`
- `tasks/TASK-018-editor-context-bridge.md`
- `reviews/TASK-018-review-1.md`

Do not modify parent `../server.py` in this task.

## Required Implementation

1. Add a canonical selection model.
   - Use a small explicit type with `start`, `end`, `length`, `wrapsOrigin`,
     and selected `sequence`.
   - `start` and `end` are zero-based half-open canonical coordinates.
   - Represent no selection as `null`.

2. Add a pure OVE conversion helper.
   - Accept unknown/raw selection-layer input plus the current document.
   - Return `null` for caret-only, missing, invalid, empty-document, or out of
     range selections.
   - Convert OVE's inclusive end to canonical exclusive end.
   - Preserve selection direction semantics needed for a circular origin wrap.
   - Extract the exact selected sequence.
   - For circular `start > end`, concatenate tail plus head and mark
     `wrapsOrigin: true`.
   - Do not duplicate coordinate math inside React components.

3. Subscribe to OVE selection changes.
   - Add a typed `onSelectionChange` prop to `OveEditorHost`.
   - Pass `onSelectionOrCaretChanged` to `createVectorEditor`.
   - Convert only the sequence selection layer; a caret event clears selection.
   - Keep the callback current without remounting OVE on every render.

4. Store selection in the workspace.
   - Add `selection` state and an `onSelectionChange` action.
   - Clear selection whenever a new document identity/version is established:
     initial set, file open, OVE commit, remount, patch apply, and revert.
   - Selection changes alone must not mark the sequence document dirty.

5. Carry the latest context through the app.
   - Wire Editor to workspace selection changes.
   - Pass selection to AgentPanel.
   - Add `currentSelection` to `AgentSnapshot`; use `null` when absent.
   - Include one-based display coordinates only in UI text. Keep request
     coordinates canonical.
   - Update both planning and execution request paths to use the current
     selection, including empty-document snapshots.

6. Preserve read-only context tool traces.
   - `applyPlanResponse` must set `runLog` from the normalized planning
     response so backend context tools can appear immediately.
   - Existing execute behavior remains unchanged.

7. Make context visible but compact.
   - The Context task node keeps document name, length, and topology.
   - With a selection, add text equivalent to
     `Selection 121-240 · 120 bp`; indicate an origin wrap when applicable.
   - Do not render the raw selected bases in the task stream.

8. Tests.
   - Inclusive-to-half-open conversion.
   - Circular origin wrap extraction.
   - Invalid/caret selection returns null.
   - Workspace updates and resets selection at every stale-context boundary.
   - Snapshot includes exact document and selection context.
   - Planning and execution requests contain the latest selection.
   - Planning response `runLog` remains visible in session state.
   - Agent Context renders selection metadata without raw bases.

## Acceptance Criteria

- Selecting bases in OVE updates the Agent Context node without saving.
- A request sent after selection contains that exact region and sequence.
- Clearing the selection or changing documents cannot leave stale selection
  context in a later Agent request.
- Circular selections crossing coordinate zero are represented correctly.
- Planning-stage read-only tool logs can be rendered by the task stream.
- Existing editor, Agent execution, patch review, collapse, and width behavior
  remain intact.

## Verification Commands

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

## Self-Review Checklist

- Confirm only allowed files changed.
- Confirm no OVE-inclusive coordinates leak into canonical state.
- Confirm no raw sequence is rendered in the Agent panel.
- Confirm the vector is not mapped to cloning insert input.
- Confirm selection state resets at all document-change boundaries.
- Confirm planning-stage run logs are preserved.
- Report failures rather than hiding them.

## Delivery Contract

Claude returns only the structured report requested by the orchestration
script. Keep paths and risk descriptions short; do not write a narrative
implementation summary.
