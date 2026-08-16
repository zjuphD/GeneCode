# TASK-017: GenePad-Inspired Application Palette

Status: accepted

Accepted review: `reviews/TASK-017-review-1.md`

## Objective

Refresh the application's overall light theme so it feels closer to GenePad's
desktop editor: cool white work surfaces, pale blue-gray chrome, crisp borders,
dark neutral text, blue interaction emphasis, and restrained semantic colors.

This is a visual-theme task only. Preserve the accepted layout, Agent task
stream, editor behavior, dimensions, and interactions.

## Visual Reference

Reference inspected by Codex:

- `https://genepad.pages.dev/`
- GenePad light-mode screenshot, 1804 x 1204

Relevant characteristics:

- white primary editor surfaces;
- very light cool gray/blue application chrome;
- pale blue-gray dividers and borders;
- near-black primary controls and text;
- blue selected/action states;
- green used for biological/success meaning;
- orange/amber reserved for warnings or secondary biological accents;
- no beige, cream, forest-green-dominant, or monochromatic blue treatment.

Do not copy GenePad branding, icons, layout, or assets. Adapt only the palette
logic to the existing Molecular Design Studio interface.

## Product Invariants

- Do not alter component hierarchy or layout.
- Do not alter Agent behavior or session state.
- Do not alter OVE data, sequence colors, feature colors, or editor adapter.
- Keep semantic meanings distinct: blue interaction, green success, amber
  warning/review, red destructive/error.
- Maintain readable contrast for text, borders, disabled controls, selected
  items, and focus states.
- Do not introduce gradients, shadows, decorative blobs, or a dark theme.

## In Scope

- Consolidate the light-theme color tokens in `:root`.
- Change the warm gray/forest-green shell to cool neutral/blue.
- Update top bar, project sidebar, document toolbar, QC strip, Agent panel,
  task stream, form controls, buttons, result cards, patch review, and error
  states to use the semantic palette consistently.
- Replace relevant repeated hard-coded red/green/amber values with CSS variables.
- Change the Agent online indicator to the success color if needed.
- Remove obsolete TASK-015 task-brief CSS while touching the theme file.
- Preserve all responsive and width behavior from TASK-016.

## Out of Scope

- Layout changes.
- Typography changes beyond color/weight needed for contrast.
- New controls, icons, themes, dependencies, or design-system packages.
- Dark mode.
- OVE package overrides or feature-color remapping.
- Backend, Tauri, editor, service, or workspace changes.
- Changes to task content or Agent wording.

## Allowed Files

- `src/App.css`
- `src/components/AgentPanel.tsx`
- `src/components/AgentPanel.test.tsx`
- `tasks/TASK-017-genepad-inspired-palette.md`
- `reviews/TASK-017-review-1.md`

Do not modify any other file.

## Required Implementation

1. Introduce a coherent semantic palette.
   - Cool page background around `#eef2f6` to `#f3f6fa`.
   - White raised/editor surfaces.
   - Cool blue-gray secondary surfaces and borders.
   - Dark neutral primary text, medium cool-gray secondary text, and readable
     muted text.
   - Medium blue accent suitable for selected controls and primary actions.
   - Separate success green, warning amber, and danger red tokens with pale
     background/border variants.
   - Exact values may be adjusted for contrast and harmony.

2. Apply blue only to interaction semantics.
   - Primary buttons, selected workspace, active navigation, focus borders,
     links/action labels, and active Agent task states use the blue accent.
   - Hover and subtle selected backgrounds use pale blue, not green.
   - Avoid making every surface or label blue.

3. Preserve semantic state colors.
   - Agent online and completed task dots use success green.
   - Running/active task state uses interaction blue.
   - Review and warning states use amber.
   - Errors, rejection, removal, and copy failure use danger red.
   - Patch transformed/added states use success colors.

4. Refresh application chrome.
   - Top bar should read as a crisp desktop toolbar rather than a warm strip.
   - Project sidebar and Agent panel use subtly different cool surfaces while
     remaining visually connected.
   - Main editor remains white and visually dominant.
   - Borders should be clear at normal desktop brightness without looking dark.
   - QC strip should remain compact and semantically secondary.

5. Keep controls precise.
   - Buttons and inputs retain current sizes and radii.
   - Disabled states remain visibly disabled.
   - Focus states are obvious.
   - Text remains legible at 320 px Agent width.
   - No new shadows or decorative effects.

6. Clean theme debt.
   - Replace repeated hard-coded danger/success/warning colors where they are
     part of this app's shell/components.
   - Remove unused `.agent-brief*` CSS left after TASK-016.
   - Do not perform unrelated CSS refactors.

7. Tests.
   - Existing tests must remain green.
   - If AgentPanel changes from accent to success online status, add or update a
     focused test only if current tests expose that contract.
   - Do not add brittle tests for exact hex values.

## Acceptance Criteria

- At first glance the application reads as a cool, modern scientific desktop
  editor inspired by GenePad rather than the previous warm gray/green theme.
- The main workspace is predominantly white/cool neutral, not blue-dominated.
- Blue, green, amber, and red each have clear semantic roles.
- Selected, hover, focus, disabled, success, warning, and error states remain
  distinguishable.
- No horizontal overflow or Agent collapse/wide regression is introduced.
- Existing functionality and tests remain intact.

## Verification Commands

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

## Self-Review Checklist

- Confirm only allowed files changed.
- Scan all CSS hex/rgb values and justify any remaining hard-coded semantic
  color.
- Confirm the palette is not beige, forest-green-dominant, or blue monochrome.
- Confirm semantic task and patch states retain distinct colors.
- Confirm obsolete `.agent-brief*` CSS is removed.
- Confirm no layout, dimensions, or interaction behavior changed.
- Report failures rather than hiding them.

## Delivery Contract

Claude returns only the structured report requested by the orchestration
script. Keep paths and risk descriptions short; do not write a narrative
implementation summary.
