#!/bin/zsh
set -euo pipefail

keychain_service="com.genecode.cloudflare-backend"
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
python_bin="${GENECODE_PYTHON:-$(command -v python3)}"
keychain_account="${USER:-$(id -un)}"

api_token="$(/usr/bin/security find-generic-password \
  -a "$keychain_account" \
  -s "$keychain_service" \
  -w)"

if [[ -z "$api_token" ]]; then
  print -u2 "GeneCode backend token is missing from the macOS Keychain."
  exit 1
fi

export GENE_CODE_API_TOKEN="$api_token"
cd "$repo_root"
exec "$python_bin" server.py --host 127.0.0.1 --port 8000
