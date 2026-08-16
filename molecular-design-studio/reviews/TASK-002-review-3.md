# TASK-002 Review 3

## P1: Measurement effect runs before the map element exists

The real browser still shows:

- editor-map: about `820 x 634`
- OVE view: `400 x 400`

Cause:

1. `Editor` first renders the loading state, so `mapRef.current` is null.
2. The ResizeObserver effect runs, sees null, and returns.
3. Parsing sets `doc` and mounts `.editor-map`.
4. The effect depends only on the stable `measure` callback, so it never runs
   again.

Required changes:

- Run the measurement/observer effect when the loaded document causes the map
  element to mount. A dependency on the loaded state/document is acceptable.
- Avoid repeatedly recreating the observer on unrelated renders.
- Keep immediate measurement plus ResizeObserver updates.

## Required regression test

Extend the Editor component test:

- mock `getBoundingClientRect()` for the map element with a size larger than
  500px
- capture `width` and `height` passed to the mocked OVE component
- verify those real dimensions replace the `400 x 400` fallback after the
  document/map mounts
- preserve the existing circular/linear tests

## Verification

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

Codex will separately verify actual browser dimensions and the Agent-collapse
resize path.
