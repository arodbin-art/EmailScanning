#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "Usage: $0 <mapping-file> -- <command...>"
  exit 1
fi

MAPPING="$1"
shift
[[ "$1" == "--" ]] || { echo "Expected -- before command"; exit 1; }
shift

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACES_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
INJECT_SCRIPT="$WORKSPACES_ROOT/vaultSolution/tooling/scripts/inject_env_from_vault.sh"
VAULT_ENV_FILE="${VAULT_ENV_FILE:-$HOME/.config/vaultsolution/vault.env}"

[[ -x "$INJECT_SCRIPT" ]] || { echo "Missing inject script: $INJECT_SCRIPT"; exit 1; }
[[ -f "$MAPPING" ]] || { echo "Missing mapping file: $MAPPING"; exit 1; }
if [[ -f "$VAULT_ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$VAULT_ENV_FILE"
fi

exec "$INJECT_SCRIPT" --backend hcv --mapping "$MAPPING" -- "$@"
