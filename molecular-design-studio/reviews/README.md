# Review Notes

Codex writes task-specific review notes here when Claude changes require
revision. A review file should contain actionable findings ordered by severity,
with file paths, expected behavior, and rerun commands.

Claude receives the review file through `scripts/continue-claude-task.sh` and
continues the same session used for the original implementation.
