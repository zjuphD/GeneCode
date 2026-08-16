# TASK-016 Review 1

Status: accepted

All findings were addressed by Claude and independently verified by Codex.

Verification:

- `npm run typecheck`: pass
- `npm run lint`: pass
- `npm test -- --run`: 382 tests passed
- `npm run build`: pass
- `cargo check --manifest-path src-tauri/Cargo.toml`: pass
- Browser: 320 px default, 480 px wide, 36 px collapsed from wide,
  composer visible, no task-stream horizontal overflow, one textarea

## Findings

### P1: Wide mode overrides collapsed width

`src/App.css` defines `.agent-panel--wide` after `.agent-panel--collapsed` with
equal specificity. When both classes are present, the later 480 px rule wins,
so clicking Collapse from wide mode does not visually collapse the panel even
though the React state and class names change.

Required fix:

- Ensure collapsed width wins in both default and wide modes.
- Add a test that verifies the effective collapsed-width rule or otherwise
  protects the CSS class combination, not only that both class names exist.

### P1: Composer is not actually persistent

`.task-stream` has `flex: 1`, but `.agent-body` is not a column flex container
and still owns vertical scrolling. Long task content therefore grows inside the
body and pushes the composer below the visible area. This violates the core
requirement that the task stream scroll independently while the composer stays
visible.

Required fix:

- Make the online Agent body a constrained column layout.
- Let only `.task-stream` own the main vertical scroll.
- Keep workspace controls and the composer visible without horizontal overflow.
- Do not break offline/starting states.

### P1: Executing phase can have no visible active node

The Tool run node is rendered only when `session.runLog.length > 0`. At the
start of `executeDesign`, the hook sets `phase` to `executing` before any run log
exists, so the task stream temporarily shows no active execution step.

Required fix:

- Render the Tool run node whenever `phase === "executing"` or structured run
  activity exists.
- Show a compact neutral in-progress detail when the log is still empty.
- Add a test for `phase: "executing"` with an empty run log.

### P2: Empty state has no objective/start task node

The task required the empty state to show one objective/start state. The current
implementation hides Objective when `lastUserGoal` is empty and renders only
Context plus chips. The panel therefore starts as shortcuts rather than a
goal-driven task surface.

Required fix:

- Always render the Objective node.
- Before a goal exists, use a short neutral label/detail such as `Set objective`
  and make it the waiting/active start point.
- Keep starter chips compact and subordinate to that node or composer.
- Update the existing test that currently expects Objective to be absent.

### P2: Plan summaries are discarded

Plan child rows display `row.tool` but ignore `row.summary`, even though summary
is structured backend evidence and the task explicitly requires it when
present.

Required fix:

- Show both tool identity and non-empty summary without overflowing narrow mode.
- Add a focused rendering test.

### P2: Standalone Agent run metadata can disappear

The Results node is gated by recommendation/candidates/resultCount. A structured
`agentRun.runId` without those fields no longer renders, whereas the accepted
panel previously exposed it. Existing tests were changed to inject
`resultCount = 1`, masking this regression.

Required fix:

- Include structured `agentRun.runId` in the result/run node render condition.
- Restore a test for run ID/status with no fabricated result count.

## Required Verification

Run all TASK-016 verification commands after the fixes. Report `src/App.css` in
the changed-file list if it remains modified.
