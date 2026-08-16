# TASK-009 Review 1

Status: accepted

## Result

The Agent result display is accepted.

- Claude/ccb completed part of the data-layer work but did not return a
  structured report in either run.
- Codex reviewed the partial diff, corrected the result model, finished the UI
  integration, and ran independent verification.
- The normalized response now includes up to three display-safe result
  candidates from `design.results`.
- Cloning candidate fields are normalized for primer sequences, Tm, GC, insert
  length, primer length, Tm delta, cross-dimer status, annealing temperature,
  and extension time.
- Agent session state stores and clears candidates with the existing
  plan/result invalidation rules.
- The Agent panel now shows a top candidate card, primer pair table, and metric
  chips under `Recommended design`.
- Patch preview/apply/reject behavior remains unchanged.

## Independent Verification

```text
npm run typecheck                                      pass
npm run lint                                           pass
npm test -- --run                                      pass (331 tests)
npm run build                                          pass
cargo check --manifest-path src-tauri/Cargo.toml       pass
git diff --check                                       pass
```

## Visual Smoke

Verified in the in-app browser at `720x480` against
`http://127.0.0.1:8795/`.

Real Agent flow:

1. Sent a Gibson cloning request with an insert sequence.
2. Agent asked for missing left/right homology.
3. Sent left/right homology.
4. Agent produced an executable plan.
5. Clicked `Run molecular design`.

Observed:

- candidate card rendered
- primer table rendered
- forward/reverse primer sequences rendered
- Tm/GC values rendered
- metrics rendered: Tm delta, primer lengths, cross-dimer status, anneal,
  extension
- no horizontal overflow
- panel scrolls and composer is reachable after scrolling
