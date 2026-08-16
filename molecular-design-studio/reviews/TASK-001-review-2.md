# TASK-001 Review 2

## P1: QC strip renders an escaped Unicode literal

The running application displays `Length: \u2014` instead of an em dash.
Replace the escaped text with an ASCII-safe UI value such as `Length: --`.

## P2: Tauri schema still points to a third-party repository

The current URL remains under `nicholasq/tauri-v2-schema`. Replace it with the
official Tauri v2 schema:

```text
https://schema.tauri.app/config/2
```

## P2: Window has no minimum usable dimensions

Add sensible `minWidth` and `minHeight` values to the main Tauri window so the
left navigation, editor, and collapsed Agent control cannot overlap when the
window is resized. Keep the current default dimensions.

## P2: Expose collapse state to assistive technology

Add `aria-expanded={!collapsed}` and an `aria-controls` relationship between
the Agent toggle and Agent body. Preserve the verified 260px to 36px layout
behavior.

## Verification

```bash
npm run typecheck
npm run lint
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri:build
```
