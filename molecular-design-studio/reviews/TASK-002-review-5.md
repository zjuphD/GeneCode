# TASK-002 Review 5

## P1: OVE workspace has permanent horizontal and vertical scrollbars

The rebuilt desktop application shows both scrollbars even though the map is
not zoomed and should fit the center workspace.

Cause:

- `.editor-map` has 8px padding with global border-box sizing.
- `getBoundingClientRect()` returns the outer box size.
- OVE receives that full size, so the child exceeds the content box.

Required changes:

- Make the unzoomed OVE view fit without horizontal or vertical scrollbars.
- Either remove the map padding or subtract computed padding from measured
  dimensions. Prefer the simplest stable solution.
- Keep `overflow: hidden` for this visualization spike; OVE owns its own view
  interactions.
- Preserve responsive resizing and the minimum-size behavior.
- Add or adjust a focused size helper test if size arithmetic changes.

## Verification

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
npm run tauri:build
```

Codex will verify in the rebuilt `.app` that both scrollbars are absent.
