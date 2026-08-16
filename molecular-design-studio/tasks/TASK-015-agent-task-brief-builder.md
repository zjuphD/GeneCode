# TASK-015: Agent Task Brief Builder

Status: accepted

Accepted review: `reviews/TASK-015-review-1.md`

## Objective

Make Agent task initiation usable by adding a compact task brief builder.

The current Agent sidebar has workspace selection and example prompts, but a real
user still has to invent a complete prompt from scratch. This task should add a
small structured brief area that helps the user describe the design goal,
target/input, and constraints, then sends a well-formed message to the Agent.

This is a frontend-only usability step. Do not change backend behavior.

## Context

Accepted recent tasks:

- TASK-011: workspace routing.
- TASK-012: non-cloning result cards.
- TASK-013: copyable result table/run note.
- TASK-014: in-memory recent-run notebook.

What is still weak:

- Starting an Agent task still depends too much on user prompt-writing skill.
- Example prompts are helpful but not enough for real use.
- The Agent should feel like it has a guided intake step, not only a chat box.

## Product Invariants

- The Agent never automatically executes a design.
- `Run molecular design` remains an explicit user action.
- Sequence edits still flow only through the existing preview/apply/reject path.
- Do not invent biological sequences or coordinates client-side.
- Do not add backend, persistence, analytics, or cloud calls.
- Do not add one top-level button for every feature.

## In Scope

- Add a compact `Task brief` UI in the Agent sidebar.
- The brief should be workspace-aware.
- The user can enter:
  - goal / desired outcome
  - target or input description
  - constraints / notes
- Include a lightweight current-sequence context line when a document is open.
- Generate a clear prompt from the brief and send it through the existing
  `sendMessage` path with the selected workspace.
- Keep existing example prompts and chat composer working.
- Reset or preserve brief fields in a sensible way when workspace changes.
- Tests for generated prompt content and routing.

## Out of Scope

- Backend/Python changes.
- `useAgentSession` changes.
- Service request schema changes.
- Persistent task templates.
- Full form validation for every biological workflow.
- File export.
- Editor/OVE changes.
- Tauri packaging changes.

## Allowed Files

- `src/components/AgentPanel.tsx`
- `src/components/AgentPanel.test.tsx`
- `src/App.css`
- `tasks/TASK-015-agent-task-brief-builder.md`
- `reviews/TASK-015-review-1.md`

Do not modify:

- `src/agent/service.ts`
- `src/agent/useAgentSession.ts`
- `src/agent/responseTypes.ts`
- `src-tauri/**`
- `src/editor/**`
- `src/workspace/**`
- parent `../server.py`
- parent static demo files

## Required Implementation

1. Add a local brief state model in `AgentPanel`.
   - Track at least `goal`, `target`, and `constraints`.
   - Keep state local to the panel.
   - No persistence.

2. Add workspace-aware brief labels/placeholders.
   - Cloning should mention insert/vector/assembly goal.
   - RT-qPCR should mention gene/accession/species/amplicon/probe constraints.
   - sgRNA should mention KO/KI/edit region/PAM.
   - siRNA should mention transcript/species/isoform/seed risk constraints.
   - Mutagenesis should mention mutation, position, reference/alternate, CDS.

3. Generate a deterministic Agent prompt.
   - Include workspace label.
   - Include current document name, length, and topology when present.
   - Include goal, target/input, and constraints only when non-empty.
   - If all brief fields are empty, do not send.
   - The prompt should ask the Agent to identify missing information before
     planning or execution.

4. Add a `Send brief to Agent` action.
   - It calls the same `handleSend` path as examples and chat composer.
   - It must pass the selected workspace.
   - It is disabled while busy or when all brief fields are blank.
   - After sending, clear the brief fields or clear only the user-entered fields;
     choose the simplest behavior and cover it in tests.

5. Keep UI compact.
   - The brief builder should not dominate the sidebar.
   - Avoid nested cards.
   - Use small labels and textarea/input controls that wrap correctly in 320px.
   - Do not remove existing example prompts or normal chat input.

6. Tests.
   - Brief builder renders when Agent is online and a document is open.
   - `Send brief to Agent` is disabled when all fields are empty.
   - Filling goal/target/constraints sends a prompt containing all fields,
     document context, workspace label, and missing-information instruction.
   - Workspace selection changes brief placeholders/labels.
   - Sending an sgRNA brief routes `workspace: "sgrna"`.
   - Brief fields clear after send.
   - Existing example prompt and composer tests still pass.

## Acceptance Criteria

- A user can start a meaningful Agent task without writing a full prompt from
  scratch.
- The generated prompt is clear enough for the backend Agent to plan or ask for
  missing information.
- Workspace routing remains correct.
- Existing Agent result, notebook, copy, and patch flows are not regressed.

## Verification Commands

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

## Self-Review Checklist

- Confirm changed files are within the allowed list.
- Confirm no backend, service, hook, editor, workspace, or Tauri files changed.
- Confirm empty brief does not send.
- Confirm brief send uses selected workspace.
- Confirm UI remains compact.
- Confirm failures and incomplete work are reported.

## Delivery Contract

Claude returns only the structured report requested by the orchestration
script. Keep paths and risk descriptions short; do not write a narrative
implementation summary.
