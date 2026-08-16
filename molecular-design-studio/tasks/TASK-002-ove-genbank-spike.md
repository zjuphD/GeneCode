# TASK-002: OVE GenBank Integration Spike

Status: accepted

Current review: `reviews/TASK-002-review-1.md`

## Objective

Embed Open Vector Editor's lightweight circular/linear sequence view, parse a
real pUC19 GenBank record, and prove that the application can render the
sequence through an explicit adapter boundary.

## Context

OVE version `0.8.42` is MIT licensed and is the preferred initial editor
foundation. Its npm package declares React `^18.3.1` as a direct dependency.
The current application uses React 19, which would create multiple React
versions and can break hooks or context. Align the application to React 18.3.1.

OVE uses zero-based inclusive feature ends. Molecular Design Studio's canonical
model uses zero-based half-open ranges `[start, end)`. Coordinate conversion
must live in the adapter.

This task is a visualization and data-boundary spike. The full editable OVE
Redux editor is a later task.

## Authoritative Fixture

Download the GenBank record from NCBI:

```text
https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=M77789.2&rettype=gb&retmode=text
```

Save it as:

```text
src/fixtures/puc19.gb
```

The fixture must:

- come from the exact NCBI endpoint above
- contain accession/version `M77789.2`
- describe a circular sequence
- contain 2,686 bases

If NCBI cannot be reached or the response is not a GenBank record, stop and
report the blocker. Do not invent or substitute sequence content.

## In Scope

- React 18 compatibility alignment
- `@teselagen/ove@0.8.42`
- `@teselagen/bio-parsers@0.4.37`
- real bundled pUC19 GenBank fixture
- minimal canonical sequence types
- GenBank parser boundary
- OVE adapter boundary
- circular/linear view control
- focused adapter/parser tests
- rendering the pUC19 map in the central workspace

## Out of Scope

- full OVE Redux editor
- sequence editing or autosave
- file picker
- user-provided files
- restriction-enzyme settings
- Agent behavior
- Python sidecar
- SQLite or project persistence
- redesigning the application shell

## Allowed Files

- `package.json`
- `package-lock.json`
- `src/App.css`
- `src/components/Editor.tsx`
- `src/editor/**`
- `src/fixtures/puc19.gb`
- `src/types/**`
- `src/**/*.test.ts`
- `vite.config.ts` only if required for text fixture loading
- `tsconfig.json` only if required for library typing
- `README.md` only for new verification commands

Do not modify:

- `src-tauri/**`
- `CLAUDE.md`
- `docs/ARCHITECTURE.md`
- navigation, Agent, or QC component behavior

## Required Implementation

1. Align root React dependencies and types to React/ReactDOM `18.3.1`.
2. Install exact OVE and bio-parser versions specified above.
3. Add Vitest and an `npm test` script if a test runner is not present.
4. Define a minimal canonical model under `src/editor/`:
   - document name
   - sequence
   - circular topology flag
   - features with stable ID, name, type, zero-based half-open start/end,
     strand, and qualifiers
5. Parse `src/fixtures/puc19.gb` with `genbankToJson`.
6. Validate parser success and convert the parsed result into the canonical
   model. Fail visibly instead of silently rendering empty data.
7. Implement an `OveEditorAdapter` that converts canonical data to OVE data:
   - canonical `[start, end)` to OVE inclusive `start/end`
   - preserve strand, names, types, colors when present
   - keep OVE imports contained inside the adapter/view module
8. Render OVE's `SimpleCircularOrLinearView` in the central workspace.
9. Add a compact segmented control for circular and linear views.
10. Display the loaded document name, length, topology, and feature count in a
    compact editor toolbar.
11. Make the OVE view fill the available center space without overlapping the
    top bar, Agent panel, or QC strip.
12. Add only the minimum ambient TypeScript declarations required for OVE and
    bio-parsers. Do not use a broad wildcard returning `any`.
13. Add focused tests for:
    - parser result: name/accession, 2,686 bp, circular topology
    - OVE coordinate conversion for a forward feature
    - OVE coordinate conversion for a reverse feature
    - invalid/empty parser response handling

## UI Requirements

- Preserve the current light scientific workbench palette.
- Do not put the map inside a decorative card.
- The map is the primary central workspace.
- Controls must remain compact.
- Do not add marketing text, onboarding tours, or explanatory feature copy.
- No visible overflow at 1200x800 or the configured minimum 720x480 window.

## Acceptance Criteria

- The root app uses React/ReactDOM 18.3.1, with one physical installation of
  each package. OVE's legacy dependencies may report stale peer-range warnings,
  so verify the installed packages without requiring the full peer tree to be
  warning-free:

```bash
npm ls react react-dom --depth=0
npm explain react
npm explain react-dom
```

- pUC19 renders as a circular OVE map by default.
- The linear control switches to a linear OVE view.
- Document metadata shows 2,686 bp and circular topology.
- Parsed features are visible when present in the NCBI record.
- OVE-specific data does not escape the adapter/view module.
- Coordinate conversion is covered by passing tests.
- Existing Agent collapse behavior still works.
- The desktop app and production `.app` bundle still build.

## Verification Commands

```bash
npm install
npm ls react react-dom --depth=0
npm explain react
npm explain react-dom
npm run typecheck
npm run lint
npm test -- --run
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri:build
```

## Delivery Notes

Claude must report:

- exact installed versions
- GenBank source and fixture validation
- canonical and OVE coordinate conventions
- files changed
- every verification command and result
- OVE console warnings, compatibility workarounds, or residual risks
