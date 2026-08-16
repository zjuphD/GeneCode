# TASK-002 Review 2

## P1: ResizeObserver does not perform an initial measurement

The browser shows:

- editor-map: about `820 x 634`
- OVE circular/linear view: `400 x 400`

The state remains at its initial fallback because the implementation only waits
for a ResizeObserver callback. Make sizing deterministic:

- define a `measure()` function using `getBoundingClientRect()`
- call it immediately when the effect starts
- also call it from the ResizeObserver callback
- pass dimensions reduced only by intentional map padding
- keep the observer cleanup

Add test-visible data attributes or a small pure size-normalization helper so
the sizing behavior can be tested without relying only on screenshots.

Acceptance during browser verification:

- at a normal 1280x720 frontend viewport, OVE must be larger than 500px in its
  dominant dimension
- collapsing the Agent must increase the available OVE width
- no page-level overflow

## P1: Canonical metadata is not mapped to OVE's actual fields

OVE uses:

- `feature.notes` for GenBank-style qualifiers
- `feature.color` for annotation color
- `feature.forward` for orientation

The adapter currently outputs `qualifiers`, which OVE does not consume.

Required changes:

- add optional `color` to canonical `SequenceFeature`
- include optional parser feature `color` in the narrow declaration
- map parser color to canonical color
- map canonical qualifiers to OVE `notes`
- map canonical color to OVE `color`
- remove the nonexistent OVE `qualifiers` field from the ambient type
- add adapter tests for notes and color preservation

## P1: View switching lacks a component-level regression test

The adapter test proves the boolean conversion but not that the UI button uses
it. Add a focused `Editor` component test that mocks
`SimpleCircularOrLinearView`, then verifies:

- initial sequenceData.circular is true
- clicking Linear passes sequenceData.circular false
- clicking Circular passes true again

Mock `ResizeObserver` in the test; do not render the full OVE implementation in
jsdom.

## P2: Prevent invalid feature ranges from entering the canonical model

The parser currently trusts external `start/end` values. Validate each feature:

- start and end are finite integers
- start is not negative
- inclusive end is not before start
- start is inside the sequence
- clamp the inclusive end to the final valid base if it exceeds sequence length

Skip invalid features or fail with a clear policy, and test that policy.
Do not allow `NaN` ranges.

## Required Verification

```bash
npm ls react react-dom --depth=0
npm run typecheck
npm run lint
npm test -- --run
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri:build
```
