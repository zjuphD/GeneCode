# TASK-004 Review 3

Status: changes requested

## Finding

### P2: Remove the React Fast Refresh lint warning

`src/components/DocumentToolbar.tsx`

The file exports `IS_MAC`, `MOD_KEY`, and `isMod` alongside the component,
triggering `react-refresh/only-export-components`.

Move platform/shortcut helpers into a small non-component module such as:

```text
src/components/documentShortcuts.ts
```

Update imports and tests. Do not disable the lint rule. The final
`npm run lint` output must contain zero warnings and zero errors.

## Required Verification

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```
