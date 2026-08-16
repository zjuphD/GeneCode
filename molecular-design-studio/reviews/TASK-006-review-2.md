# TASK-006 Review 2

Status: changes requested

## Findings

### P0: Failed replanning can re-enable a stale executable draft

`src/agent/useAgentSession.ts`

`sendMessage()` leaves the prior plan, draft, readiness, run log, and result
summary in state while a new plan request runs. If the new request fails,
`handleRequestError()` returns to `idle`, so the old `readyToExecute` and draft
become executable again under the new `lastUserGoal`.

At the start of every new planning request:

- clear prior plan/draft/readiness/run log/result/recommendation/patch state
- retain conversation
- append the new user message

Add a regression test:

1. first plan returns a ready draft
2. second plan rejects
3. the second user message and error remain visible
4. draft is null and `readyToExecute` is false
5. `executeDesign()` does nothing

### P0: Context invalidation does not reliably ignore late responses

`src/agent/useAgentSession.ts`

The hook aborts the current controller when the document changes, but an async
service implementation can still resolve after abort. The `.then()` handlers
only check `mountedRef`, so a late plan/execute response can restore stale state
after invalidation.

Use a monotonically increasing request/generation token. Starting a request
captures the token; clear, context invalidation, and unmount invalidate it.
Both success and failure handlers must return without updating state when the
token is stale.

Also suppress the expected cancellation error after context invalidation. It
must not appear as `Planning request timed out` or `Execution request timed
out`.

Add deferred-promise tests for late plan and late execute responses after a
document hash change.

### P1: Abort and timeout behavior is still untested and caller abort is
reported as timeout

`src/agent/service.ts`
`src/agent/service.test.ts`

The timeout controller is now real, but the required fake-timer timeout and
caller-abort tests are absent. Any `AbortError` is currently labeled as a
timeout, including deliberate caller cancellation.

Track whether the internal timeout fired. Report `Request timed out` only for
that case; preserve a distinct cancellation error or code for caller aborts so
the session hook can ignore expected cancellation.

Add tests for:

- timeout aborts a pending fetch
- caller signal aborts a pending fetch before timeout
- cleanup prevents a later timeout after success

### P1: `{ok:false}` can still be normalized as success

`src/agent/responseTypes.ts`

An envelope such as `{ok:false, error:"bad", meta:{}}` passes the expected-field
check because `meta` is an object. Reject `ok === false` first and surface the
safe error string.

### P2: Completed execute plan is not reflected in the UI

`src/agent/useAgentSession.ts`

The live execute response contains a completed `plan`, but
`applyExecuteResponse()` does not replace the planning-stage rows. The verified
UI therefore shows `pending` plan rows above a completed run log.

When execute returns a non-empty normalized plan, store it so statuses become
completed. Add a focused test.

### P2: Hook tests emit repeated React `act(...)` warnings

`src/agent/useAgentSession.test.ts`

The suite passes but emits warnings for nearly every health-driven state
update, making real async regressions harder to spot. Adjust the setup/waits so
the final test run has no React act warnings.

## Live Verification Already Passed

Against `http://127.0.0.1:8000` at 720x480:

- health displayed `已连接 MiniMax · MiniMax-M2.7`
- first chat requested missing insert while showing a vector parse step
- a second message with insert and Gibson homologies produced a ready plan
- execution did not start until `Run design` was clicked
- execution returned 5 deterministic results, run log, recommendation, risk,
  confidence, and completed run metadata
- the composer was reachable by scrolling the Agent body

Preserve these behaviors.

## Required Verification

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri:build
```
