# TASK-006: Local Agent Service Conversation and Execution

Status: accepted

Accepted review: `reviews/TASK-006-review-4.md`

## Objective

Connect the desktop workspace to the existing local Python Agent service and
turn the right sidebar into a real, recoverable molecular-cloning conversation
workflow.

The user can describe a cloning goal, review the returned plan, explicitly run
the deterministic design tools, inspect the result summary, and preview any
structured sequence patch supplied by the service through the TASK-005 safety
boundary.

## Context

The parent Primer Design Studio service already exposes:

- `GET /api/health`
- `POST /api/agent/chat`
- `POST /api/agent/execute`

The service normally runs at `http://127.0.0.1:8000`. It returns Agent
messages, a plan, a draft, run logs, recommendation metadata, and deterministic
design results. It does not currently guarantee that every response contains a
sequence patch.

TASK-005 established the only allowed sequence-change path:

1. receive unknown JSON
2. normalize and validate a `SequencePatch`
3. show a preview
4. require explicit user confirmation
5. re-check the document hash before application

Do not bypass or weaken that path.

## Product Invariants

- The current sequence document is context, not permission to modify it.
- Chat and design execution never write to OVE or disk.
- Planning never automatically starts design execution.
- Design execution never automatically applies a sequence patch.
- Service responses are untrusted JSON and require runtime normalization.
- Biological results come from the deterministic Python tools, not from
  client-side invention.
- The application remains usable when the local Agent service is offline.

## In Scope

- local Agent HTTP client with health, chat, and execute calls
- configurable service base URL with a localhost default
- runtime-normalized Agent response view models
- current-document snapshot sent as cloning context
- compact multi-turn conversation state
- returned plan and run-log display
- explicit design execution command
- result/recommendation summary
- online/offline/busy/error states
- optional structured patch handoff to TASK-005 validation
- focused client, state, and component tests

## Out of Scope

- starting, stopping, or packaging the Python sidecar
- changing the parent Primer Design Studio project or `server.py`
- SSE streaming
- provider/API-key settings
- SQLite or durable conversation history
- multi-workspace routing UI
- RT-qPCR, sgRNA, siRNA, or mutagenesis-specific result views
- converting primer/design results into a sequence patch in the client
- inventing cloning coordinates or final construct sequences
- automatic execution or automatic patch application

## Allowed Files

- `src/App.tsx`
- `src/App.css`
- `src/agent/**`
- `src/workspace/**` only if a narrow integration prop is needed
- `src/components/AgentPanel.tsx`
- `src/components/AgentPanel.test.tsx`
- `src/components/PatchPreview.tsx` only if composition requires it
- `src/types/ambient.d.ts` only for Vite environment typing
- `README.md` only for a short local-service note

Do not modify:

- `src-tauri/**`
- OVE/editor/file-format modules
- dependency versions
- the GenBank fixture
- Sidebar or QC behavior
- parent-directory files

## Service Configuration

Create one client-owned base URL resolver:

1. use trimmed `VITE_AGENT_API_BASE` when provided
2. otherwise use `http://127.0.0.1:8000`
3. remove trailing slashes before joining routes

Do not read configuration from arbitrary globals. Do not persist credentials.

## HTTP Client

Create a narrow service module with functions equivalent to:

```ts
checkAgentHealth(signal?): Promise<AgentHealth>
planAgentTask(request, signal?): Promise<AgentResponse>
executeAgentTask(request, signal?): Promise<AgentResponse>
```

Requirements:

- JSON `Accept` and `Content-Type` headers where appropriate
- bounded request timeout using `AbortController`
- caller signal support without losing timeout cancellation
- check `response.ok`
- reject non-JSON or malformed envelopes with a concrete user-facing error
- prefer the service's safe `error` string when present
- never expose stack traces, raw HTML, or response dumps in the UI
- never retry a design execution automatically

## Runtime Response Boundary

Treat all service responses as `unknown`.

Normalize only the UI fields this task needs:

- `messages`: non-empty strings
- `plan`: rows with label/step, tool, status, and summary
- `runLog`: rows with step, tool, status, and message
- `meta.workspace`
- `meta.readyToExecute`
- `meta.draft`, retained only when it is a plain object
- `meta.agentRun.runId` and status
- LLM public status label/message
- recommendation title, summary/reason, risk items, confidence score
- deterministic result count

Ignore unknown fields safely.

If a response has a structured patch at either:

- top-level `sequencePatch`
- `meta.sequencePatch`

retain it as `unknown` and hand it to `workspace.loadPatchPreview()`. The
workspace parser remains authoritative. Do not cast or transform it into a
`SequencePatch`.

## Request Snapshot

Build a compact request snapshot from the active canonical document:

