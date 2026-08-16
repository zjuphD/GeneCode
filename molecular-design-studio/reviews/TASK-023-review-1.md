# TASK-023 Review 1

Status: accepted

## Finding

- The new default-size test incorrectly expects `input.style.height` to be
  `72px`. The initial height is supplied by the stylesheet, so the element's
  inline `style.height` is correctly empty until the auto-grow/reset logic
  writes it. This caused one failing test (`443/444` passed).

## Required Revision

- Keep the `rows === 3` assertion for the initial semantic size.
- Do not assert a stylesheet declaration through `input.style`.
- Preserve the focused post-send reset assertions, which correctly verify the
  inline `72px` reset behavior.
- Run all four verification commands and report their actual results.

## Resolution

- The invalid initial inline-style assertion was removed.
- The textarea renders with `rows="3"` and a default CSS height of 72 px.
- Long input auto-grows up to 180 px and the send button remains visible and
  bottom-aligned.
- Sending resets the inline height to the three-row baseline.

## Verification

- `npm run typecheck`
- `npm run lint`
- `npm test -- --run` (`444` tests passed)
- `npm run build`
- Browser visual review with the live Agent service online
- Browser measured default height: approximately 72 px
- Browser measured six-line input height: 105 px; max height: 180 px
- Browser console: no errors or warnings
