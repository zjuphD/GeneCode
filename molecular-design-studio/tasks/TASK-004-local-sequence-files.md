# TASK-004: Local Sequence File Open and Save

Status: accepted

Current review: `reviews/TASK-004-review-4.md`

## Objective

Turn the bundled pUC19 editor demo into a practical local desktop editor that
can open, edit, save, and save as GenBank or FASTA files through native Tauri
dialogs while keeping the canonical `SequenceDocument` as the application
source of truth.

## Context

The reference desktop project `teselagen/ove-electron` proves the basic file
workflow:

- native open/save dialogs
- `bio-parsers` for parsing and export
- current file path tracking
- file extension determines export format

Do not copy its Electron architecture or synchronous Node file APIs. This
application remains Tauri 2 + React and keeps its tested canonical model.

Use the official Tauri 2 dialog and filesystem plugins:

- `@tauri-apps/plugin-dialog`
- `@tauri-apps/plugin-fs`
- matching Rust plugin crates and required capabilities

Use the already installed `@teselagen/bio-parsers@0.4.37`:

- `genbankToJson`
- `fastaToJson`
- `jsonToGenbank`
- `jsonToFasta`

## Terminology

- **Commit edits**: OVE's internal Save action sends its edited data into the
  canonical in-memory document.
- **Save file**: the application writes the canonical document to disk.

Keep these meanings visually distinct. Do not make OVE write directly to disk.

## In Scope

- Tauri 2 native open/save dialogs
- scoped text file reads and writes
- GenBank `.gb` / `.gbk` parsing and export
- FASTA `.fasta` / `.fa` / `.fna` parsing and export
- current file path and basename state
- dirty/clean document state
- Open, Save, and Save As application controls
- unsaved-change confirmation before replacing the document
- keyboard shortcuts for Open, Save, and Save As
- focused format, service, and component tests

## Out of Scope

- SnapGene `.dna` binary parsing
- GFF, BED, JSON, or protein formats
- multiple documents or windows
- recent-file persistence
- autosave
- SQLite
- project/version history
- Agent behavior
- changing OVE versions
- redesigning Sidebar, Agent, or QC behavior

## Allowed Files

- `package.json`
- `package-lock.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/src/lib.rs`
- `src-tauri/capabilities/**`
- `src/App.css`
- `src/components/Editor.tsx`
- `src/components/Editor.test.tsx`
- `src/components/DocumentToolbar.tsx`
- `src/components/DocumentToolbar.test.tsx`
- `src/components/OveEditorHost.tsx` only if a prop name or label is required
- `src/editor/fileFormats.ts`
- `src/editor/fileFormats.test.ts`
- `src/editor/parser.ts`
- `src/editor/parser.test.ts`
- `src/editor/index.ts`
- `src/services/sequenceFiles.ts`
- `src/services/sequenceFiles.test.ts`
- `src/types/ambient.d.ts`
- `src/types/index.ts`
- `README.md` only for a short local-file support note

Do not modify the pUC19 fixture or unrelated application components.

## Required Implementation

1. Add the official Tauri dialog and filesystem plugins on both JavaScript and
   Rust sides. Register them in `src-tauri/src/lib.rs` and add only the
   capabilities required for this task.
2. Add a pure file-format module that:
   - selects a parser from a filename extension
   - parses GenBank into the canonical model
   - parses the first FASTA sequence into the canonical model
   - rejects empty, failed, or multi-record FASTA input with a clear error
   - exports canonical data to GenBank using inclusive OVE/parser coordinates
   - exports canonical data to FASTA
   - normalizes supported extensions case-insensitively
   - never silently changes an unsupported extension to another format
3. Preserve feature coordinates, strand, names, qualifiers, color, accession,
   and version when round-tripping GenBank.
4. Add a narrow `sequenceFiles` service around Tauri APIs:
   - `chooseSequenceFile()`
   - `readSequenceFile(path)`
   - `chooseSavePath(defaultName, currentPath?)`
   - `writeSequenceFile(path, contents)`
   - `confirmDiscardChanges()`
   Keep native APIs out of the React component so tests can mock the service.
5. The Open dialog supports:
   - GenBank: `gb`, `gbk`
   - FASTA: `fasta`, `fa`, `fna`
6. Opening a file:
   - asks for confirmation first if the current document is dirty
   - does nothing when the user cancels
   - reads and parses the selected text file
   - replaces the canonical document only after successful parsing
   - remounts OVE even when the new file has the same sequence name
   - records the selected path and clears dirty state
   - reports parsing/read errors visibly without destroying the current document
7. When OVE commits a successful edit into the canonical model:
   - update the document
   - mark it dirty
   - use a label such as `Edits committed` rather than `Synced`
8. Saving:
   - Save writes to the current path when one exists
   - Save falls back to Save As when there is no current path
   - Save As uses a native dialog with GenBank and FASTA filters
   - export format follows the chosen extension
   - cancellation leaves document/path/dirty state unchanged
   - successful write updates the current path and clears dirty state
   - failed export/write leaves dirty state true and displays the concrete error
9. Add a compact application document toolbar above OVE with familiar Open,
   Save, and Save As commands. Show:
   - current basename, or `pUC19 demo`
   - a subtle dirty marker
   - length, topology, and feature count
   - short success or error status
10. Add keyboard shortcuts:
    - macOS: `Cmd+O`, `Cmd+S`, `Cmd+Shift+S`
    - other platforms: `Ctrl+O`, `Ctrl+S`, `Ctrl+Shift+S`
    Prevent the browser default only when handling one of these shortcuts.
11. The bundled pUC19 fixture remains the initial clean demo document with no
    path. Its first disk save must use Save As.
12. Keep controls compact and ensure long filenames/status messages do not
    resize or overlap the OVE workspace.

## Acceptance Criteria

- The packaged macOS application opens a native file picker.
- Opening a valid GenBank file shows its correct name, sequence length,
  topology, features, and path basename.
- Opening a valid single-record FASTA file shows a linear sequence with zero
  annotations.
- Invalid or unsupported files leave the current document intact and show a
  concrete error.
- A committed OVE edit marks the document dirty.
- Save As writes a parseable GenBank file whose canonical sequence and feature
  coordinates round-trip unchanged.
- Save As writes a parseable FASTA file with the canonical sequence unchanged.
- Save writes to the existing selected path without reopening the dialog.
- Canceling Open, Save As, or discard confirmation has no destructive effect.
- Opening another document with the same internal name creates one fresh OVE
  instance rather than retaining the previous sequence state.
- No direct `window.__TAURI__`, Node `fs`, Electron, or unrestricted filesystem
  access is introduced.

## Required Tests

- extension detection, including uppercase
- unsupported extension rejection
- single-record FASTA parsing
- multi-record FASTA rejection
- GenBank canonical round-trip
- FASTA sequence round-trip
- Open cancel and parse-error preservation
- dirty confirmation accept/reject
- Save current path versus Save As
- write failure preserves dirty state
- keyboard shortcut dispatch
- same-name file open changes the OVE remount key

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

- Check every acceptance criterion once after the final edit.
- Confirm all changed files are allowed by this task.
- Confirm failed opens never replace the current document.
- Confirm failed saves never clear the dirty marker.
- Confirm filesystem capabilities are no broader than required.
- Confirm GenBank features round-trip through canonical coordinates.

## Delivery Contract

Claude returns only the structured report requested by the orchestration
script. Keep paths and risk descriptions short; do not write a narrative
implementation summary.
