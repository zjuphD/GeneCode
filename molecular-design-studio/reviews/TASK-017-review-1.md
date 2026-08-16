# TASK-017 Review 1

Status: accepted

All findings were addressed by Claude and independently verified by Codex.

Verification:

- `npm run typecheck`: pass
- `npm run lint`: pass
- `npm test -- --run`: 382 tests passed
- `npm run build`: pass
- Browser: editor and OVE render after full reload, 320 px Agent width,
  composer visible, no task-stream horizontal overflow, semantic palette active

## Findings

### P1: Muted text is too faint on the new chrome

`--color-text-muted: #8a919c` has approximately 2.7:1 contrast on the new
`#e8edf3` sidebar/Agent background. Much of the interface uses this token at
9.5-11 px, so labels such as service metadata, section labels, and secondary
state text are visibly washed out.

Required fix:

- Darken the muted token enough to remain readable on both white and cool-gray
  surfaces. Aim for approximately 4.5:1 on the sidebar/Agent surface.
- Preserve a visible hierarchy from primary and secondary text.
- Do not increase font sizes or weights as a workaround.

### P2: Document success status still uses interaction blue

`.doc-toolbar__status--success` uses the accent tokens. This contradicts the
task's semantic rule that blue means interaction and green means success.

Required fix:

- Use success foreground/background/border tokens for the success status.
- Keep error status red.

### P2: Transformed patch state still uses warning amber

`.patch-preview__feature-action--transformed` still uses the generic status
amber tokens, while the task explicitly grouped transformed/added patch states
under the new success semantic palette. The patch review node itself already
provides the amber review signal.

Required fix:

- Use success foreground/background for transformed and added feature actions.
- Keep removed actions red and preview warnings amber.

## Required Verification

- Run all TASK-017 verification commands.
- Re-scan CSS hard-coded colors and report remaining intentional literals.
