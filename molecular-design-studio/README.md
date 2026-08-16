# GeneCode

Local-first molecular sequence and cloning workbench with an integrated Agent.

This application source tree is intentionally isolated from the existing Primer
Design Studio prototype while being tracked directly by the parent repository,
so a clean checkout includes both the desktop frontend and Python sidecar. The
initial goal is to validate a Tauri + React + OVE desktop shell while reusing
the existing Python design service as a sidecar.

## Roles

- Codex owns architecture, task planning, review, verification, and acceptance.
- Claude Code implements one approved task at a time.
- Deterministic biology code remains the source of truth for sequence and
  cloning calculations.

## Development Status

Preparation, the desktop shell, and the OVE GenBank spike are complete.

The sequence library can also be saved as a portable `.genecode.json` project
bundle. It includes the project documents, annotations, and document history;
use the open/save project actions in the Sequence library header to move a
working set between machines without relying on browser local storage.
`TASK-000` through `TASK-002` have passed implementation, review, and
independent verification.

The OVE spike currently carries two known costs:

- legacy dependencies declare stale React peer ranges even though the app uses
  one React/ReactDOM 18.3.1 installation
- the production frontend bundle is approximately 4.2 MB JavaScript and
  1.3 MB CSS before gzip (measured from a `npm run build` `dist/` output;
  the single-page engine bundle dominates — A-DOC-001 keeps this current)

## Workflow

1. Codex creates a task under `tasks/`.
2. Claude implements it with `scripts/run-claude-task.sh`.
3. Codex reviews the diff and runs independent verification.
4. Claude addresses review notes with `scripts/continue-claude-task.sh`.
5. Codex accepts and commits the task before starting the next one.

See [CLAUDE.md](CLAUDE.md) and [tasks/TASK_TEMPLATE.md](tasks/TASK_TEMPLATE.md).

## Local Toolchain

- Node.js 22+
- npm 10+
- Rust stable
- Apple Command Line Tools on macOS

This repository uses a project-local Cargo registry mirror in
`.cargo/config.toml` because direct crates.io TLS access is unreliable on the
current development machine.

## Quick Start

```bash
npm install
npm run tauri:dev
```

In Tauri mode the app first reuses a healthy local Agent service at
`http://127.0.0.1:8000`. If none is running, it attempts to start the parent
Primer Design Studio service from `../server.py` on `127.0.0.1:8000`.

Development overrides:

- `MDS_AGENT_SERVER_PATH=/absolute/path/to/server.py`
- `MDS_AGENT_PYTHON=/absolute/path/to/python3`
- `VITE_AGENT_API_BASE=http://127.0.0.1:8000`

### Local API token (A-API-001)

The sidecar requires a 256-bit bearer token on every `/api/*` request except
`GET /api/health` (which carries a per-process `nonce` + `apiVersion` for
restart detection). In Tauri mode the Rust shell generates the token, injects
it into the sidecar via `GENE_CODE_API_TOKEN`, and hands it to the frontend
through the `get_agent_api_token` command — nothing to configure.

Plain-browser dev mode must pass the same token to both sides:

```bash
# terminal 1 — start the sidecar with a fixed token
GENE_CODE_API_TOKEN=dev-token python3 ../server.py --port 8000
# terminal 2 — start Vite with the matching token
VITE_AGENT_API_TOKEN=dev-token npm run dev
```

The Vite dev server proxies `/api` to `127.0.0.1:8000` so browser requests
stay same-origin.

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server (frontend only) |
| `npm run build` | Lint → type-check → build frontend |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run lint` | Run ESLint |
| `npm run test:ci` | Run vitest once (non-watch) |
| `npm run tauri:dev` | Start Tauri desktop app in dev mode |
| `npm run tauri:build` | Build production macOS `.app` bundle |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Check Rust backend |

## Continuous Integration

The repository root ships a GitHub Actions workflow (`.github/workflows/ci.yml`)
that runs the full quality ladder from a clean checkout on every push/PR:

1. **Frontend** — `lint` → `typecheck` → `vitest run` (unit) → engine smoke
   (`src/editor/engineSmoke.test.ts`, proves the vendored `genecode-ove` fork
   compiles through Vite's JSX transform) → production `build`.
2. **Python** — the agent backend regression suite (`server.py` + `tests/`,
   hermetic with `AGENT_LLM_ENABLED=0`, no model calls).
