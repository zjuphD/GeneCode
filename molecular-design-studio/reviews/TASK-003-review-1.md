# TASK-003 Review 1

Status: changes requested

## Findings

### P1: Preserve reverse strand when OVE returns `forward: false`

`src/editor/adapter.ts:100-108`

The reverse adapter currently maps every feature to forward unless
`strand === -1`. OVE's own model also represents orientation with `forward`,
and saved data may contain `forward: false` without a numeric `strand`.
Preserve reverse orientation when either representation says reverse. Add a
focused test with `forward: false` and no numeric strand.

### P1: Configure the full editor instead of exposing OVE defaults

`src/components/OveEditorHost.tsx:47-68`

The task requires a compact task-relevant toolbar and sequence plus map panels.
No `ToolBarProps`, `StatusBarProps`, or `panelsShown` are supplied, so OVE
falls back to its broad default surface, including unrelated workflows. Pass an
explicit tool list containing only save, undo/redo, feature/edit, find, and
visibility controls. Initialize sequence and circular/linear map panels
explicitly. Put circularity/read-only options under `StatusBarProps` as
documented by the installed OVE README. Test the configuration passed to
`createVectorEditor`.

### P1: The 2,687 bp save acceptance test is not implemented

`src/components/Editor.test.tsx:65-76`

The test named around successful save constructs exactly 2,686 bases and only
asserts the sync label. Change it to simulate a 2,687 bp saved document and
assert that the visible metadata updates from `2,686 bp` to `2,687 bp`.
Also assert that the initial `OveEditorHost` props receive 2,686 bases and all
8 pUC19 features.

### P2: Exercise Strict Mode cleanup with a realistic `close()`

`src/components/OveEditorHost.test.tsx:52-122`

The current cleanup mock does not remove the OVE mount node, so the test cannot
detect duplicate visible instances or accidental host removal. Add a test
wrapped in `React.StrictMode` where each mocked editor's `close()` removes only
the node it received. Assert one `.ove-mount-node` remains after the Strict
Mode effect cycle and that the React-owned `.ove-editor-host` remains mounted.

### P2: Make the conversion error itself visible

`src/components/Editor.tsx:97-100`

Only the generic text `Save error` is visible; the human-readable conversion
message is hidden in a hover title and then disappears after eight seconds.
Show the first short conversion error in the toolbar (with the full joined list
in `title` if needed), and update the component test to assert the concrete
coordinate error is visible.

## Required Verification

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```
