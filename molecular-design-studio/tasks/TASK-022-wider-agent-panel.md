# TASK-022: Wider Agent Panel

Status: accepted

Accepted review: `reviews/TASK-022-review-1.md`

## Objective

Increase the Agent panel's default and wide-mode widths so Chinese responses,
task traces, tool results, and the composer are comfortable to read without
requiring the user to discover the wide toggle first.

## Product Invariants

- Preserve Agent content, behavior, collapse/expand, wide/narrow toggle, task
  state, and all interactions.
- Preserve the collapsed width at 36 px.
- Keep the sequence editor usable at a 1280 x 720 desktop viewport.
- Do not change the project sidebar, OVE layout, typography, palette, or Agent
  information architecture.
- Do not introduce horizontal overflow.

## In Scope

- Increase default expanded Agent width from 320 px to 400 px.
- Increase explicit wide mode from 480 px to 560 px.
- Add a conservative desktop fallback only if browser verification shows the
  editor becomes unusably narrow at 1280 px.
- Verify task labels, tool rows, chips, composer, and buttons fit cleanly.

## Out of Scope

- Drag-resizable panels or width persistence.
- JSX/TSX changes.
- New controls, labels, icons, or layout sections.
- Mobile redesign.
- Backend, OVE adapter, or Tauri changes.

## Allowed Files

- `src/App.css`
- `tasks/TASK-022-wider-agent-panel.md`
- `reviews/TASK-022-review-1.md`

Do not modify any other file.

## Required Implementation

1. Set `--agent-expanded-width` to `400px`.
2. Set `.agent-panel--wide` width to `560px`.
3. Keep `.agent-panel--collapsed` and
   `.agent-panel--collapsed.agent-panel--wide` at the existing collapsed token.
4. Do not change spacing/font sizes to fake additional width.
5. Do not add horizontal scrolling to the Agent task stream.
6. Confirm the main editor remains usable in both default and wide modes at
   1280 x 720 and normal larger desktop size.

## Acceptance Criteria

- The default Agent panel is visibly wider and long Chinese lines wrap less.
- Tool rows and starter actions no longer feel compressed at default width.
- Wide mode provides a meaningful additional increase.
- Collapse followed by expand restores the correct selected width mode.
- No horizontal overflow or overlapping controls appears.
- Existing functionality and tests remain intact.

## Verification Commands

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

## Self-Review Checklist

- Confirm only allowed files changed.
- Confirm widths are 400 / 560 / 36 px for default / wide / collapsed.
- Check 1280 x 720 screenshots in default and wide mode.
- Confirm no Agent or editor horizontal overflow.
- Confirm no unrelated palette or layout selectors changed.
- Report failures rather than hiding them.

## Delivery Contract

Claude returns only the structured report requested by the orchestration
script. Keep paths and risk descriptions short; do not write a narrative
implementation summary.
