# TASK-000: Collaboration Smoke Test

Status: accepted

## Objective

Prove that Claude can read a bounded task, make one harmless repository-local
change, run verification, and return a reviewable result.

## Context

This task validates the Codex-to-Claude implementation loop. It is not
application scaffolding.

## In Scope

- Create one text file containing the requested exact content.

## Out of Scope

- Application code
- Dependency installation
- Configuration changes
- Files outside this repository

## Allowed Files

- `smoke/claude-ready.txt`

## Required Implementation

Create `smoke/claude-ready.txt` with exactly:

```text
Claude implementation loop is ready.
```

The file must end with a newline.

## Acceptance Criteria

- The file exists at the exact path.
- Its content matches exactly.
- No other tracked or untracked project file is changed by Claude.

## Verification Commands

```bash
grep -qxF "Claude implementation loop is ready." smoke/claude-ready.txt
```

## Delivery Notes

Report the changed file and verification result.
