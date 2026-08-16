# TASK-005: Agent Structured Patch Preview and Apply

Status: accepted

Accepted review: `reviews/TASK-005-review-3.md`

## Objective

Establish the safe Agent change boundary: define and validate structured
sequence patches against the current canonical document, preview every effect,
and apply a patch only after explicit user confirmation.

This task does not connect an LLM. It builds the deterministic protocol and UI
that a later Agent provider must use.

## Context

The application now has:

- a canonical `SequenceDocument`
- full OVE editing
- native GenBank/FASTA open and save
- dirty-state protection

The active document state currently lives inside `Editor`, while `AgentPanel`
is its sibling. Refactor to a shared workspace controller so both components
operate on the same canonical document. OVE remains an implementation detail.

Product invariants:

- Agent output is data, never executable code.
- An Agent never writes directly into OVE or to disk.
- A patch targets an exact document content hash.
- Validation and application are deterministic and atomic.
- The user sees a preview and explicitly confirms before any change.
- The prior document remains recoverable in memory until another manual/open
  operation supersedes it.

## In Scope

- deterministic document content fingerprint
- discriminated-union patch schema
- insert, delete, replace, add-feature, and remove-feature operations
- strict patch validation
- atomic patch simulation and application
- annotation coordinate transformation for sequence-length changes
- human-readable preview model
- warning acknowledgement before risky application
- shared workspace state for Editor and AgentPanel
- one-step revert of the latest Agent-applied patch
- a safe annotation-only example proposal for exercising the protocol
- focused unit and integration tests

## Out of Scope

- LLM/API/provider connection
- natural-language planning
- Python sidecar
- primer or cloning algorithms
- database persistence or durable version history
- multi-document workspaces
- remote services
- automatic patch application
- OVE selection/caret integration

## Allowed Files

- `src/App.tsx`
- `src/App.css`
- `src/types/index.ts`
- `src/agent/**`
- `src/workspace/**`
- `src/components/AgentPanel.tsx`
- `src/components/AgentPanel.test.tsx`
- `src/components/PatchPreview.tsx`
- `src/components/PatchPreview.test.tsx`
- `src/components/Editor.tsx`
- `src/components/Editor.test.tsx`
- `src/components/DocumentToolbar.tsx` only if controlled props require it
- `src/components/OveEditorHost.tsx` only if controlled props require it
- `src/editor/index.ts`
- `README.md` only for a short architecture note

Do not modify:

- OVE or bio-parser dependency versions
- Tauri plugins/capabilities
- GenBank fixture
- Sidebar or QC behavior
- file format parsing/export rules

## Patch Schema

Define a strict TypeScript discriminated union. Exact names may vary, but the
semantics must be equivalent:

```ts
interface SequencePatch {
  schemaVersion: 1;
  id: string;
  title: string;
  summary: string;
  baseHash: string;
  operations: SequencePatchOperation[];
}

type SequencePatchOperation =
  | InsertOperation
  | DeleteOperation
  | ReplaceOperation
  | AddFeatureOperation
  | RemoveFeatureOperation;
```

Every operation has:

- a stable non-empty `id`
- a non-empty user-facing `reason`

Sequence operations:

- `insert`: zero-based position and IUPAC DNA sequence
- `delete`: half-open `[start, end)` and mandatory `expectedSequence`
- `replace`: half-open `[start, end)`, mandatory `expectedSequence`, and new
  IUPAC DNA sequence

Feature operations:

- `add_feature`: complete canonical `SequenceFeature`
- `remove_feature`: stable existing `featureId`

## Content Fingerprint

Implement a deterministic synchronous document fingerprint without adding a
dependency.

- Include sequence, topology, document name, accession/version, ordered
  features, colors, and qualifiers.
- Stable-sort object keys used in qualifiers.
- Preserve feature array order.
- Prefix the result with an algorithm/version label such as `fnv1a64-v1:`.
- It is a stale-document guard, not a cryptographic security primitive.
- Tests must prove identical documents hash identically and any meaningful
  content change changes the hash.

## Patch Semantics

1. Operations execute sequentially against a working clone.
2. Input documents and patch objects must never be mutated.
3. Reject:
   - unsupported schema versions or operation kinds
   - empty patch or duplicate operation IDs
   - stale `baseHash`
   - invalid/non-integer/out-of-range coordinates
   - empty insert/replace sequences
   - non-IUPAC DNA characters
   - `expectedSequence` mismatch, compared case-insensitively
   - duplicate added feature IDs
   - missing removed feature IDs
   - invalid feature ranges or strand
