# TASK-006 Review 3

Status: changes requested

## Blocking Verification Failure

Independent `npm test -- --run` exits with code 1:

```text
Test Files  15 passed (15)
Tests       317 passed (317)
Errors      3 errors
```

The three errors are unhandled timeout rejections from
`src/agent/service.test.ts`. The hook suite also still emits repeated React
`act(...)` warnings.

### Fix timeout test rejection timing

`src/agent/service.test.ts`

Attach the rejection observer before advancing fake timers. Do not allow the
promise to reject for a tick before `expect(...).rejects` is attached.

One reliable pattern is:

```ts
const observed = promise.catch((error: unknown) => error);
await vi.advanceTimersByTimeAsync(31_000);
const error = await observed;
expect(error).toBeInstanceOf(AgentServiceError);
expect((error as Error).message).toContain("timed out");
```

Use one observer per promise. Do not attach two delayed `rejects` assertions to
the same already-rejected promise.

### Remove React act warnings

`src/agent/useAgentSession.test.ts`

The health mock resolves after render and updates hook state outside `act`.
Make the shared online/offline settling helpers flush the health promise and
state update inside `act`, then use those helpers consistently. The final test
run must not print React act warnings.

## Required Result

Run:

```bash
npm test -- --run
```

It must exit 0 with:

- no Vitest unhandled errors
- no `PromiseRejectionHandledWarning`
- no React `act(...)` warnings

Then rerun all TASK-006 verification commands.
