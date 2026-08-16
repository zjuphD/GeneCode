# TASK-005 Review 2

Status: changes requested

## Findings

### P0: Invalid structured input can still crash preview construction

`src/agent/patchEngine.ts`
`src/workspace/useWorkspace.ts`
`src/agent/preview.ts`

`parseAndValidatePatch()` safely reports a missing insert sequence, but
`loadPatchPreview()` then casts the same raw operations and calls
`buildPreview()`. `opLengthDelta()` reads `op.sequence.length`, so this input
still throws:

```json
{
  "schemaVersion": 1,
  "id": "p",
  "title": "t",
  "summary": "s",
  "baseHash": "...",
  "operations": [
    {"kind": "insert", "id": "op", "reason": "r", "position": 0}
  ]
}
```

Refactor the runtime boundary to return either:

- a fully normalized `SequencePatch`, or
- errors with no typed patch

Only call `buildPreview()` with the normalized patch. For invalid input, build
a generic invalid preview without reading raw operation-specific fields. Add
workspace tests proving `loadPatchPreview()` never throws for:

- missing insert sequence
- unknown operation kind
- null add-feature value
- malformed operations array items

### P1: Require a complete normalized feature at the runtime boundary

`src/agent/patchEngine.ts`

`feature.qualifiers` is currently optional in the parser, but
`SequenceFeature` requires it. An accepted add-feature without qualifiers can
later throw in `fingerprintDocument()`. Require qualifiers to be a plain object
whose values are string arrays, or explicitly normalize a missing value to
`{}` when constructing the parsed patch. Also validate optional color is a
string. Do not cast the raw feature object into canonical state.

Trim and reject whitespace-only patch IDs/titles/summaries, operation IDs and
reasons, feature IDs/names/types, and remove-feature IDs.

### P1: The stale-preview integration test does not exercise stale rejection

`src/workspace/useWorkspace.test.ts`

The test calls `onOveCommit()`, which clears the preview, then merely asserts it
is null. It never reaches the hash re-check in `applyPendingPatch()`.

After loading a valid preview, change the document through `setDoc()` without
clearing the pending preview, call `applyPendingPatch()`, and assert:

- it returns null
- the changed document remains unchanged
- no Agent feature is added
- preview is cleared
- status reports stale
- no revert snapshot is created

Keep the separate test proving manual OVE commit clears a preview.

### P1: Warning acknowledgement reset test does not test a new patch ID

`src/components/AgentPanel.test.tsx`

The test acknowledges a warning, rerenders to empty state, and clicks the
example button, but never supplies a second warning-bearing preview or asserts
the Apply button is disabled.

Rerender directly from warning preview `patchId=A` to warning preview
`patchId=B`; assert the acknowledgement checkbox becomes unchecked and Apply
is disabled again.

## Required Verification

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri:build
```
