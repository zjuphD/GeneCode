# TASK-001: Tauri React Desktop Shell

Status: accepted

## Objective

Create the minimal Tauri 2 + React + TypeScript + Vite desktop application that
will host Molecular Design Studio.

## Context

This is the first application task. The repository currently contains only
architecture, task, review, and orchestration files. OVE and the Python sidecar
are separate later tasks.

The machine provides:

- Node.js 22
- npm 10
- Rust 1.96
- Apple Command Line Tools
- project-local Cargo mirror configuration

## In Scope

- Tauri 2 desktop scaffold
- React + TypeScript + Vite frontend
- minimal scientific-workbench shell
- lint, type-check, frontend build, and Rust check scripts

## Out of Scope

- OVE installation or sequence visualization
- Python sidecar
- Agent behavior
- SQLite
- real biological calculations
- marketing page or product tour

## Allowed Files

- `package.json`
- `package-lock.json`
- `index.html`
- `vite.config.*`
- `tsconfig*.json`
- `eslint.config.*`
- `src/**`
- `src-tauri/**`
- `.cargo/config.toml` only if required to preserve the existing mirror
- `README.md` only for application run commands

## Required Implementation

1. Scaffold a Tauri 2 application using React, TypeScript, and Vite.
2. Keep TypeScript strict.
3. Create a restrained desktop shell with:
   - a narrow project navigation area
   - a central empty editor workspace
   - a collapsible-looking Agent placeholder on the right
   - a bottom QC/results strip
4. Use plain CSS for this first task.
5. Keep the interface compact and suitable for repeated scientific work.
6. Do not add OVE, a component framework, analytics, or remote services.
7. Add npm scripts for:
   - development
   - frontend build
   - type-check
   - lint
   - Tauri development
   - Tauri build
8. Use a neutral temporary application icon only if the scaffold requires one.

## Acceptance Criteria

- `npm install` succeeds.
- `npm run typecheck` succeeds.
- `npm run lint` succeeds.
- `npm run build` succeeds.
- `cargo check --manifest-path src-tauri/Cargo.toml` succeeds.
- The frontend first screen is the actual workbench shell, not a landing page.
- No dependency unrelated to this task is added.
- Existing workflow and architecture files remain unchanged except the allowed
  README run-command update.

## Verification Commands

```bash
npm install
npm run typecheck
npm run lint
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

## Delivery Notes

Claude must report:

- generated structure
- dependencies added
- files changed
- every verification command and its result
- platform-specific warnings or blockers
