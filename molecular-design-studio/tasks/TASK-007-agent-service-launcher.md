# TASK-007: Desktop Agent Service Launcher

Status: accepted

Accepted review: `reviews/TASK-007-review-1.md`

## Objective

Make the desktop app start and manage the local Python Agent service
automatically, so a user can open Molecular Design Studio and use the Agent
without manually running `python3 server.py --host 127.0.0.1 --port 8000`.

## Context

TASK-006 connected the React Agent panel to the local service endpoints:

- `GET /api/health`
- `POST /api/agent/chat`
- `POST /api/agent/execute`

The default service URL is `http://127.0.0.1:8000`. The parent Primer Design
Studio project currently provides the service in `../server.py` relative to
this desktop project during local development.

This task owns service lifecycle only. It must not change the biological design
logic, response normalization, patch validation, or OVE/editor behavior.

## Product Invariants

- Reuse a healthy user-started service on the target port.
- Start a service only when the configured localhost URL is unreachable.
- Never kill or replace a service the app did not start.
- Stop only the child process started by this app.
- Keep the editor usable when the service cannot be started.
- Do not store or bundle API keys.
- Do not expose the Agent service to non-localhost network interfaces.
- Do not bypass TASK-005 sequence patch preview and explicit apply flow.

## In Scope

- Tauri-side service lifecycle command(s)
- detection of an already-running healthy local service
- dev/local launch of the parent `server.py`
- frontend startup call that asks Tauri to ensure the service
- frontend retry path for service launch and health check
- starting/online/offline UI state that is clear but compact
- tests for lifecycle/request-state behavior where practical
- README note for the new automatic local-service behavior

## Out of Scope

- changing parent `../server.py`
- packaging a standalone Python runtime
- replacing the Agent HTTP API
- SSE streaming
- provider/API-key settings
- durable Agent history
- changing OVE/editor/file-format modules
- RT-qPCR, sgRNA, siRNA, mutagenesis-specific views
- automatic design execution or automatic patch application

## Allowed Files

- `src/App.tsx`
- `src/App.css`
- `src/agent/**`
- `src/components/AgentPanel.tsx`
- `src/components/AgentPanel.test.tsx`
- `src/types/ambient.d.ts`
- `src-tauri/**`
- `package.json`
- `package-lock.json`
- `README.md`

Do not modify:

- parent-directory files, including `../server.py`
- OVE/editor/file-format modules
- workspace document mutation logic, except through existing public props
- GenBank fixtures
- task or review files other than this task if implementation notes are needed

## Required Implementation

1. Add a narrow Tauri service manager.
   - Expose a command equivalent to `ensure_agent_service()`.
   - Return structured status: reused existing service, started owned service,
     starting, unavailable, and a short safe message.
   - Track whether the current app instance owns the child process.
   - On app shutdown, stop only the owned child process.

2. Detect existing health before launching.
   - Check `GET /api/health` on `127.0.0.1:8000` by default.
   - Treat a valid JSON health response as reusable.
   - Do not launch another process if a healthy service is already present.
   - Keep timeouts short enough that app startup is not blocked for long.

3. Launch the local Python service in development/local checkout mode.
   - Use loopback host only: `--host 127.0.0.1`.
   - Use the same port the frontend client will call.
   - Prefer a configurable python executable for development, with a safe
     default such as `python3`.
   - Resolve the service script from stable local paths, including the parent
     project `../server.py` from this repo.
   - Fail with a readable message if no service script is found.

4. Connect frontend startup to the manager without breaking browser tests.
   - In Tauri runtime, call the command once when the Agent session starts or
     the Agent panel mounts.
   - In plain browser/Vite tests, skip the Tauri command and fall back to the
     existing HTTP health behavior.
   - After a successful start/reuse, run the existing health check so the UI
     shows the service label returned by `/api/health`.
   - Provide a retry action that asks Tauri to ensure the service again before
     checking health.

5. Keep request safety unchanged.
   - Planning and execution still use the HTTP client from TASK-006.
   - No automatic execution after launch.
   - No sequence edit is applied by the launcher.
   - Do not send document contents to Rust except what is already needed for
     service lifecycle, which should normally be nothing.

6. UI requirements.
   - Service status can show `Starting…`, `Online`, or `Offline`.
   - When startup fails, show a short recoverable message and leave the editor
     interactive.
   - The composer must remain reachable at `720x480`.

7. Testing expectations.
   - Add Rust unit tests or small pure helper tests for path/status/process
     decision logic where feasible.
   - Add/adjust frontend tests for:
     - Tauri command unavailable in browser mode does not crash
     - successful ensure triggers health refresh
     - failed ensure leaves offline/retry state
     - existing Agent planning/execution behavior still passes

## Acceptance Criteria

- With no manually started service, opening the Tauri app causes the local Agent
  service to become healthy and the Agent panel reports online.
- If a healthy service is already running on port 8000, the app reuses it and
  does not start a duplicate process.
- If the Python script cannot be found or cannot start, the editor remains
  usable and the Agent panel shows a retryable offline state.
- Closing the app stops only the owned service process.
- Browser/Vite mode continues to run without Tauri command availability.
- Existing TASK-006 chat, execute, result, and patch-preview behavior remains
  intact.

## Verification Commands

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri:build
```

Also perform one manual smoke check:

```bash
# Start from no manually running Agent service when possible.
npm run tauri:dev
# Confirm Agent transitions through starting/checking to online.
# Confirm a second service is not spawned if port 8000 already has a healthy service.
```

## Self-Review Checklist

- Check every acceptance criterion once after the final edit.
- Confirm all changed files are allowed by this task.
- Confirm no parent project files were modified.
- Confirm the app never kills a process it did not start.
- Confirm failures and incomplete work are reported, not hidden.

## Delivery Contract

Claude returns only the structured report requested by the orchestration
script. Keep paths and risk descriptions short; do not write a narrative
implementation summary.
