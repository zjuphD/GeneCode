# TASK-018 Review 1

Status: changes_requested

## Findings

### 1. OVE callback signature is incorrect and drops every real selection

`@teselagen/ove` calls `onSelectionOrCaretChanged` with one object:

```ts
{ selectionLayer, caretPosition }
```

The implementation currently declares three positional arguments and forwards
the second argument. It will therefore send `undefined` for real OVE events,
so the workspace selection always clears.

Fix the ambient type and `OveEditorHost` callback to consume the actual single
payload object. Add a component test that captures the callback passed to
`createVectorEditor`, invokes it with a real selection payload, and asserts the
selection layer is forwarded. Also test the caret payload with
`selectionLayer: { start: -1, end: -1 }`.

### 2. A one-base OVE selection is incorrectly treated as a caret

OVE uses inclusive ranges, so `{ start: 2, end: 2 }` is a valid one-base
selection. A caret event is distinguished by `caretPosition >= 0` and an empty
selection layer `{ start: -1, end: -1 }`.

Update `fromOveSelection` and its tests so equal start/end produces one selected
base. Invalid negative coordinates still return `null`.

### 3. Two required stale-selection boundaries are missing

The task requires both direct `setDoc` and `remountOve` to clear selection.
They currently do not. Clear selection in both actions and add focused hook
tests.

### 4. Wrapped selection text is misleading

For a wrapped selection, `Selection {start + 1}-{end}` reads like a descending
ordinary interval. Render an honest one-based range such as
`Selection 2601-2686 / 1-50`, followed by length and `wraps origin`.

Add an AgentPanel test for ordinary and wrapped selection metadata. Do not
render raw selected bases.

### 5. Required session tests are missing

Add focused `useAgentSession` tests proving:

- planning requests carry the latest selection;
- execution requests carry the latest selection;
- planning-stage `runLog` is preserved in state.

Do not rely only on `buildDocumentSnapshot` unit tests.

## Verification

Rerun every TASK-018 verification command after the fixes.
