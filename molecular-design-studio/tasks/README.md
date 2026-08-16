# Task Queue

Tasks are executed sequentially unless Codex explicitly marks them independent.

Statuses:

- `draft`
- `ready`
- `in_progress`
- `changes_requested`
- `accepted`
- `blocked`

Claude may implement only tasks marked `ready` or `changes_requested`.
Acceptance is owned by Codex.
