# genecode-ove — vendored engine patch record

This directory is a vendored fork of `@teselagen/ove@0.8.42` (npm). Vite aliases
`@teselagen/ove` to `packages/genecode-ove/src/index.js`, so this copy is the
code that actually runs. This file records every local change relative to the
upstream npm package so the fork stays auditable and re-patchable.

Baseline: `@teselagen/ove@0.8.42` (registry.npmmirror.com, lockfile integrity
pinned in the app `package-lock.json`).

## How to regenerate this diff

```bash
diff -rq packages/genecode-ove/src node_modules/@teselagen/ove/src
```

## Changed files (20)

| File | Change |
|---|---|
| `CircularView/index.js` | Cut-site label layer `fontStyle: "italic"` → `"normal"` (A-UI-001: Map-view enzyme labels upright, matching the Sequence panel) |
| `CircularView/style.css` | Enzyme cut-site label colors / fill for the light theme (fixes "one-pixel black bar" cutsites); tag color/weight aligned with the Sequence panel |
| `style.css` | `.veCutsiteLabel` upright + semibold instead of italic (A-UI-001, matches the Sequence panel label language); portal z-index rule retargeted `.ove-portal` → `.bp3-portal` (A-ENG-001: `blueprintPortalClassName` legacy context removed, Blueprint v3 portals all carry `.bp3-portal`) |
| `selectors/cutsitesSelector.js` | Cut-site label default colors dark + readable on light theme (salmon/lightblue/lightgrey → #b3372f/#2f6f9f/#6b7280, A-UI-001/A-A11Y-001 contrast); `editorSizeSelector` reads the editor count threaded as the third selector argument (only numeric values accepted — `filteredCutsitesSelector` forwards `enzymeGroupsOverride` there, a truthy object must not become the capacity) instead of reading `state.VectorEditor` — the composed selector only receives the per-editor slice, so the old read always yielded 0 and silently disabled the cutsite cache; named-exports the cache fn + selector for regression tests (A-ENG-002) |
| `withEditorProps/index.js` | `getEditorState` no longer mutates the store (`editorState.editorSize = …` side effect removed — A-OVE-001 Redux immutability / undeclared-key warning); `mapStateToProps` computes the active-editor count from the full store and threads it into `cutsitesSelector` as the capacity arg (A-ENG-002) |
| `redux/index.js` | Registers a pass-through `editorSize` reducer so combineReducers never warns about / drops the cutsite-cache capacity key if a legacy path reintroduces it (A-ENG-002) |
| `Editor/index.js` | Editor shell adjustments for the GeneCode host; `getChildContext`/`childContextTypes` (legacy `blueprintPortalClassName` context) removed (A-ENG-001) |
| `GlobalDialog.js` | Dialog sizing / restore behavior for hosted dialogs |
| `Reflex/ReflexContainer.js` | React 18 lifecycle compatibility; string refs (`ref: flexData.guid` + `this.refs[...]`) replaced with a callback-ref `refMap` (A-ENG-001) |
| `Reflex/ReflexElement.js` | React 18 lifecycle compatibility |
| `Reflex/ReflexSplitter.js` | React 18 lifecycle compatibility |
| `RowItem/Sequence.js` | Sequence row rendering tweaks |
| `createVectorEditor/index.js` | Editor mount lifecycle (see A-STATE-001: `root.unmount()` in close) |
| `createVectorEditor/makeStore.js` | Store defaults tuned for the GeneCode adapter |
| `helperComponents/PrintDialog/index.js` | Print dialog fixes |
| `index.js` | Public exports (Digest/PCR/Alignment tools surfaced) |
| `AlignmentView/index.js` | `ReactDOM.findDOMNode` on the virtual ReactList replaced with react-list's own `getEl()` accessor (same DOM node, no legacy API); `react-dom` import removed (A-ENG-001) |
| `withEditorInteractions/createSequenceInputPopup.js` | Sequence-input popup behavior; popup reopen path defers the old root's `unmount()` by a tick (A-ENG-001: eliminates the React 18 "synchronously unmount a root while rendering" race, matching the existing `handleUnmount` deferred pattern) |
| `withEditorInteractions/index.js` | Lazy pointer capture on drag start (fixes annotation clicks not selecting); focus model on the interaction wrapper |
| `Editor/style.css` | `.veVectorInteractionWrapper:focus-visible` outline for keyboard focus visibility (A-A11Y-001) |

## Added files / directories (7)

| Path | Purpose |
|---|---|
| `CutsiteFilter/IsoschizomerCutsitesBody.js` | Isoschizomer cut-site list body (merged multi-enzyme labels) |
| `CutsiteFilter/IsoschizomerCutsitesDialog.js` | Double-click cut-site label dialog listing all isoschizomers at a position |
| `Reflex/react18-compatibility.smoke.mjs` | Smoke test for React 18 compat |
| `Reflex/react18-compatibility.runtime.smoke.mjs` | Runtime smoke test |
| `createVectorEditor/index.d.ts` | Type declarations for the alias target |
| `genecode/` | GeneCode panel layer: `SequencePanel` (layout.js, SequencePanel.jsx with lazy pointer capture + double-click handlers + label color policy), enzyme label merging, selection layer auto-scroll |
| `ToolBar/ToolbarItem.js` | A-A11Y-001: accessible names on toolbar buttons (AnchorButton aria-label from toolName map/humanizer); dropdown caret is now a real keyboard control (role=button + tabIndex + aria-expanded + Enter/Space toggle) |
| `withEditorInteractions/Keyboard.js` | A-A11Y-001: hidden clipboard input gets aria-label="Sequence clipboard" (axe label rule) |
| `Editor/DropHandler.js` | A-A11Y-001: dropzone root passes role="group" instead of the default role="button" (fixes nested-interactive on the editor container) |
| `scripts/editor-size-cache.test.mjs` | A-ENG-002 regression tests: editorSize reducer registration (no Unexpected-key warning), selector threading, cutsite cache capacity |

## Notes

- Keep `package.json` at the app root listing `@teselagen/ove@0.8.42` so
  TypeScript types resolve; the Vite alias overrides the runtime module.
- Never edit `node_modules/@teselagen/ove` directly — it is a build artifact.
- When upstream upgrades, re-diff against the new version and update this file.
