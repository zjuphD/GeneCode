# TASK-003: Full OVE Editor and Canonical Save Boundary

Status: accepted

Current review: `reviews/TASK-003-review-2.md`

## Objective

Replace the read-only OVE map spike with OVE's full embedded editor and prove
that an edited sequence can be saved back into Molecular Design Studio's
canonical `SequenceDocument` model.

## Context

TASK-002 established:

- OVE `0.8.42`
- React `18.3.1`
- a real pUC19 `M77789.2` GenBank fixture
- canonical zero-based half-open coordinates
- OVE zero-based inclusive coordinates
- a tested canonical-to-OVE adapter

Use OVE's exported `createVectorEditor(node, editorProps)` API. The installed
source is authoritative:

```text
node_modules/@teselagen/ove/src/createVectorEditor/index.js
node_modules/@teselagen/ove/README.md
```

Important integration facts:

- `createVectorEditor` returns `updateEditor`, `getState`, and `close`.
- `onSave(event, sequenceData, editorState, onSuccessCallback)` receives the
  edited OVE sequence data.
- OVE's `close()` unmounts and removes the node passed to it. Create a dedicated
  child mount node inside the React-owned host. Never pass the React-owned host
  itself to OVE.
- OVE uses legacy `ReactDOM.render`; a development warning is acceptable, but
  runtime errors and duplicate React installations are not.

## In Scope

- full embedded OVE editor
- dedicated React wrapper for the imperative OVE API
- canonical-to-OVE initialization
- OVE-to-canonical save conversion
- explicit in-memory save/sync status
- focused adapter and component tests
- responsive editor sizing inside the existing desktop shell

## Out of Scope

- file open/save dialogs
- persistence to disk or SQLite
- project/version history
- autosave
- Agent-generated sequence patches
- biological design algorithms
- changing the pUC19 fixture
- redesigning Sidebar, Agent, or QC behavior
- upgrading or replacing OVE

## Allowed Files

- `src/App.css`
- `src/components/Editor.tsx`
- `src/components/OveEditorHost.tsx`
- `src/components/Editor.test.tsx`
- `src/components/OveEditorHost.test.tsx`
- `src/editor/adapter.ts`
- `src/editor/adapter.test.ts`
- `src/editor/index.ts`
- `src/types/ambient.d.ts`
- `README.md` only for a short integration note

Do not modify:

- `src/fixtures/puc19.gb`
- `src-tauri/**`
- `package.json` or lockfiles
- `CLAUDE.md`
- application navigation, Agent behavior, or QC behavior

## Required Implementation

1. Add narrow ambient types for:
   - `createVectorEditor`
   - its returned `updateEditor`, `getState`, and `close` methods
   - the `onSave` callback arguments needed by this task
2. Add an `OveEditorHost` React component that:
   - owns a plain host element
   - creates a dedicated child mount node
   - calls `createVectorEditor` once per mount
   - initializes the editor with `updateEditor({ sequenceData, ... })`
   - cleans up safely under React Strict Mode
   - does not delete the React-owned host
3. Configure the full editor as a compact workbench:
   - editable, not read-only
   - manual Save enabled
   - no autosave
   - sequence and circular/linear map panels available
   - only task-relevant OVE toolbar tools; avoid import/download/alignment and
     other unrelated workflows
4. Extend the adapter with a complete OVE-to-canonical conversion:
   - OVE inclusive `[start, end]` to canonical half-open `[start, end + 1)`
   - preserve name, sequence, circularity, features, strand, qualifiers, color
   - preserve canonical accession/version fields not represented by OVE
   - validate sequence and every feature coordinate before returning
   - reject invalid data visibly; do not silently discard annotations
5. Wire OVE `onSave` into `Editor`:
   - convert the returned OVE data to canonical data
   - replace the in-memory canonical document only after successful conversion
   - call OVE's success callback only after successful conversion
   - show a compact status in the existing metadata toolbar such as
     `Synced 14:32:05`
   - show a compact recoverable error if conversion fails
6. Remove the redundant external Circular/Linear segmented control if the full
   OVE editor provides those views itself.
7. Keep the pUC19 name, length, topology, and feature count visible in the
   existing application toolbar, reflecting the latest saved canonical data.
8. Ensure the editor fills available space and has no permanent outer
   horizontal or vertical scrollbar at 1200x800.
9. Keep all direct runtime imports from `@teselagen/ove` inside
   `OveEditorHost`; adapter imports may be type-only.

## Acceptance Criteria

- The center workspace displays OVE's full editor, including editable sequence
  and map views.
- OVE receives pUC19 as 2,686 bp, circular, with all 8 parsed features.
- A simulated OVE save with a one-base sequence change updates the canonical
  document metadata to 2,687 bp.
- A simulated saved annotation converts its inclusive end back to the correct
  canonical exclusive end.
- Invalid saved coordinates do not replace the canonical document, do not call
  the OVE success callback, and produce a visible error.
- Component unmount calls OVE cleanup without removing the React-owned host.
- React Strict Mode does not create duplicate visible editor instances.
- Existing Agent collapse behavior still leaves the editor usable.
- No new runtime or development dependency is added.

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
- Confirm the reverse adapter rejects rather than truncates invalid data.
- Confirm OVE cleanup targets only the dedicated child mount node.
- Confirm failures and incomplete work are reported, not hidden.

## Delivery Contract

Claude returns only the structured report requested by the orchestration
script. Keep paths and risk descriptions short; do not write a narrative
implementation summary.
