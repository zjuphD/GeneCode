# TASK-021 Review 1

Status: changes_requested

## Findings

### 1. Palette hashing collapses most pUC19 annotations to one green

The live browser shows `M13mp19`, both Lac-operon entries, and the polylinker in
the same sage green. FNV-1a modulo six is poorly distributed for these shared
`misc_feature::` prefixes, so the promised multi-color grouping is not visible.

Add a final avalanche/mixing step to the hash before palette modulo. Reorder the
palette so the pUC19 source/backbone is a muted medium blue, while its major
feature identities distribute across sage, teal, violet, and a restrained warm
accent. Avoid a brown/orange-dominant result.

Replace the probabilistic-looking test with a deterministic assertion. Add a
focused pUC19 test proving fallback features resolve to at least four distinct
display colors and the source feature is not the dominant warm color.

### 2. Several scoped CSS selectors do not match the real OVE DOM

Live DOM inspection shows:

- active toolbar button:
  `.bp3-button.bp3-active.bp3-minimal.bp3-intent-primary`
- active map tab: `.veTabActive`
- status divider: `.veStatusBarSpacer`
- map tabs use classes such as `.veTabCircularMap` and `.veTabLinearMap`

The current `.veToolbarItem--active`, `.veTab--active`, and
`.veStatusBarItem-spacer` selectors therefore do not apply.

Replace them with the real selectors, all prefixed by `.ove-editor-host`.
Keep the Blueprint active-button override strictly scoped. Use charcoal/white
for the active toolbar button and charcoal border/text for `.veTabActive`.
Keep navigation/selection actions such as Jump to end and Select Inverse blue.

### 3. Re-verify the visible result

After the fixes, rerun all TASK-021 commands. The browser result should show:

- neutral OVE toolbar and status bar;
- charcoal active toolbar control and active map tabs;
- at least four visibly distinct pUC19 annotation colors;
- the same feature colors in sequence and circular maps;
- no console errors or layout changes.
