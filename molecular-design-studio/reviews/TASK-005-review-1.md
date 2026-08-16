# TASK-005 Review 1

Status: changes requested

## Findings

### P0: Add a runtime schema boundary for untrusted Agent output

`src/agent/patchEngine.ts`
`src/agent/patchTypes.ts`

`validatePatch()` accepts a TypeScript `SequencePatch` and immediately reads
`patch.operations.length`. A future provider will supply parsed JSON, so null,
missing arrays, unknown operation kinds, null features, and wrong field types
can currently throw instead of producing a safe invalid preview.

Add a public runtime parser/validator that accepts `unknown`. It must never
throw for malformed input and must validate:

- patch object, schema version, non-empty ID/title/summary/baseHash
- operations is a non-empty array
- supported operation kind
- non-empty operation ID and reason
- required fields and primitive types for every operation
- complete add-feature shape, qualifier value arrays, valid strand

Make the workspace proposal entry point accept `unknown` and build an invalid
preview/error state safely. Keep typed helpers for internal callers if useful.
Add malformed-object tests, including null patch, missing operations, unknown
kind, empty IDs/reasons, and null feature.

### P1: Fix feature start-clipping coordinate math

`src/agent/patchEngine.ts`

For feature `[2, 8)` and deletion `[0, 6)`, the surviving feature segment is
original `[6, 8)`, which maps to canonical `[0, 2)`. The current branch computes
`[0, 4)`.

When a deletion overlaps the start of a feature, use:

```text
newStart = deletion start
newEnd = old feature end - deletion length
```

Add exact coordinate assertions for start clipping, end clipping, deletion
inside a feature, and replacement after the delete-then-insert transform.

### P1: Add workspace integration tests

`src/workspace/useWorkspace.ts`

There are no tests for the state controller that performs the actual commit.
Add `useWorkspace.test.ts` using `renderHook`/`act` and verify:

- safe preview load does not change document/dirty/remount state
- reject is a no-op on the document
- apply adds one feature, marks dirty, increments remount key, and stores the
  exact prior document
- revert restores the prior hash/features, remains dirty, increments remount
  again, and consumes the snapshot
- manual OVE commit clears pending preview and revert state
- file open clears pending preview and revert state
- document change after preview makes apply fail as stale with no patch effect

### P1: Make fingerprint serialization unambiguous

`src/agent/fingerprint.ts`

The custom delimiter serialization does not escape field or qualifier values.
Different documents containing `|`, `,`, `;`, `=`, or null characters can
serialize identically. Use a stable structured representation and
`JSON.stringify`, sorting qualifier keys while preserving feature/value order.
Add collision-regression tests using delimiter-containing names and qualifier
values.

### P1: Reset warning acknowledgement for every new proposal

`src/components/AgentPanel.tsx`

Acknowledgement resets only when the safe-example button is clicked. A future
provider can replace one pending proposal with another while the checkbox
remains checked. Reset acknowledgement whenever `pendingPreview.patchId`
changes. Add a rerender test where two warning-bearing previews have different
patch IDs.

### P2: Use a general proposal type at the Agent boundary

`src/components/AgentPanel.tsx`

`onLoadPreview` is typed as `ReturnType<typeof buildSafeExample>`. Use
`SequencePatch` or `unknown` according to the runtime boundary so the panel is
not coupled to the temporary example generator.

### P2: Represent added annotations accurately in preview

`src/agent/patchTypes.ts`
`src/agent/patchEngine.ts`

An `add_feature` operation currently emits action `transformed` with detail
`added`. Add an explicit `added` action so the preview does not label a newly
created annotation as transformed.

## Required Verification

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri:build
```