4. Canonical coordinates remain zero-based half-open.
5. Normalize inserted/replacement sequence to uppercase.
6. Sequence operations transform existing feature coordinates:
   - insertion before a feature shifts it right
   - insertion inside a feature expands its end and emits a warning
   - deletion before a feature shifts it left
   - partial overlap clips a feature and emits a warning
   - full deletion removes a feature and emits a warning naming that feature
   - replacement uses the deterministic delete-then-insert transform
7. The preview must list every transformed or removed feature. Never hide an
   annotation change.
8. If any operation fails, return errors and no proposed document.

## Preview Model

Produce a serializable preview containing:

- patch ID/title/summary
- base and proposed hashes
- before/after sequence length
- operation rows with kind, coordinates, reason, and length delta
- affected feature rows
- warnings
- errors
- proposed canonical document only when valid

Applying a preview must re-check the current document hash immediately before
commit so a stale preview cannot be applied after manual edits.

## Workspace Refactor

Create a shared workspace controller/hook/component that owns:

- canonical document
- current file path and basename
- dirty state
- OVE remount key
- success/error status
- pending Agent patch and preview
- latest pre-Agent snapshot for one-step revert

Move the existing open/save/shortcut behavior out of `Editor` or expose it
through controlled props. Preserve all TASK-004 behavior and tests.

Rules:

- successful file open clears pending preview and Agent revert history
- manual OVE commit marks dirty and clears pending/revert state
- Agent apply marks dirty, remounts OVE, and retains the previous document for
  one-step revert
- Agent revert restores that document, marks dirty, remounts OVE, and consumes
  the revert snapshot
- disk save does not automatically apply or discard Agent proposals

## Agent UI

Replace the placeholder right panel with a compact proposal workflow.

Empty state:

- `No pending proposal`
- a secondary `Load safe example` command

The safe example:

- is annotation-only
- targets the current content hash
- adds a `misc_feature` named `Agent review marker`
- spans `[0, min(20, sequence length))`
- uses a unique feature and patch ID
- does not invent or modify biological sequence

Pending state:

- patch title and summary
- operation list
- before/after length
- affected annotations
- warnings/errors
- `Apply`, `Reject`, and collapse controls

Safety behavior:

- invalid previews disable Apply
- warnings require a visible acknowledgement checkbox before Apply
- Apply always requires an explicit click
- Reject makes no document change
- after successful application, show `Revert last Agent change`
- the safe example command is clearly labelled as an example, not a real AI
  result

## Acceptance Criteria

- The Editor and AgentPanel display the same active canonical document state.
- Loading the safe example creates a valid annotation-only preview.
- Rejecting it leaves document hash, features, dirty state, and OVE instance
  unchanged.
- Applying it adds exactly one feature, marks dirty, remounts OVE, and stores
  the prior document for revert.
- Reverting restores the exact prior hash and feature list, remains dirty, and
  remounts OVE again.
- A manual OVE edit after preview creation makes the preview stale and prevents
  application.
- Opening a different file clears preview and revert state.
- Patches never write files directly.
- Existing GenBank/FASTA open/save and keyboard shortcuts still work.
- The panel remains usable at the configured 720x480 minimum window.

## Required Tests

- stable fingerprint and content-change detection
- every operation kind
- sequential operation coordinates
- case-insensitive expected-sequence guard
- IUPAC validation
- stale base hash
- duplicate operation IDs and feature IDs
- atomic failure/no input mutation
- insert/delete/replace feature transformations
- warning and affected-feature preview rows
- Apply disabled for errors
- warning acknowledgement gate
- Reject no-op
- Apply and one-step revert
- stale preview after manual OVE commit
- file open clears Agent state
- existing file workflow regression tests

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

- Confirm patch application is atomic and does not mutate inputs.
- Confirm all coordinates are canonical half-open coordinates.
- Confirm every annotation transformation is represented in preview.
- Confirm stale previews cannot be applied.
- Confirm warning acknowledgement is required.
- Confirm no model/network/file API is called by Agent patch code.
- Confirm TASK-004 file behavior remains intact.

## Delivery Contract

Claude returns only the structured report requested by the orchestration
script. Keep paths and risk descriptions short; do not write a narrative
implementation summary.
