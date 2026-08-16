# TASK-002 Review 4

## P2: Feature coordinates must be integers

The review requirement states that external feature start/end values must be
finite integers. `convertFeature()` currently checks only `Number.isFinite`,
so fractional coordinates are accepted into the canonical model.

Required changes:

- require `Number.isInteger(f.start)` and `Number.isInteger(f.end)`
- keep all existing range validation and clamping behavior
- add tests proving fractional start and fractional end are rejected

## Verification

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri:build
```
