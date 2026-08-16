# TASK-011: Agent Workspace Routing

Status: accepted

Accepted review: `reviews/TASK-011-review-1.md`

## Objective

Expose the backend Agent workspaces in the desktop Agent sidebar and route chat
and execute requests to the selected workspace.

This is the first step toward bringing the original demo capabilities into the
local editor. Keep it focused on workspace selection and request routing. Do not
build specialized result cards for every design type yet.

## Context

The Python service already supports Agent workspaces:

- `cloning`
- `rtqpcr`
- `sgrna`
- `sirna`
- `mutagenesis`

The desktop app currently hard-codes `workspace: "cloning"` in the frontend
request types, snapshots, `sendMessage`, and `executeDesign`. That prevents the
Agent panel from using the existing RT-qPCR, sgRNA, siRNA, and mutagenesis
service flows.

## Product Invariants

- The Agent never automatically executes a design.
- `Run molecular design` remains an explicit user action.
- TASK-005 preview/apply/reject remains the only sequence edit path.
- Do not change Python service behavior.
- Do not silently use the open vector as the cloning insert.
- For non-cloning workspaces, the current open sequence may be sent as target
  context, but user message and backend inference remain authoritative.
- No specialized biological result fields should be invented client-side.

## In Scope

- Add a frontend `AgentWorkspace` union type.
- Allow the Agent panel to select:
  - Molecular cloning
  - RT-qPCR
  - sgRNA
  - siRNA
  - Point mutation
- Show workspace-specific starter prompts.
- Route `planAgentTask` and `executeAgentTask` requests with the selected or
  response draft workspace.
- Build snapshots with a workspace-aware `lastWorkbenchPage` and `formState`
  entries needed by the backend.
- Keep current cloning behavior intact.
- Tests for workspace selection, request routing, and snapshot shape.

## Out of Scope

- Python service changes.
- Streaming endpoints.
- Confirmation UI for ambiguous transcript/target options.
- Specialized RT-qPCR / sgRNA / siRNA / mutagenesis result cards.
- Copy/export actions for non-cloning results.
- OVE/editor/file-format changes.
- Sequence patch schema changes.

## Allowed Files

- `src/agent/service.ts`
- `src/agent/service.test.ts`
- `src/agent/useAgentSession.ts`
- `src/agent/useAgentSession.test.ts`
- `src/components/AgentPanel.tsx`
- `src/components/AgentPanel.test.tsx`
- `src/App.css`
- `tasks/TASK-011-agent-workspace-routing.md`
- `reviews/TASK-011-review-1.md`

Do not modify:

- `src-tauri/**`
- `src/editor/**`
- `src/workspace/**`
- parent `../server.py`
- parent static demo files

## Required Implementation

1. Define an `AgentWorkspace` type:
   - `cloning`
   - `rtqpcr`
   - `sgrna`
   - `sirna`
   - `mutagenesis`

2. Update service request types.
   - `AgentChatRequest.workspace` uses `AgentWorkspace`.
   - `AgentExecuteRequest.workspace` uses `AgentWorkspace`.
   - `AgentSnapshot.lastWorkbenchPage` uses `AgentWorkspace`.

3. Make `buildDocumentSnapshot` workspace-aware.
   - Signature should accept the workspace, defaulting to `cloning`.
   - Preserve the existing cloning vector context exactly.
   - Include these `formState` entries so the backend can use existing tools:
     - `cloning`: current vector sequence/topology/label
     - `custom`: `{ sequence: current sequence, label: document name }`
     - `sg`: `{ sequence: current sequence, label: document name, mode: "ko", pamSet: "spcas9_ngg" }`
     - `sirna`: `{ sequence: current sequence, label: document name, duplexLength: 21, overhangMode: "dtdt" }`
     - `mutation`: `{ sequence: current sequence, label: document name, mode: "dna", cdsStart: "1" }`
     - `rt`: `{ query: "", species: "Homo sapiens", strain: "", gdnaCheck: true, includeProbe: false }`
   - For an empty/no-doc snapshot, include the same keys with empty sequence/label.

4. Update `useAgentSession`.
   - `sendMessage` accepts a workspace argument, default `cloning`.
   - `executeDesign` accepts a workspace argument, default `cloning`.
   - Planning request uses the selected workspace.
   - Execution request should prefer `response.draft.workspace` when present,
     then selected workspace.
   - Store or preserve response `workspace` as needed so execution does not
     accidentally fall back to cloning after planning another workspace.

5. Update `AgentPanel`.
   - Add a compact workspace selector near the panel top.
   - Use clear labels:
     - Molecular cloning
     - RT-qPCR
     - sgRNA
     - siRNA
     - Point mutation
   - Starter prompts should change with workspace:
     - cloning: keep current cloning prompts.
     - rtqpcr: design RT-qPCR primers, include optional probe, check primer quality.
     - sgrna: design KO sgRNAs, design KI sgRNAs, check guide risks.
     - sirna: design siRNA duplexes, prefer shared isoform region, check seed risk.
     - mutagenesis: design DNA point mutation primers, design amino-acid mutation primers, check mutation setup.
   - The input placeholder should mention the selected workspace.
   - Existing collapse/expand behavior must continue working.

6. Tests.
   - `buildDocumentSnapshot(doc, "sgrna")` sets `lastWorkbenchPage: "sgrna"` and includes `formState.sg.sequence`.
   - `buildDocumentSnapshot(doc, "rtqpcr")` includes `formState.custom.sequence` and `formState.rt.gdnaCheck`.
   - `planAgentTask` can send `workspace: "sirna"`.
   - `executeAgentTask` can send `workspace: "mutagenesis"`.
   - `useAgentSession.sendMessage(..., "sgrna")` calls `planAgentTask` with `workspace: "sgrna"`.
   - After planning with a draft that has `workspace: "rtqpcr"`, `executeDesign(..., "cloning")` still calls `executeAgentTask` with `workspace: "rtqpcr"`.
   - `AgentPanel` renders workspace selector options and selecting RT-qPCR changes starter prompts.

## Acceptance Criteria

- User can select RT-qPCR, sgRNA, siRNA, or Point mutation in the Agent panel.
- Sending a message from that selection posts the matching workspace.
- Executing a ready plan uses the planned workspace, not always cloning.
- Cloning behavior and tests remain intact.
- No new automatic execution path is added.

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
- Confirm no backend service or editor/file-format code changed.
- Confirm `workspace: "cloning"` still works as before.
- Confirm non-cloning workspace requests do not silently create sequence patches.
- Confirm failures and incomplete work are reported.

## Delivery Contract

Claude returns only the structured report requested by the orchestration
script. Keep paths and risk descriptions short; do not write a narrative
implementation summary.
