# TASK-021: Visible GenePad Editor Palette

Status: accepted

Accepted review: `reviews/TASK-021-review-2.md`

## Objective

Make the GenePad-inspired palette visibly affect the dominant OVE editor area,
not only the surrounding application shell. Neutralize OVE's blue-gray chrome
and replace its two fallback electric-blue annotation colors with a restrained,
deterministic scientific palette while preserving user-defined feature colors
and canonical document data.

## Context

TASK-020 correctly refined the application shell, but most of the viewport is
OVE. The live browser still shows:

- `veToolbar-outer` and `veStatusBar` at `rgb(235, 241, 245)`;
- active OVE controls using a saturated translucent blue;
- pUC19 features almost entirely using `#0B17BD` and `#006FEF` defaults.

As a result the user cannot perceive the shell-only theme change.

## Product Invariants

- Preserve OVE behavior, layout, panel dimensions, selection, editing, saving,
  and keyboard behavior.
- Preserve explicit user/file feature colors.
- Display-only fallback colors must not overwrite canonical feature colors
  after an OVE save round trip.
- Canonical coordinates, qualifiers, names, and feature IDs remain unchanged.
- Biological features may use a varied green/orange/blue/teal/violet palette;
  the application shell remains neutral.
- Do not modify `node_modules` or global Blueprint styles outside the scoped OVE
  host.
- Do not add gradients, shadows, dark mode, dependencies, or layout changes.

## In Scope

- Add scoped OVE chrome overrides under `.ove-editor-host`.
- Neutralize OVE top toolbar, status bar, separators, active toolbar control,
  and active map tabs.
- Add a deterministic display-color resolver in the OVE adapter.
- Remap absent/known OVE fallback blues to a restrained multi-color palette.
- Preserve non-default explicit colors unchanged.
- Restore original canonical colors during OVE-to-canonical save conversion
  when the returned color is only the derived display fallback.
- Add focused adapter tests for deterministic mapping and round-trip safety.

## Out of Scope

- Changing GenePad branding, icons, layout, or assets.
- Replacing OVE or modifying its package source.
- Changing restriction-enzyme label colors or biological calculations.
- Sidebar functionality, Agent behavior, backend, or Tauri changes.
- Assigning biological meaning to colors beyond stable visual grouping.

## Allowed Files

- `src/App.css`
- `src/editor/adapter.ts`
- `src/editor/adapter.test.ts`
- `tasks/TASK-021-visible-genepad-editor-palette.md`
- `reviews/TASK-021-review-1.md`

Do not modify any other file.

## Required Implementation

1. Add a deterministic display-color resolver.
   - Export a small pure helper for testability.
   - Preserve feature colors that are not OVE fallback defaults.
   - Treat missing colors and case-insensitive `#0B17BD` / `#006FEF` as
     fallback values eligible for remapping.
   - Derive a stable palette index from feature type and name; the same feature
     identity must always receive the same color.
   - Use 5-6 restrained colors inspired by GenePad's daytime screenshot,
     including sage green, muted orange, medium blue, teal, and violet.
   - Colors must retain readable white OVE labels.

2. Apply display colors only at the OVE boundary.
   - `toOveFeature` sends the resolved display color.
   - Do not change canonical feature colors merely by rendering.
   - `fromOveData` compares the returned OVE color with the derived display
     color for the matching original feature ID. If they match, preserve the
     original canonical color rather than persisting the display fallback.
   - If the user changed a feature to a different color in OVE, preserve that
     new color.

3. Neutralize OVE chrome with scoped CSS.
   - `.ove-editor-host .veToolbar-outer` and `.veStatusBar` use the app's
     near-white neutral surface and subtle borders.
   - OVE status-bar spacers use the neutral border token.
   - Active OVE toolbar control uses charcoal with white icon/text.
   - OVE active map tabs use charcoal text/border rather than saturated blue.
   - Inactive tabs remain dark neutral/muted.
   - Keep `Jump to end`, selection actions, and focus affordances blue where
     they represent navigation/selection.
   - Use `!important` only where OVE inline/package styles require it.

4. Keep overrides tightly scoped.
   - Every OVE package selector must be prefixed by `.ove-editor-host`.
   - Do not style all Blueprint buttons globally.
   - Do not override SVG feature fills in CSS; feature fills come from the
     adapter so they remain data-driven.

5. Tests.
   - Missing/default OVE colors map deterministically into the new palette.
   - Different feature identities can map to different palette entries.
   - Explicit custom colors are returned unchanged.
   - Render conversion does not mutate the canonical feature object.
   - OVE save round trip restores an original fallback/undefined color when
     unchanged.
   - A genuinely changed OVE feature color survives round trip.
   - Existing coordinate and qualifier round-trip tests remain green.

## Acceptance Criteria

- The live 1280 x 720 app visibly differs from the prior screenshot.
- OVE toolbar/status chrome is neutral rather than pale blue-gray.
- pUC19 annotations visibly use several restrained colors rather than two
  saturated blues.
- Circular and sequence maps use the same color for the same feature.
- Text remains readable and the main white editor canvas stays dominant.
- Saving unchanged OVE content does not alter canonical feature colors.
- No layout shift, overflow, behavior regression, or browser console error.

## Verification Commands

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

## Self-Review Checklist

- Confirm only allowed files changed.
- Confirm every OVE CSS selector is host-scoped.
- Confirm no SVG fill override was added to CSS.
- Confirm explicit colors and changed-in-OVE colors are preserved.
- Confirm unchanged display fallbacks do not leak into canonical data.
- Compare before/after screenshots at 1280 x 720.
- Confirm browser console has no errors/warnings.
- Report failures rather than hiding them.

## Delivery Contract

Claude returns only the structured report requested by the orchestration
script. Keep paths and risk descriptions short; do not write a narrative
implementation summary.
