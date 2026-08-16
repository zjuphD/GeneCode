#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 tasks/TASK-XXX.md reviews/TASK-XXX-review-N.md" >&2
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/claude-common.sh"
resolve_task_path "$1"
require_claude_client
prepare_task_state
review_abs="$repo_root/$2"

if [[ ! -f "$review_abs" ]]; then
  echo "Review file not found: $review_abs" >&2
  exit 2
fi

session_file="$repo_root/.orchestration/sessions/${task_name}.session"
if [[ ! -f "$session_file" ]]; then
  echo "No saved Claude session for $task_name" >&2
  exit 1
fi

session_id="$(cat "$session_file")"
timestamp="$(date +%Y%m%d-%H%M%S)"
output_file="$run_dir/${task_name}-revision-${timestamp}.json"

printf -v prompt '%s\n' \
  "Continue the implementation of $task_abs." \
  "" \
  "Codex reviewed the current changes. Read and address every actionable" \
  "finding in $review_abs. Stay within the original task scope, do not commit," \
  "and rerun affected checks plus all task-required final checks. Return the" \
  "structured result requested by the caller."

cd "$repo_root"
"$ccb_bin" \
  --print \
  --output-format json \
  --json-schema "$report_schema" \
  --append-system-prompt "$compact_policy" \
  --permission-mode dontAsk \
  --allowedTools "${allowed_tools[@]}" \
  --resume "$session_id" \
  "$prompt" | tee "$output_file"

save_compact_report "$output_file"
echo
echo "Session: $session_id"
echo "Transcript: $output_file"
