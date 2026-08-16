# TASK-023: Larger Agent Composer

Status: accepted

Accepted review: `reviews/TASK-023-review-1.md`

## Objective

Make the Agent message composer comfortable for multi-line molecular design
instructions instead of presenting it as a cramped single-line field.

## Product Invariants

- Preserve Enter-to-send and Shift+Enter-for-newline behavior.
- Preserve disabled, busy, online/offline, and send-button behavior.
- Keep the composer pinned below the scrollable task stream.
- Preserve the 400 / 560 / 36 px Agent panel widths.
- Do not introduce horizontal overflow or hide the send button.

## Required Implementation

1. Render the textarea with a three-row default size.
2. Give it a default visual height of about 68-76 px.
3. Continue auto-growing while typing, up to about 180 px.
4. After sending, reset to the default three-row height, not a single line.
5. Keep the send button bottom-aligned and fully visible.
6. Add or update focused tests for the row count and reset behavior.

## Allowed Files

- `src/components/AgentPanel.tsx`
- `src/components/AgentPanel.test.tsx`
- `src/App.css`
- `tasks/TASK-023-larger-agent-composer.md`
- `reviews/TASK-023-review-1.md`

Do not modify any other file. Do not commit changes.

## Acceptance Criteria

- The empty composer is visibly about three text lines tall.
- Long prompts are easier to review before submission.
- Auto-growth stops before consuming the full Agent panel.
- Sending clears the text and restores the default height.
- Enter and Shift+Enter behavior remains unchanged.
- Existing tests and build remain green.

## Verification Commands

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

## Delivery Contract

Implement the task, run all verification commands, and return a concise report
listing changed files, test results, and any residual risk. Do not commit.
