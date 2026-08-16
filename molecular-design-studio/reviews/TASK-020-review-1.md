# TASK-020 Review 1

Status: changes_requested

## Finding

The palette direction is accepted, but `.sidebar-item.active` adds a
`box-shadow` to simulate a border. TASK-020 explicitly prohibits new shadows.

Replace the shadow with a non-shadow treatment that preserves dimensions, such
as a one-pixel outline or an existing neutral border strategy. Do not change
layout, spacing, radius, or any other selector.

Rerun the required checks and confirm `src/App.css` contains no `box-shadow`.