```text
lastWorkbenchPage: cloning
currentSequenceDocument: current document summary
formState.cloning.vectorSequence: current sequence
formState.cloning.vectorTopology: circular or linear
formState.cloning.vectorLabel: document name
```

Include canonical name, sequence, topology, accession/version, and feature
summaries where the existing service can safely ignore extra fields.

Do not silently use the open vector as the insert sequence. The user or service
must identify the insert explicitly.

Send:

- `workspace: "cloning"`
- `runMode: "precise"` so planning never requests auto-execution
- prior normalized conversation history
- the current user message

Execute with the exact normalized draft returned by planning, the same current
document snapshot, the latest history, workspace, message, and run ID when
available.

## Agent Session State

Create a focused hook or controller that owns:

- service status: `checking | online | offline`
- health label
- normalized conversation messages
- current plan
- current draft
- latest run log
- latest result summary
- request phase: `idle | planning | executing`
- recoverable error
- last user goal

Rules:

- health check runs once on mount and can be retried manually
- a failed health check does not clear the current document
- sending appends the user message immediately
- a successful plan appends normalized assistant messages
- a failed plan leaves the user message visible and shows a retryable error
- execution requires a valid draft and an explicit click
- execution appends result messages and replaces the run log/result summary
- no automatic execution even if the service returns `autoExecute`
- opening another file or manually editing OVE clears draft/plan/result state
  that targets the prior document, while preserving visible conversation with
  a short local context-change notice
- provide a clear-session command that affects Agent state only
- abort or ignore late responses after unmount

## Agent UI

Keep the right-side panel compact and work-focused.

Header:

- `Agent`
- service status dot/label
- collapse control

Conversation:

- scrollable user and assistant messages
- empty-state prompt examples, not a marketing explanation
- multiline text input
- Send icon/text command
- Enter sends; Shift+Enter creates a newline
- input and Send disabled while planning or executing

Plan:

- show returned steps compactly
- show tool and status where available
- when `readyToExecute` and a draft exist, show `Run design`
- Run design always requires an explicit click

Results:

- show execution messages and run log
- show recommendation title/summary, risk items, confidence, and result count
  when present
- do not render arbitrary HTML or Markdown from the service

Patch:

- when TASK-005 has a pending preview, show the existing preview controls in
  the panel
- Apply/Reject/Revert behavior remains unchanged
- a patch error is visible and cannot be applied

Offline/error state:

- say that the local Agent service is unavailable
- show the expected localhost address
- provide `Retry`
- keep sequence editing and file commands usable

Layout:

- `.agent-body` must scroll vertically
- input composer remains reachable at 720x480
- long messages, tool names, and errors wrap without horizontal overflow
- collapsing the Agent restores editor width

## Acceptance Criteria

- With the local service on port 8000, health status becomes online.
- With the service offline, the panel shows a recoverable offline state and
  the editor remains usable.
- Sending a cloning request posts the current document as vector context.
- The returned assistant message and plan are visible.
- No response can trigger execution without clicking `Run design`.
- Clicking `Run design` posts the exact retained draft and displays the
  deterministic result/run log.
- No response can apply a sequence patch without the TASK-005 preview and an
  explicit Apply click.
- Malformed JSON, non-JSON, HTTP errors, and malformed response fields produce
  readable errors without crashing.
- A top-level or meta `sequencePatch` is passed as unknown to the existing
  workspace validation boundary.
- A manual OVE commit or file open invalidates the prior draft/plan/results.
- Existing safe patch Apply/Reject/Revert behavior and local file workflows
  continue to pass.
- The panel remains operable at 720x480.

## Required Tests

- base URL normalization and default
- health success, HTTP failure, timeout/abort, and non-JSON response
- chat request snapshot includes current document as vector, not insert
- runtime normalization ignores malformed array items and unknown fields
- planning appends user/assistant messages and stores only a plain-object draft
- planning never auto-executes
- execution requires draft and explicit invocation
- execution request preserves draft and run ID
- offline/retry UI
- Enter versus Shift+Enter behavior
- busy-state input/button disabling
- plan and run-log rendering
- recommendation/risk/result-count rendering
- response patch handoff without casting or transformation
- context invalidation after manual edit/file open
- TASK-005 preview controls remain functional

## Verification Commands

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri:build
```

## Self-Review Checklist

- Confirm no parent project file changed.
- Confirm no Agent call automatically executes a design.
- Confirm no design automatically applies a patch.
- Confirm every service response crosses a runtime `unknown` boundary.
- Confirm the current document is sent as vector context, never silently as the
  insert.
- Confirm service failure cannot affect sequence editing or file operations.
- Confirm the 720x480 composer and action controls remain reachable.

## Delivery Contract

Claude returns only the structured report requested by the orchestration
script. Keep paths and risk descriptions short; do not write a narrative
implementation summary.
