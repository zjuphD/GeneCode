Here is the full repository review.

---

## Findings

### Architecture

The repository is a Tauri + React + TypeScript desktop app for molecular design, scaffolded with Vite, Vitest, and strict-mode TypeScript. The codebase is organized around a local-first agent pattern: a Python sidecar at `127.0.0.1:8000` handles biological design, while the desktop frontend owns all UI state, normalization, and patch safety.

The recent commit chain (TASK-009 through TASK-012) layers result-card rendering, workspace routing, and non-cloning result normalization on top of the earlier patch-preview/apply/reject boundary (TASK-005).

### Defensive Normalization (Strong)

`src/agent/responseTypes.ts` treats all service responses as `unknown`. Every scalar passes through `nonEmptyString` / `safeNumber` / `isPlainObject` guards. Malformed array items are silently skipped rather than crashing. This is the correct approach for a client consuming untrusted backend JSON.

### Agent Safety Invariants (Strong)

- No automatic execution — `readyToExecute` is checked but the user must explicitly click "Run molecular design".
- A monotonic generation token (`generationRef`) prevents late responses from restoring stale draft/plan/result state after context invalidation or `clearSession`.
- Document hash changes (`onDocumentHashChange`) abort in-flight requests, clear draft/plan/results, and inject a notice message.
- `AbortError` from cancellations is correctly suppressed rather than shown as a user error.

### Patch Safety (Strong)

- `SequencePatch` targets an exact `baseHash` (FNV-1a fingerprint).
- `applyPendingPatch` re-checks the document hash immediately before commit, preventing stale application after manual OVE edits.
- One-step revert stores the prior document in memory.
- Warning acknowledgement is required before applying patches with warnings.

### Workspace Routing (TASK-011)

`AgentWorkspace` is a clean union type (`"cloning" | "rtqpcr" | "sgrna" | "sirna" | "mutagenesis"`). `buildDocumentSnapshot` populates workspace-specific `formState` entries. `useAgentSession` correctly prefers `response.draft.workspace` over the selected workspace during execution, preventing accidental fallback to cloning after planning another workspace.

### Non-Cloning Result Cards (TASK-012)

`buildSequenceRows` and `buildMetrics` are workspace-aware and handle all five workspaces with sensible fallbacks. `CandidateCards` correctly filters out duplicate forward/reverse rows when `hasPrimerPair` is true (line 580-585 of `AgentPanel.tsx`), so cloning primers aren't shown twice.

### Naming Inconsistency — `mutagenesis` vs `mutation`

The `AgentWorkspace` union and `TASK_STARTERS` use `"mutagenesis"`, but `buildDocumentSnapshot` populates `formState.mutation` (not `formState.mutagenesis`). The task spec (TASK-011, line 115) specifies the key as `mutation`. The Python service likely expects `mutation` in `formState`. This works at runtime because the snapshot key and workspace value are used independently, but it creates a naming asymmetry that could confuse future contributors.

### CandidateCards Only Renders the Top Candidate

`CandidateCards` destructures `candidates[0]` and renders only the top candidate. Backup candidates are counted but not displayed. The normalization caps at 3 candidates, but the UI discards candidates 2 and 3 entirely. This is a deliberate simplification per the task spec ("backup candidate count"), but it means useful alternative designs are hidden.

### ESLint Suppression in Hook Dependencies

`useAgentSession.ts` has 7 `eslint-disable-next-line react-hooks/exhaustive-deps` comments. Most are intentional (the hook captures `phase`, `messages`, `draft` etc. in callbacks), but the suppression in `sendMessage` (line 293) excludes `messages` from the dependency array — the callback captures `messages` for history building. If `messages` changes between the render that created the callback and the call, the history snapshot could be stale. In practice the guard (`phase !== "idle"`) prevents concurrent sends, so this is low-risk, but it is a latent correctness issue.

### Snapshot Payload Size

`buildDocumentSnapshot` sends the full `doc.sequence` in three places: `currentSequenceDocument.sequence`, `formState.cloning.vectorSequence`, and `formState.custom.sequence` (plus workspace-specific copies). For large sequences (>100 kb), this triples the request payload. No truncation or compression is applied.

### `isCancellation` Inconsistency

`isCancellation` in `useAgentSession.ts` (line 168) returns `false` for `AgentServiceError` with message `"Request timed out"` but doesn't handle generic `Error` objects whose `name` is `"AbortError"`. The service layer's `createRequestController` can throw `AgentServiceError("Request timed out")`, which is correctly handled. But if a different code path throws a plain `Error` with `name: "AbortError"`, it would still be caught by the second check. This is fine, but the logic is fragile.

---

## Open Questions

1. **`mutagenesis` formState key**: The Python service `server.py` receives `snapshot.formState.mutation` for mutagenesis workspaces. Is the key `mutation` correct for all backend versions, or should it be `mutagenesis`? The task spec says `mutation`, but the workspace label is `mutagenesis`.

