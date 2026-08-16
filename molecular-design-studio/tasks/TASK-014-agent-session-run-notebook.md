# TASK-014: Agent Session Run Notebook

Status: accepted

Accepted review: `reviews/TASK-014-review-1.md`

## Objective

Add a lightweight current-session run notebook to the Agent sidebar.

TASK-013 made completed results copyable, but the product still feels fragile
because the latest run is the only visible result. A user should be able to
complete several Agent runs in one working session and still see a compact list
of recent outputs with copyable notes.

This is an in-memory session notebook only. Do not add persistence yet.

## Context

Current behavior:

- The Agent shows the active recommendation/result card.
- `Copy primer order table`, `Copy result table`, and `Copy run note` provide
  immediate next actions.
- Once the active result changes or a new task starts, prior output is no longer
  visible in the sidebar.

Desired behavior:

- After a successful execute response with meaningful result content, record a
  compact run entry in the sidebar.
- Show recent run entries below the active result area.
- Each entry should make it clear what workspace/goal/result it came from.
- Each entry should support copying a concise run note.

## Product Invariants

- The Agent never automatically executes a design.
- `Run molecular design` remains an explicit user action.
- Sequence edits still flow only through the existing preview/apply/reject path.
- Do not invent biological sequences or coordinates client-side.
- Do not persist run history to disk or localStorage in this task.
- Do not add a new top-level feature button for every design mode.

## In Scope

- Add an in-memory recent-run notebook to `AgentPanel`.
- Record a run only after meaningful result content appears:
  - recommendation, candidates, result count, run log, or run id/status.
- Include in each record:
  - stable record id
  - timestamp or short time label
  - workspace
  - user goal when available
  - run id/status when available
  - recommendation title when available
  - top candidate title when available
  - result count when available
  - enough data to reuse the existing run-note copy text
- Limit the list to a small number, for example 5 recent runs.
- Avoid duplicate entries during re-renders.
- Add a compact `Recent runs` UI under the active results.
- Add a small clear-history action if useful, but keep it visually quiet.
- Tests for recording, deduplication, list limit, copy note, and clearing.

## Out of Scope

- Backend/Python changes.
- `useAgentSession` architecture changes unless absolutely necessary.
- Persistent storage.
- Exporting files to disk.
- Search/filter over historical runs.
- Multi-candidate comparison UI.
- OVE/editor/file-format changes.
- Tauri packaging changes.

## Allowed Files

- `src/components/AgentPanel.tsx`
- `src/components/AgentPanel.test.tsx`
- `src/App.css`
- `tasks/TASK-014-agent-session-run-notebook.md`
- `reviews/TASK-014-review-1.md`

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

1. Add a local `RunNotebookEntry` model inside `AgentPanel.tsx`.
   - Keep it UI-facing and serializable.
   - It can store recommendation/candidates/run metadata needed by
     `buildRunNoteText`.

2. Record successful completed-result states.
   - Use `useEffect` in `AgentPanel` to watch relevant session result fields.
   - Only record when `session.phase === "idle"` and there is meaningful result
     content.
   - Use a stable dedupe key so rerenders do not append the same run repeatedly.
   - Prefer `agentRun.runId` in the key when available; otherwise derive a key
     from workspace, goal, recommendation title, top candidate title, and result
     count.

3. Keep the notebook compact.
   - Most recent first.
   - Limit to 5 entries.
   - Display only short text:
     - workspace label
     - goal or fallback title
     - recommendation/top candidate/result count
     - run status/id when available
   - Long text must wrap inside the 320px sidebar.

4. Add copy support for each notebook entry.
   - Reuse the existing copy action pattern where possible.
   - The copied note should use the same run-note structure as the active
     result.

5. Clear behavior.
   - Add a quiet `Clear` action inside `Recent runs` if the notebook has entries.
   - Clearing recent runs should not clear the active conversation, plan, or
     current result.

6. Tests.
   - A completed result adds one recent run entry.
   - Rerendering the same result does not duplicate the entry.
   - New completed results prepend and the list caps at 5.
   - The notebook copy action writes a run note.
   - Clearing recent runs removes notebook entries without calling
     `session.clearSession`.
   - No notebook entry is shown before meaningful result content exists.

## Acceptance Criteria

- A user can see recent Agent runs in the sidebar after completing multiple
  design runs.
- The notebook does not duplicate entries on rerender.
- A recent run note can be copied.
- Clearing recent runs is separate from clearing the Agent conversation.
- Existing result-card copy actions continue to work.

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
- Confirm notebook entries are in-memory only.
- Confirm no duplicate entries appear on rerender.
- Confirm failures and incomplete work are reported.

## Delivery Contract

Claude returns only the structured report requested by the orchestration
script. Keep paths and risk descriptions short; do not write a narrative
implementation summary.
