# TASK-004 Review 1

Status: changes requested

## Findings

### P0: Remove unrestricted filesystem scope

`src-tauri/capabilities/default.json`

The capability grants `fs:scope` with `**`, allowing the enabled text read and
write commands across the entire filesystem. This directly violates the task's
minimum-permission requirement.

The installed Tauri dialog API documents that paths selected by both `open()`
and `save()` are dynamically added to the filesystem scope for the current app
session. Remove the static `fs:scope` entry and keep only:

- `dialog:default`
- `fs:allow-read-text-file`
- `fs:allow-write-text-file`

Verify the packaged app can still open and save user-selected files.

### P1: Do not silently discard or truncate invalid GenBank annotations

`src/editor/parser.ts`

`convertFeature()` returns `null` for invalid annotations and clamps an
out-of-range end coordinate. `parseGenBank()` then silently skips null results.
For user-opened files this can replace the current document with a lossy model
without telling the user.

Make invalid feature coordinates reject the complete GenBank parse with a clear
error containing the feature index/name and reason. Do not clamp coordinates.
Update focused parser tests for negative, non-integer, reversed, and
out-of-range coordinates. The existing valid pUC19 fixture must still parse.

### P1: The same-name remount test does not verify a remount

`src/components/Editor.test.tsx`

The test only checks the new basename and length. It would pass if the
`OveEditorHost` key were removed and stale OVE state remained visible.

Make the mocked host expose mount/unmount identity or capture a monotonically
changing instance token, then assert opening a same-name document unmounts the
old host and mounts a fresh one.

### P2: Distinguish disk save from OVE edit commit in visible labels

`src/components/DocumentToolbar.tsx`

The application buttons currently say `Save` / `Save As`, while OVE also shows
a Save icon for committing edits to the canonical model. Rename the application
commands to `Save File` and `Save File As`, including tooltips and tests. Keep
the existing `Edits committed` status.

### P2: Match shortcut hints and handling to the platform

`src/components/DocumentToolbar.tsx`
`src/components/Editor.tsx`

The tooltip always says Ctrl, and the handler accepts Ctrl on macOS as well as
Command. Add a small platform helper so macOS displays/handles Command and
other platforms display/handle Ctrl. Keep the helper deterministic and
testable; add at least one macOS shortcut test and one non-macOS test.

### P2: Strengthen successful-save dirty-state coverage

`src/components/Editor.test.tsx`

The test named "clears dirty state" only asserts the `Saved` message. Assert the
dirty marker exists before the write and is absent after a successful write.

## Required Verification

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri:build
```
