# TASK-008: Cloning Agent Workbench Productization

Status: accepted

Accepted review: `reviews/TASK-008-review-1.md`

## Objective

Turn the right sidebar from a generic chat panel into a clearly recognizable
Cloning Agent workbench for local molecular cloning design.

The first screen should communicate that the Agent can read the active vector,
ask for missing insert information, plan a design, run deterministic tools, and
hand proposed sequence changes to explicit preview/apply controls.

## Context

TASK-006 connected the Agent panel to the local Python service.
TASK-007 made the Tauri desktop app automatically start or reuse that service.

The capability works, but the UI still looks like a small chat box. Users do
not immediately see that it is an Agent that operates on the active sequence.

## Product Invariants

- The Agent never automatically executes design tools.
- The Agent never automatically applies sequence changes.
- The active vector is context, not permission to edit it.
- TASK-005 patch preview and explicit apply/reject remain the only edit path.
- The editor remains usable when the Agent service is offline.
- Do not change Python service behavior or deterministic design logic.

## In Scope

- Agent header naming and status copy
- current-vector context summary in the panel
- task launcher buttons for common cloning starts
- Agent workflow/status rail
- plan and run-log presentation copy
- result and patch-preview framing
- composer placeholder and button copy
- focused component tests
- responsive polish so the panel remains usable at 720x480

## Out of Scope

- changing the Python API or `server.py`
- adding new biological algorithms
- changing OVE/editor/file-format modules
- persistent conversations
- streaming/SSE
- automatic execution
- automatic patch application
- packaging a Python runtime

## Allowed Files

- `src/components/AgentPanel.tsx`
- `src/components/AgentPanel.test.tsx`
- `src/App.css`
- `tasks/TASK-008-agent-workbench-productization.md`
- `reviews/TASK-008-review-1.md`

Do not modify:

- `src-tauri/**`
- `src/agent/service.ts`
- `src/agent/useAgentSession.ts`
- `src/workspace/**`
- OVE/editor/file-format modules
- parent-directory files

## Required Implementation

1. Rename the panel experience from generic `Agent` to `Cloning Agent`.
2. Show a compact current-vector summary when a document is loaded:
   - name
   - length in bp
   - circular or linear
   - feature count
3. When no document is loaded, show a clear blocked context state telling the
   user to open a GenBank/Fasta/vector file first.
4. Replace `No conversation yet` with task launcher buttons:
   - clone insert into current vector
   - design Gibson or homologous-arm primers
   - check construct risks
   The buttons should send useful starter prompts through the existing
   `sendMessage` path, not bypass the Agent service.
5. Add an Agent workflow rail with stages:
   - Read vector
   - Collect insert
   - Plan
   - Run tools
   - Review patch
   Stage state should reflect available local state where possible.
6. Make the execution button read as a tool call, for example
   `Run molecular design`.
7. Make results feel like an actionable recommendation rather than a raw count.
8. Keep all existing patch preview/apply/reject safeguards intact.

## Acceptance Criteria

- With a loaded document and no conversation, the panel visibly says
  `Cloning Agent` and shows current vector context.
- Empty state has task launcher buttons instead of `No conversation yet`.
- Clicking a task launcher calls `sendMessage` with the loaded document.
- With no loaded document, the panel tells the user to open a sequence file and
  does not offer task launch buttons.
- A ready plan shows a clear workflow and a `Run molecular design` button.
- Offline/starting states remain visible and recoverable.
- Existing patch preview and revert flows still pass their tests.
- The panel remains scrollable and composer reachable at 720x480.

## Verification Commands

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

Also perform one browser/Tauri visual smoke check at a compact viewport.

## Self-Review Checklist

- Check every acceptance criterion once after the final edit.
- Confirm all changed files are allowed by this task.
- Confirm no service or patch safety behavior was weakened.
- Confirm failures and incomplete work are reported, not hidden.
