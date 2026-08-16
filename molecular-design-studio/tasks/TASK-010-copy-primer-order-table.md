# TASK-010: Copy Primer Order Table

Status: draft

## Objective

Add a small, practical product action to the Cloning Agent result card: copy the
top candidate's primer pair as a tab-separated order table.

This makes the Agent output feel usable after design execution without changing
the backend, file formats, or sequence-edit safety boundary.

## Context

TASK-009 added normalized result candidates and a primer pair table in the
Agent panel. Users can now see forward/reverse primer sequences, Tm, GC, primer
lengths, and conditions, but there is no quick way to move those primers into
an ordering workflow.

This task should add a copy-only action. Do not add file export or persistent
history.

## Product Invariants

- No automatic design execution.
- No automatic sequence patch application.
- TASK-005 preview/apply/reject remains the only sequence edit path.
- Do not invent biological values.
- Do not change service requests, Python code, or deterministic algorithms.
- The app remains usable when clipboard access is unavailable.

## In Scope

- Generate a TSV string from the top candidate's forward/reverse primers.
- Copy the TSV through `navigator.clipboard.writeText` when available.
- Show compact success/failure feedback in the Agent panel.
- Hide or disable the action when no primer pair exists.
- Component tests for TSV content, clipboard success, and clipboard failure.
- Minimal styling for the action and feedback.

## Out of Scope

- file download/export
- ordering-provider integrations
- copying all candidates
- changing normalized result schema unless narrowly needed
- changing parent `../server.py`
- Tauri clipboard commands
- OVE/editor/file-format changes

## Allowed Files

- `src/components/AgentPanel.tsx`
- `src/components/AgentPanel.test.tsx`
- `src/App.css`
- `tasks/TASK-010-copy-primer-order-table.md`
- `reviews/TASK-010-review-1.md`

Do not modify:

- `src-tauri/**`
- `src/agent/**`
- `src/workspace/**`
- OVE/editor/file-format modules
- parent-directory files

## Required Implementation

1. Build one TSV string from the top result candidate:
   - header: `Name\tSequence\tTm\tGC\tLength\tNotes`
   - row 1 name: `Forward primer`
   - row 2 name: `Reverse primer`
   - sequence from normalized candidate fields
   - Tm/GC/length from normalized candidate fields when available
   - notes should include `insert`, `anneal`, or `extension` values when present

2. Add a `Copy primer order table` action near the primer table.
   - Only show it when at least one forward or reverse primer sequence exists.
   - Use the existing button style family.
   - Do not block other Agent interactions.

3. Clipboard behavior.
   - Use `navigator.clipboard.writeText`.
   - If clipboard is unavailable or rejects, show a short failure message.
   - On success, show a short copied message.
   - Do not throw uncaught errors.

4. Tests.
   - Verify the button is rendered for candidates with primers.
   - Verify the copied TSV includes header, forward row, reverse row, sequence,
     Tm, GC, and notes.
   - Verify failure feedback when clipboard is unavailable or rejects.
   - Verify no button appears for candidates without primer sequences.

## Acceptance Criteria

- A result candidate with forward/reverse primers shows `Copy primer order table`.
- Clicking it writes a TSV table to the clipboard.
- Success and failure feedback are visible and compact.
- No action appears when candidate details lack primer sequences.
- Existing Agent panel, patch preview, and result-card tests still pass.
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
- Confirm no service/API behavior changed.
- Confirm no patch safety behavior was weakened.
- Confirm failures and incomplete work are reported, not hidden.

## Delivery Contract

Claude returns only the structured report requested by the orchestration
script. Keep paths and risk descriptions short; do not write a narrative
implementation summary.
