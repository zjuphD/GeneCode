# TASK-004 Review 2

Status: changes requested

## Findings

### P1: Shortcut handling is still not platform-specific

`src/components/Editor.tsx`

The handler still uses:

```ts
const mod = e.metaKey || e.ctrlKey;
```

so macOS accepts Ctrl and non-macOS accepts Command. The new tests merely prove
both modifiers always work; they do not prove the requested platform behavior.

Create/export a small deterministic helper, for example from
`DocumentToolbar.tsx`, that accepts a platform string and modifier state.
Use the same helper for tooltip labels and Editor event handling. Tests must
assert:

- macOS: Command accepted, Ctrl rejected
- non-macOS: Ctrl accepted, Command rejected

### P1: Same-name test still does not prove host unmount/remount

`src/components/Editor.test.tsx`

The test comment explicitly admits that it does not verify a real remount, and
there is no post-open assertion on `mountCount`.

Make the mocked `OveEditorHost` use a mount-only effect with separate
mount/unmount counters. Assert before open:

- mounts = 1
- unmounts = 0

and after opening the same internal name:

- mounts = 2
- unmounts = 1

Do not infer remounting only from the basename or sequence length.

## Required Verification

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```
