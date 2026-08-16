# TASK-002 Review 1

The first Claude client was interrupted while producing its final report. The
files already written are the implementation baseline. Do not restart the task
from scratch.

## P0: Parser shifts every feature and collapses ranges

`@teselagen/bio-parsers` returns feature `start` and `end` as zero-based,
inclusive values by default. The current parser incorrectly expects
one-based values under `locations`, then falls back to `1..1`. In the running
application every feature is therefore displayed as `Start: 1 End: 1`.

Required changes:

- Correct the ambient declaration to match the observed parser result:
  `start`, `end`, `strand`, `forward`, `notes`, and optional `locations`.
- Convert parser `[start, end]` to canonical `[start, end + 1)`.
- Use the flattened parser `start/end` values for the canonical feature span.
- Preserve `forward` semantics through the OVE adapter.
- Add exact assertions using real pUC19 features, not only total feature count.
  At minimum verify:
  - source canonical range is `[0, 2686)`
  - M13mp19 canonical range is `[0, 447)`
  - converting these back to OVE restores inclusive ends `2685` and `446`

## P0: Linear control does not change the OVE view

`SimpleCircularOrLinearView` does not accept the current custom `linearView`
prop. Its source chooses the component from `sequenceData.circular` unless its
own preview controls are enabled. The current Circular/Linear buttons only
change their active styling.

Required changes:

- Keep the app's compact segmented control.
- Pass an OVE data object whose `circular` value reflects the selected view.
- Verify in a UI test or focused component test that the rendered OVE
  sequenceData changes between circular and linear.
- Remove the nonexistent `linearView` property from the ambient declaration.

## P1: OVE map is fixed at 300 x 300

The central container is approximately 820 x 634, but the OVE view is exactly
300 x 300 because no dimensions are passed.

Required changes:

- Measure the available editor-map area with `ResizeObserver`.
- Pass stable width and height values to OVE.
- Keep a small nonzero minimum size during initial measurement.
- The OVE drawing should resize with the center workspace and Agent collapse.
- Clean up the observer on unmount.

## P1: OVE feature orientation is incomplete

OVE rendering uses `feature.forward` in multiple paths. The adapter currently
sets only `strand`. Set both:

- `forward: feature.strand === 1`
- `strand: feature.strand`

Add assertions for forward and reverse features.

## P1: Type declarations describe APIs that do not exist

The ambient OVE props include `linearView`, which is not consumed by the
component. Make declarations match only the actual props used:

- `sequenceData`
- `annotationVisibility`
- `width`
- `height`
- `editorName`
- any other property that the final implementation really passes

Do not use `any`.

## P2: React verification must account for stale peer ranges

There is one physical React and ReactDOM installation at version 18.3.1.
However, Blueprint 3 and other legacy OVE dependencies declare older peer
ranges, causing full `npm ls --all` to exit with `ELSPROBLEMS`.

Do not suppress or override peer warnings. Use the revised task commands:

```bash
npm ls react react-dom --depth=0
npm explain react
npm explain react-dom
```

Document the stale peer-range warnings as an OVE adoption risk.

## P2: Record bundle-size cost

The current production frontend is approximately:

- JavaScript: 3.74 MB minified, 1.18 MB gzip
- CSS: 1.88 MB minified, 718 KB gzip

This is acceptable for the technical spike, but record it in the delivery
report as a material OVE cost. Do not hide the Vite chunk warning.

## Required Verification

```bash
npm ls react react-dom --depth=0
npm explain react
npm explain react-dom
npm run typecheck
npm run lint
npm test -- --run
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri:build
```
