#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 1 ]]; then
  echo "Usage: $0 [TASK-XXX]" >&2
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
cd "$repo_root"

task_name="${1:-}"
base_ref="HEAD"
if [[ -n "$task_name" ]]; then
  base_file="$repo_root/.orchestration/base/${task_name}.commit"
  if [[ ! -f "$base_file" ]]; then
    echo "No recorded base commit for $task_name" >&2
    exit 1
  fi
  base_ref="$(cat "$base_file")"
  echo "== Task =="
  echo "$task_name"
  echo "Base: $base_ref"
  echo
fi

echo "== Status =="
git status --short
echo
echo "== Changed Files =="
git diff --name-status "$base_ref"
git ls-files --others --exclude-standard | sed 's/^/??\t/'
echo
echo "== Diff Stat =="
git diff --stat "$base_ref"
echo
echo "== Diff Check =="
git diff --check "$base_ref"

if [[ -n "$task_name" ]]; then
  claude_report="$repo_root/.orchestration/reports/${task_name}.json"
  preflight_report="$repo_root/.orchestration/reports/${task_name}-preflight.json"

  if [[ -f "$claude_report" ]]; then
    echo
    echo "== Claude Report =="
    jq -c . "$claude_report"
  fi

  if [[ -f "$preflight_report" ]]; then
    echo
    echo "== Codex Preflight =="
    jq -c . "$preflight_report"
  fi
fi
