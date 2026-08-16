#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 tasks/TASK-XXX.md" >&2
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/claude-common.sh"
resolve_task_path "$1"
require_claude_client
prepare_task_state

timestamp="$(date +%Y%m%d-%H%M%S)"
output_file="$run_dir/${task_name}-${timestamp}.json"
session_file="$session_dir/${task_name}.session"

printf -v prompt '%s\n' \
  "Implement only the task in $task_abs." \
  "" \
  "Read CLAUDE.md and the task file first. Obey scope and prohibited behavior." \
  "Do not commit. Run the task verification commands and return the structured" \
  "result requested by the caller."

cd "$repo_root"
"$ccb_bin" \
  --print \
  --output-format json \
  --json-schema "$report_schema" \
  --append-system-prompt "$compact_policy" \
  --permission-mode dontAsk \
  --allowedTools "${allowed_tools[@]}" \
  --name "$task_name" \
  "$prompt" | tee "$output_file"

session_id="$(jq -r ".session_id // empty" "$output_file")"
if [[ -z "$session_id" ]]; then
  echo "Claude output did not include a session_id." >&2
  exit 1
fi

printf '%s\n' "$session_id" > "$session_file"
save_compact_report "$output_file"
echo
echo "Session: $session_id"
echo "Saved: $session_file"
echo "Transcript: $output_file"
