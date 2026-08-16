# TASK-020: GenePad Palette Refinement

Status: accepted

Accepted review: `reviews/TASK-020-review-2.md`

## Objective

Refine the accepted light theme using the actual GenePad daytime application
screenshot as a visual reference. Make Molecular Design Studio read as a quiet,
high-density desktop editor: white primary work surface, near-white neutral
chrome, subtle borders, charcoal primary controls, and blue reserved for focus,
selection, links, and active processing.

This is a palette-only task. Do not copy GenePad branding, icons, layout,
assets, or component structure.

## Visual Reference

Reference inspected by Codex on 2026-06-29:

- `https://genepad.pages.dev/#screenshots`
- GenePad daytime application preview

Useful visual characteristics:

- the editor canvas is clear white and visually dominant;
- toolbar and panels are only slightly darker than the canvas;
- panel dividers are thin, cool neutral gray;
- selected navigation and primary commands use near-black/charcoal controls;
- blue is concentrated in sequence selections, focus, and data content rather
  than spread across application chrome;
- green, orange, and blue remain available as biological/data colors;
- controls are compact with restrained radius and no decorative effects.

## Product Invariants

- Preserve all layout, dimensions, typography, OVE behavior, Agent behavior,
  and interactions.
- Do not override OVE feature, enzyme, primer, or sequence colors.
- Main editor remains white and visually dominant.
- Charcoal means primary command/current mode; blue means interactive focus,
  link, selection, or active processing.
- Success, warning, and danger keep distinct green, amber, and red semantics.
- Maintain readable contrast for normal, hover, focus, selected, and disabled
  states.
- Do not add gradients, shadows, dark mode, decorative graphics, or new UI.

## In Scope

- Refine global palette tokens in `:root`.
- Add explicit neutral command/control tokens if needed.
- Apply neutral near-white surfaces to top bar, sidebar, Agent panel, toolbar,
  QC strip, composer, and compact secondary surfaces.
- Use charcoal for primary command buttons and active workspace mode.
- Keep blue for links, focus rings, selected data, running task state, and
  lightweight informational emphasis.
- Reduce blue-gray tint and contrast heaviness in borders and side panels.
- Keep semantic success/warning/danger colors restrained but clear.
- Replace remaining theme-related hard-coded shell colors when useful.

## Out of Scope

- Component JSX/TSX changes.
- Sidebar functionality or navigation behavior.
- Layout, spacing, sizing, radius, or typography redesign.
- OVE CSS or biological feature colors.
- New dependencies, icons, controls, themes, or animations.
- Backend or Tauri changes.

## Allowed Files

- `src/App.css`
- `tasks/TASK-020-genepad-palette-refinement.md`
- `reviews/TASK-020-review-1.md`

Do not modify any other file.

## Required Implementation

1. Refine neutral surfaces.
   - App background around `#f3f5f7` to `#f6f7f9`.
   - Top bar and editor toolbar near white.
   - Sidebar and Agent panel use a very light neutral gray, not obvious blue.
   - Raised surfaces remain white.
   - Borders move to quiet cool-gray values around `#d9dee5` with lighter
     secondary dividers.

2. Separate command color from blue accent.
   - Add charcoal control tokens around `#171b22` with a restrained hover.
   - Primary command buttons and active Agent workspace use charcoal.
   - Do not turn every active task status charcoal; running remains blue.
   - Disabled controls stay visibly disabled.

3. Reserve blue for focused interaction.
   - Keep a medium, clean blue for focus borders, links, selected data, and
     running task indicators.
   - Pale blue backgrounds should be subtle and sparse.
   - Top-bar branding and sidebar selection should not make the shell feel
     blue-dominant.

4. Make navigation and panels quiet.
   - Sidebar active item should use a white/neutral selected surface and dark
     text, with only a small blue cue if needed.
   - Agent panel should feel connected to the app shell, not like a blue-gray
     block.
   - Composer and result/task surfaces should use white or near-white surfaces
     separated by subtle borders.

5. Preserve semantic states.
   - Online/completed stays green.
   - Review/warning stays amber.
   - Error/destructive stays red.
   - Ensure these colors are not replaced by charcoal or blue.

6. Keep the change CSS-only and narrowly scoped.
   - Do not change selectors for layout or behavior.
   - Do not add component-specific one-off colors where a token is appropriate.
   - Scan remaining hex/rgb values and leave biological/semantic exceptions
     intact.

## Acceptance Criteria

- At first glance the shell resembles GenePad's daytime palette logic: white
  workspace, near-white neutral chrome, charcoal commands, sparse blue.
- The app no longer reads as blue-gray across both side panels.
- Primary actions are visually distinct from links/focus/running state.
- Semantic task, warning, success, and error states remain immediately clear.
- Text and controls remain legible at the normal 1280x720 viewport.
- No layout shift, overflow, behavior change, or OVE color override appears.

## Verification Commands

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

## Self-Review Checklist

- Confirm only allowed files changed.
- Compare the app at 1280x720 against the GenePad daytime screenshot.
- Confirm main editor is the brightest/largest visual surface.
- Confirm shell is neutral rather than blue-gray or monochrome.
- Confirm primary controls are charcoal and focus/running indicators are blue.
- Confirm success, warning, and danger remain distinct.
- Confirm no OVE selectors or feature colors changed.
- Report failures rather than hiding them.

## Delivery Contract

Claude returns only the structured report requested by the orchestration
script. Keep paths and risk descriptions short; do not write a narrative
implementation summary.
