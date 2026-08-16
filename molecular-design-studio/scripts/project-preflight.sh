#!/usr/bin/env bash
set -uo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
mode="${1:-fast}"
report_file="${2:-}"

if [[ "$mode" != "fast" && "$mode" != "release" ]]; then
  echo "Usage: $0 [fast|release] [report-file]" >&2
  exit 2
fi

commands=(
  "npm run typecheck"
  "npm run lint"
  "npm test -- --run"
)

if [[ "$mode" == "release" ]]; then
  commands+=(
    "npm run build"
    "cargo check --manifest-path src-tauri/Cargo.toml"
  )
fi

tmp_file="$(mktemp)"
trap 'rm -f "$tmp_file"' EXIT
overall=0

cd "$repo_root"
printf '{"mode":"%s","checks":[' "$mode" > "$tmp_file"

separator=""
for command in "${commands[@]}"; do
  echo "==> $command"
  if zsh -lc "$command"; then
    status="pass"
  else
    status="fail"
    overall=1
  fi

  printf '%s' "$separator" >> "$tmp_file"
  jq -cn --arg command "$command" --arg status "$status" \
    '{command: $command, status: $status}' >> "$tmp_file"
  separator=","
done

printf ']}\n' >> "$tmp_file"

if [[ -n "$report_file" ]]; then
  mkdir -p "$(dirname -- "$report_file")"
  jq . "$tmp_file" > "$report_file"
fi

echo
jq -c . "$tmp_file"
exit "$overall"
