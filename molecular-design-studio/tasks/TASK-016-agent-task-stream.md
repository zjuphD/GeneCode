# TASK-016: Agent Task Stream

Status: accepted

Accepted review: `reviews/TASK-016-review-1.md`

## Objective

Replace the explanatory Agent sidebar with a single task-driven Agent surface.

The panel should behave like an execution workspace: one objective, a live task
tree, visible tool progress, inline results/review, and one persistent command
composer. It must reuse the existing session and execution state and must not
pretend that a biological step or tool call completed when the application has
no evidence for it.

This is a frontend information-architecture task. Do not change backend
behavior or response contracts.

## Context

The accepted TASK-015 task brief builder made task intake more structured, but
the resulting panel now reads as a form plus help content. The desired product
direction is closer to a modern Agent run surface:

- the user establishes a goal through one composer;
- the Agent shows the current task as a compact state tree;
- the active step contains the relevant response, action, or result;
- tool execution is visible inside the task flow;
- review/apply/reject/revert remain explicit and safe.

The current frontend already exposes the state needed for this first pass:

- `messages`
- `plan`
- `phase`
- `runLog`
- `readyToExecute` and `draft`
- `recommendation`, `candidates`, and `agentRun`
- `pendingPreview` and `revertDocument`

## Product Invariants

- The composer is the only free-text input surface in the Agent panel.
- The Agent never automatically executes a molecular design.
- `Run molecular design` remains an explicit user action.
- Sequence edits still flow only through preview/apply/reject.
- Applied changes remain reversible through the existing revert action.
- Never infer a completed tool call from assistant prose.
- Never infer that an insert, target, MCS, accession, or biological parameter is
  present unless it exists in current structured frontend state.
- Do not add buttons whose actions are not implemented.
- Do not add one top-level button for every molecular workflow.

## In Scope

- Replace the task brief, example-prompt card list, workflow rail, separate
  conversation box, plan table, and run-log table with one task stream.
- Preserve workspace routing through the existing workspace selector.
- Derive task-node status from real session state using small pure helper
  functions.
- Show the current objective from `lastUserGoal` when available.
- Show document context compactly without treating the open vector as the
  insert or target.
- Render assistant/user messages as compact activity within the task stream,
  not as a second chat application.
- Render plan and tool activity as task nodes with explicit status.
- Place results, patch review, and revert actions in the same continuous task
  stream.
- Keep one composer anchored at the bottom of the expanded panel.
- Add a compact wide/narrow panel control so complex runs can be inspected
  without opening another page.
- Update tests for the new information architecture and interactions.

## Out of Scope

- Python/backend changes.
- Agent response schema changes.
- Parsing assistant prose to discover required biological inputs.
- New upload, project-picker, sequence-picker, or clipboard-import workflows.
- New deterministic biology tools.
- Persistence of sessions or panel width.
- Editor/OVE changes.
- Tauri packaging changes.
- Redesigning result-card internals or patch validation rules.

## Allowed Files

- `src/components/AgentPanel.tsx`
- `src/components/AgentPanel.test.tsx`
- `src/App.css`
- `tasks/TASK-016-agent-task-stream.md`
- `reviews/TASK-016-review-1.md`

Do not modify:

- `src/agent/service.ts`
- `src/agent/useAgentSession.ts`
- `src/agent/responseTypes.ts`
- `src/components/PatchPreview.tsx`
- `src-tauri/**`
- `src/editor/**`
- `src/workspace/**`
- parent `../server.py`
- parent static demo files

## Required Implementation

1. Remove the duplicate intake surfaces.
   - Remove `TaskBrief`, its local state/configuration, and generated brief
     prompt.
   - Remove the standalone `PromptSuggestions` card list.
   - Remove the separate workflow rail, conversation box, plan table, and run
     log table from the rendered panel.
   - Keep the existing composer as the only free-text input.
   - Optional starter actions may appear as small inline chips beside the empty
     task state, but they must call the existing `handleSend` path and must not
     become a second card grid or form.