2. **Empty query fields**: `buildDocumentSnapshot` sends `rt.query: ""` and `sg.query: ""` for non-query workspaces. Does the backend treat empty strings as "no query" or does it attempt to use them? If the backend infers a query from the sequence, the empty string may be redundant but harmless.

3. **Multi-candidate rendering**: The UI only shows the top candidate. Is this intentional for sidebar compactness, or should backup candidates be collapsible/expandable?

4. **Non-cloning export**: There is no copy/export action for sgRNA guides, siRNA duplexes, or mutation primers. The "Copy primer order table" button only appears when `hasPrimerPair` is true. Should there be a generic "Copy result" action for non-cloning outputs?

5. **Sequence payload size**: For sequences >100 kb, the triple-copy in `buildDocumentSnapshot` could be significant. Is there a plan to send only a hash or truncated context for non-primary formState entries?

6. **Starter prompt workspace mismatch**: If a user sends a cloning starter prompt while the workspace selector is set to `rtqpcr`, the message is sent with `workspace: "rtqpcr"`. Should the UI warn or should starter prompts be workspace-locked?

---

## Test Gaps

### Missing Test Cases

1. **`buildDocumentSnapshot` for `mutagenesis` workspace**: No test verifies that `buildDocumentSnapshot(doc, "mutagenesis")` populates `formState.mutation.sequence`, `formState.mutation.mode`, `formState.mutation.cdsStart`, etc. Only `sgrna` and `rtqpcr` workspaces have snapshot tests (`service.test.ts`).

2. **AgentPanel workspace switching for sgRNA, siRNA, mutagenesis**: Only the `rtqpcr` workspace switch is tested in `AgentPanel.test.tsx` (line 217). There are no tests that clicking "sgRNA" changes the starter prompts to "Design KO sgRNAs", "Design KI sgRNAs", "Check guide risks".

3. **Sequence row deduplication in CandidateCards**: No test verifies that when a cloning candidate has both `sequenceRows: [{label: "Forward", ...}]` and `forwardPrimer: "..."`, the `SequenceRowDisplay` only shows non-forward/reverse rows. The filtering logic at `AgentPanel.tsx:580-585` is untested.

4. **`buildDefaultTitle` for mutagenesis with mutation field**: The test at `responseTypes.test.ts:545` covers `mutation: "A123T"`, but there's no test for the fallback case where `mutation` is missing (should return "Mutation candidate").

5. **Workspace persistence across panel collapse/expand**: No test verifies that `selectedWorkspace` is preserved when the user collapses and re-expands the agent panel. The state is component-level (`useState`), so it should persist, but this is untested.

6. **Non-cloning metrics in `buildMetrics`**: The sgRNA, siRNA, and mutagenesis metric normalization is tested at the `normalizeAgentResponse` level, but there are no edge-case tests for partial metric data (e.g., sgRNA with only `score` and no `gc`, `cut`, `direction`).

7. **RT-qPCR with probe row in AgentPanel**: `responseTypes.test.ts:407` tests probe normalization, but `AgentPanel.test.tsx` doesn't test that a probe row renders in the UI when `sequenceRows` includes a "Probe" entry.

8. **`executeDesign` workspace override from draft**: `useAgentSession.test.ts:393` tests that `executeDesign(doc, "cloning")` still uses `workspace: "rtqpcr"` from the draft. But there's no test for the case where `draft.workspace` is an invalid value (e.g., `"invalid"`), which would cause `workspaceFromDraft` to return `null` and fall back to `workspace ?? selectedWorkspace`.

### Test Quality Observations

- The existing tests are thorough for the cloning path and the workspace routing happy path.
- The `responseTypes.test.ts` file has good coverage of all workspace normalization shapes.
- Component tests in `AgentPanel.test.tsx` cover the primary rendering paths but miss secondary workspace interactions.
- The `useAgentSession.test.ts` tests for late response suppression and cancellation are well-designed.

---

## Overall Recommendation

The recent TASK-011/TASK-012 work is well-executed and integrates cleanly with the existing safety architecture. The defensive normalization, generation token, and document hash invalidation patterns are solid.

**No blocking issues.** The codebase is safe to ship as-is.

**Recommended follow-ups** (non-blocking):

1. Add `buildDocumentSnapshot` tests for `mutagenesis` workspace to close the snapshot test gap.
2. Add AgentPanel tests for sgRNA/siRNA/mutagenesis workspace switching to match the existing rtqpcr coverage.
3. Consider adding a generic "Copy result" action for non-cloning result types (sgRNA guide, siRNA duplex).
4. Address the `messages` stale closure risk in `useAgentSession.sendMessage` by either adding `messages` to the dependency array (with appropriate batching) or documenting the invariant that prevents the stale read.
5. Consider deduplicating the sequence payload in `buildDocumentSnapshot` if large-sequence performance becomes a concern.
