# Claude Code Project Instructions

## Collaboration Contract

You are the implementation agent for GeneCode. Codex is the
architect and reviewer. Work only on the task file named in the user prompt.

## Required Behavior

1. Read the active task and its acceptance criteria before editing.
2. Inspect only the files needed for that task.
3. Keep changes narrowly scoped.
4. Follow existing patterns once the application scaffold exists.
5. Run every verification command listed in the task.
6. Do not claim completion when a command failed.
7. Self-review the final diff once against the task acceptance criteria.
8. Return only the structured result requested by the orchestration script.
   Keep paths, blockers, and risks short; do not add a narrative report.

## Prohibited Behavior

- Do not edit files outside this repository.
- Do not modify the parent Primer Design Studio project.
- Do not change architecture, frameworks, or dependencies unless the task
  explicitly permits it.
- Do not commit, amend, rebase, reset, or push Git history.
- Do not delete user files or use destructive Git commands.
- Do not add network services, analytics, telemetry, or cloud storage.
- Do not place API keys, tokens, credentials, or private paths in source files.
- Do not let an LLM directly invent final biological sequences or coordinates.

## Product Invariants

- The application is local-first.
- The canonical sequence model is independent of OVE internals.
- OVE must be accessed through an editor adapter.
- Internal coordinates are zero-based, half-open intervals.
- Agent sequence changes use structured patches.
- Agent changes are previewed and confirmed before creating a new version.
- Original sequence versions remain recoverable.
- Deterministic biology tools are the source of truth.

## Engineering Baseline

- TypeScript must use strict mode.
- Avoid `any` unless the task documents why it is unavoidable.
- Prefer small pure mapping and validation functions around editor data.
- Add tests for coordinate conversion and sequence transformations.
- User-facing failures must be explicit and recoverable.
- Do not silently discard GenBank features or qualifiers.

## UI Baseline

- This is a work-focused scientific desktop application.
- Use compact, predictable controls and restrained visual styling.
- Do not build a marketing landing page.
- Avoid decorative card nesting, oversized headings, and visual clutter.
- The primary workspace is project navigation, editor, Agent, and QC/results.