2. Add a pure task-stream view model.
   - Derive a compact objective and ordered task nodes from current props and
     `useAgentSession` state.
   - Use a small explicit node status type such as `done`, `active`, `waiting`,
     `blocked`, and `review`.
   - Map `phase === "planning"` and `phase === "executing"` to visible active
     states.
   - Map plan rows and run-log rows using their structured status fields.
   - Treat unknown status strings conservatively as waiting/neutral.
   - A loaded document may mark only document context as available. It must not
     imply that an insert, target, MCS, or tool result exists.
   - Do not inspect message text to mark scientific/tool steps complete.

3. Build one continuous Agent task stream.
   - Header: Agent identity, service state, clear-session, wide/narrow, and
     collapse controls.
   - Context: selected workspace and compact open-document metadata.
   - Objective: `lastUserGoal` when present; otherwise a short neutral prompt
     to start a task.
   - Task tree: document context, planning, tool execution, results, and review
     appear in chronological order as applicable.
   - Use stable row dimensions and restrained styling; avoid nested cards.
   - Keep labels readable at 320 px and in wide mode.

4. Put content inside the relevant task node.
   - Recent user and assistant messages appear as compact activity under the
     planning/current node. Preserve all messages, but allow older activity to
     be visually quieter.
   - `plan` rows appear as child task rows, with label, tool, status, and summary
     when present.
   - `runLog` rows appear as tool activity, with status and message.
   - Existing recommendation/candidate/result content appears in the result
     portion of the stream.
   - `pendingPreview` appears as the review node and keeps the existing
     acknowledgement/apply/reject behavior.
   - `revertDocument` appears after apply with the existing revert action.
   - Errors appear next to the current run state and remain dismissible.

5. Make the next action unambiguous and real.
   - Before a goal exists, the composer is the primary action.
   - While planning/executing, show a busy state and disable conflicting sends.
   - When `readyToExecute && draft`, show the existing explicit run action in
     the active task node.
   - When a preview exists, Apply and Reject are the next actions.
   - Do not render Paste/Upload/Project actions because those workflows are not
     implemented in this task.

6. Keep the composer persistent.
   - The task stream scrolls independently.
   - The composer remains visible at the bottom of the expanded panel.
   - Preserve Enter-to-send, Shift+Enter newline, busy/online/document disabled
     behavior, workspace-aware placeholder, and selected-workspace routing.
   - Do not render a second follow-up or chat input anywhere else.

7. Add wide/narrow inspection mode.
   - Default width remains compatible with the current layout.
   - Add one familiar icon control with a tooltip/accessible label to toggle a
     wider Agent panel.
   - Wide mode must not break collapse/expand behavior.
   - At typical desktop widths the editor must remain usable and the Agent must
     not overflow horizontally.

8. Tests.
   - Empty state shows one objective/start state and one composer, with no task
     brief form or separate conversation box.
   - A loaded document is shown as context but does not claim insert/target/MCS
     completion.
   - Planning and executing phases render an active task state.
   - Structured plan and run-log statuses render in the task tree.
   - Unknown statuses do not render as completed.
   - Ready draft exposes the explicit run action and routes the selected
     workspace.
   - Pending preview keeps Apply/Reject behavior and warning acknowledgement.
   - Revert behavior remains available after apply.
   - Composer routing and keyboard behavior remain covered.
   - Collapse/expand and wide/narrow controls work together.
   - Offline/retry and error-dismiss behavior remain covered.

## Acceptance Criteria

- The Agent panel reads as one task run, not a collection of forms and help
  cards.
- There is exactly one free-text composer.
- The current objective, progress, tool activity, results, and review are
  understandable without separate Plan/Run/Visible Work sections.
- No task or tool is marked complete without structured frontend evidence.
- Existing execution, result, patch safety, workspace routing, and revert paths
  continue working.
- The panel has no horizontal overflow at its default and wide widths.

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
- Confirm task brief and duplicate input surfaces are gone.
- Confirm one and only one textarea is rendered in the online expanded panel.
- Confirm no message-text parsing is used for completion state.
- Confirm no unimplemented action button was added.
- Confirm unknown statuses are conservative.
- Confirm patch apply/reject/revert safety remains unchanged.
- Confirm all failures and incomplete work are reported.

## Delivery Contract

Claude returns only the structured report requested by the orchestration
script. Keep paths and risk descriptions short; do not write a narrative
implementation summary.
