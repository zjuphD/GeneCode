#!/usr/bin/env bash

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
ccb_bin="${CCB_BIN:-/Users/lichen/.hermes/node/bin/ccb}"

allowed_tools=(
  "Read"
  "Edit"
  "Write"
  "Glob"
  "Grep"
  "Bash(test:*)"
  "Bash(cat:*)"
  "Bash(cmp:*)"
  "Bash(diff:*)"
  "Bash(grep:*)"
  "Bash(ls:*)"
  "Bash(find:*)"
  "Bash(mkdir:*)"
  "Bash(python3:*)"
  "Bash(npm:*)"
  "Bash(npx:*)"
  "Bash(cargo:*)"
  "Bash(curl:*)"
  "Bash(rustc:*)"
  "Bash(git status:*)"
  "Bash(git diff:*)"
  "Bash(git rev-parse:*)"
)

report_schema='{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "status": {
      "type": "string",
      "enum": ["completed", "blocked"]
    },
    "changed": {
      "type": "array",
      "maxItems": 20,
      "items": {"type": "string"}
    },
    "checks": {
      "type": "array",
      "maxItems": 12,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "command": {"type": "string"},
          "status": {
            "type": "string",
            "enum": ["pass", "fail", "not_run"]
          }
        },
        "required": ["command", "status"]
      }
    },
    "blockers": {
      "type": "array",
      "maxItems": 5,
      "items": {"type": "string"}
    },
    "risks": {
      "type": "array",
      "maxItems": 5,
      "items": {"type": "string"}
    }
  },
  "required": ["status", "changed", "checks", "blockers", "risks"]
}'

compact_policy='Work autonomously and stay inside the active task. Inspect only task-relevant files. Self-review once against every acceptance criterion before finishing. Do not repeat successful checks unless a later edit can affect them. Do not write a narrative report: return only the requested structured result, with short paths and short risk descriptions.'

require_claude_client() {
  if [[ ! -x "$ccb_bin" ]]; then
    echo "Claude Code client not executable: $ccb_bin" >&2
    exit 1
  fi
}

resolve_task_path() {
  local requested="$1"

  if [[ "$requested" = /* ]]; then
    task_abs="$requested"
  else
    task_abs="$repo_root/$requested"
  fi

  if [[ ! -f "$task_abs" ]]; then
    echo "Task file not found: $task_abs" >&2
    exit 2
  fi

  case "$task_abs" in
    "$repo_root"/tasks/*) ;;
    *)
      echo "Task must be inside $repo_root/tasks" >&2
      exit 2
      ;;
  esac

  task_name="$(basename "$task_abs" .md)"
}

prepare_task_state() {
  run_dir="$repo_root/.orchestration/runs"
  session_dir="$repo_root/.orchestration/sessions"
  base_dir="$repo_root/.orchestration/base"
  report_dir="$repo_root/.orchestration/reports"
  mkdir -p "$run_dir" "$session_dir" "$base_dir" "$report_dir"

  base_file="$base_dir/${task_name}.commit"
  if [[ ! -f "$base_file" ]]; then
    git -C "$repo_root" rev-parse HEAD > "$base_file"
  fi
}

save_compact_report() {
  local output_file="$1"
  local report_file="$report_dir/${task_name}.json"
  local structured_output

  structured_output="$(jq -c '.structured_output // (.result | fromjson? // empty)' "$output_file")"

  if [[ -n "$structured_output" ]]; then
    printf '%s\n' "$structured_output" | jq . > "$report_file"
  else
    local base_ref
    local changed
    base_ref="$(cat "$base_file")"
    changed="$(
      {
        git -C "$repo_root" diff --name-only "$base_ref"
        git -C "$repo_root" ls-files --others --exclude-standard
      } | sed '/^$/d' | sort -u | jq -Rsc 'split("\n") | map(select(length > 0))'
    )"

    jq -n --argjson changed "$changed" '{
      status: "completed",
      changed: $changed,
      checks: [],
      blockers: [],
      risks: [
        "Provider omitted structured output; rely on Codex preflight and review"
      ]
    }' > "$report_file"
  fi

  echo
  echo "Compact report:"
  jq -c . "$report_file"
}
