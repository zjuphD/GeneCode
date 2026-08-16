# TASK-001 Review 1

## P1: Production build does not complete reliably

`npm run tauri:build` compiles the application and creates the macOS `.app`,
but then waits indefinitely in the DMG Finder/AppleScript layout step. The
current task needs a deterministic local application build.

Required changes:

- Configure this macOS-first prototype to build the `app` bundle only.
- Change the bundle identifier so it does not end in `.app`.
- Use the official Tauri v2 config schema URL.
- Regenerate real `.icns` and `.ico` files with the Tauri icon command. The
  current files are PNG payloads with renamed extensions.

Verification:

```bash
npm run tauri:build
file src-tauri/icons/icon.icns src-tauri/icons/icon.ico
```

The build must exit successfully without entering the DMG AppleScript step.

## P1: Agent panel is not collapsible

The task calls for a collapsible Agent placeholder, but the current panel has
no control or state. Add an accessible icon button in the Agent header that
actually collapses and restores the panel. The central workspace must expand
without a layout jump or overlap.

## P1: Visual hierarchy is too dark and low-information

The current window is almost entirely one dark gray tone, and the central
workspace looks unfinished rather than intentionally empty. Revise it into a
quiet scientific workbench:

- use a light neutral main workspace
- keep forest green as the primary accent
- use at least one restrained secondary accent for status/QC
- add a compact top workspace bar with product/document state
- keep typography compact and readable
- preserve the required left navigation, center editor, right Agent, and
  bottom QC structure
- do not add cards, marketing copy, gradients, or decorative imagery

The empty state should provide one clear file-open command placeholder without
claiming that file import already works.

## P2: Scaffold contains unused sample backend code and dependencies

Remove the unused `greet` command and explicit direct `serde`/`serde_json`
dependencies. Keep only the minimal Tauri builder until a real command is
introduced.

## P2: Generated TypeScript metadata is left untracked

`npm run build` creates `tsconfig.tsbuildinfo`, which is not ignored. Prefer
using `tsc --noEmit` in the build script so the file is not generated. Remove
the current generated file and also ignore `*.tsbuildinfo` defensively.

## P2: README script table is malformed

The final Cargo row is missing its closing table delimiter. Fix the table and
document that the current desktop build produces a macOS `.app`.

## Required Regression Verification

Run and report:

```bash
npm run typecheck
npm run lint
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri:build
```
