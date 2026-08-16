# TASK-007 Review 1

Status: accepted

## Result

The desktop Agent service launcher is accepted.

- The Tauri app exposes a narrow `ensure_agent_service` command.
- A healthy service on the configured localhost port is reused.
- If no service is present, the app starts the parent `server.py` on loopback.
- The app tracks only its owned child process and cleans that process on exit.
- Browser/Vite mode skips the Tauri command and keeps the previous health path.
- Agent planning, execution, result display, and patch preview behavior remain
  unchanged.

## Independent Verification

```text
npm run typecheck                                      pass
npm run lint                                           pass
npm test -- --run                                      pass (321 tests)
npm run build                                          pass
cargo test --manifest-path src-tauri/Cargo.toml        pass
cargo check --manifest-path src-tauri/Cargo.toml       pass
npm run tauri:build                                    pass
git diff --check                                       pass
```

`cargo fmt --check` could not run because the local stable Rust toolchain does
not have `rustfmt` installed.

## Live Service Verification

Verified automatic launch with no service on port `8124`:

- `VITE_AGENT_API_BASE=http://127.0.0.1:8124 npm run tauri:dev`
- Tauri started a Python service on `127.0.0.1:8124`.
- `/api/health` returned `已连接 MiniMax · MiniMax-M2.7`.
- After closing Tauri dev, port `8124` was no longer listening.

Verified reuse with an existing service on port `8000`:

- Before launch, PID `59946` was listening on `127.0.0.1:8000`.
- `npm run tauri:dev` reused the existing service.
- No duplicate Python listener was created on port `8000`.

The macOS Tauri bundle was built successfully at:

```text
src-tauri/target/release/bundle/macos/Molecular Design Studio.app
```
