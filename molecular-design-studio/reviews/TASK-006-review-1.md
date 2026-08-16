# TASK-006 Review 1

Status: changes requested

## Findings

### P0: The client does not implement the real local service contract

`src/agent/responseTypes.ts`
`src/agent/service.ts`

The live health endpoint returns:

```json
{"ok": true, "llm": {"message": "已连接 MiniMax · MiniMax-M2.7"}}
```

`normalizeAgentHealth()` only accepts a string `status`, so the running service
is shown as offline.

Chat and execute currently send a top-level `document`. The existing service
reads `snapshot.formState.cloning`, so the current sequence is not received as
vector context. Build and send the task-specified payload:

```text
snapshot.lastWorkbenchPage = cloning
snapshot.currentSequenceDocument = canonical document summary
snapshot.formState.cloning.vectorSequence = current sequence
snapshot.formState.cloning.vectorTopology = circular|linear
snapshot.formState.cloning.vectorLabel = document name
```

Execute must send the same snapshot plus the exact retained draft, message,
history, workspace, run mode, and run ID.

Add client tests that assert the serialized request body. Also test the actual
health envelope shape.

### P0: Service patches are retained but never enter TASK-005 validation

`src/agent/useAgentSession.ts`
`src/components/AgentPanel.tsx`
`src/App.tsx`

`sequencePatch` is stored in session state but nothing calls
`onLoadPreview()`. A top-level or `meta.sequencePatch` therefore has no effect.

Hand the value to `workspace.loadPatchPreview()` exactly as `unknown`, once per
new response patch. Change the integration prop away from `SequencePatch` if
needed. Do not cast, clone, or transform the service value. Add tests proving:

- the exact object identity reaches the handoff callback
- an invalid patch becomes the existing disabled error preview
- no patch is applied automatically

### P0: Context invalidation is not wired

`src/agent/useAgentSession.ts`
`src/components/AgentPanel.tsx`

`invalidateContext()` and `onContextInvalidate` are unused. A draft created for
one document remains executable after OVE commits or another file is opened.

Wire invalidation to canonical document content changes. A fingerprint-based
effect is acceptable: ignore the initial document load, and when the hash
changes clear draft/plan/results/patch while preserving conversation and adding
one context-change notice. Abort an in-flight plan/execute request so its late
response cannot restore stale state. Add hook/integration tests.

### P1: Timeout logic never aborts a request

`src/agent/service.ts`

Every timeout is `setTimeout(() => {}, REQUEST_TIMEOUT_MS)`. It does nothing.
Create one request controller, abort it when the timeout fires, and forward a
caller abort into it. Remove caller listeners when the request settles.
Distinguish a timeout from a caller cancellation where useful. Add fake-timer
tests for timeout and caller abort.

### P1: Real response result metadata is normalized from the wrong paths

`src/agent/responseTypes.ts`

The current service returns:

- LLM status at `meta.llm`
- run metadata at `meta.agentRun`
- recommendation at
  `meta.agentRun.recommendationPackage.recommendation`
- risk items at
  `meta.agentRun.recommendationPackage.risk.items`
- confidence score at
  `meta.agentRun.recommendationPackage.confidence.score`
- deterministic results at `design.results`

The implementation instead looks for `meta.llmStatus`, `meta.recommendation`,
`meta.resultCount`, and treats confidence as a 0-1 fraction. Normalize the live
shape while retaining conservative fallbacks. Confidence is already a
percentage score such as `77`; do not multiply it by 100.

Add fixture-based tests for a realistic chat response and execute response.

### P1: Run design ignores the backend readiness flag

`src/agent/useAgentSession.ts`
`src/components/AgentPanel.tsx`

The normalized `readyToExecute` value is discarded. The UI passes
`session.draft !== null` as readiness, so any plain-object draft can expose the
execution command even if the service says inputs are incomplete.

Store readiness in session state and require both `readyToExecute === true` and
a valid draft. Reset readiness after execute, clear, context invalidation, and
failed/replaced plans.

### P1: Malformed success envelopes are silently accepted

`src/agent/service.ts`
`src/agent/responseTypes.ts`

A JSON `{}` or primitive response becomes an empty successful plan. Reject
non-object payloads, `{ok:false}`, and envelopes that contain none of the
expected Agent response fields. Use the safe service `error` string when
available.

### P1: Required client and session tests are missing

Only `AgentPanel.test.tsx` changed, and it mocks `useAgentSession`. There are no
tests for:

- URL normalization
- health parsing
- timeout/abort
- request snapshot/body
- runtime response normalization
- planning state
- explicit execution
- patch handoff
- context invalidation

Add focused `service`, `responseTypes`, and `useAgentSession` tests. Do not
count mocked component tests as coverage of these boundaries.

### P1: Minimum-window scrolling is incomplete

`src/App.css`

`.agent-panel` has `overflow: hidden` and `.agent-body` still has visible
overflow. A long plan/result can clip the composer at 720x480.

Make the body vertically scrollable with `min-height: 0`, prevent horizontal
overflow, and make table cells/tool names wrap. Verify the composer and action
controls can be reached at 720x480.

## Required Verification

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri:build
```

Also perform one live check against `http://127.0.0.1:8000`:

- health shows online
- a chat request returns an assistant message
- the current document is present under vector context
- no design executes until `Run design` is clicked
