#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
UI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKSPACES_ROOT="$(cd "$UI_DIR/../../.." && pwd)"
INJECT_SCRIPT="$WORKSPACES_ROOT/vaultSolution/tooling/scripts/inject_env_from_vault.sh"
MAPPING="$UI_DIR/../../ops/vault/hcv-admin-ui.envmap"
VAULT_ENV_FILE="${VAULT_ENV_FILE:-$HOME/.config/vaultsolution/vault.env}"

[[ -x "$INJECT_SCRIPT" ]] || { echo "Missing inject script: $INJECT_SCRIPT"; exit 1; }
[[ -f "$MAPPING" ]] || { echo "Missing mapping file: $MAPPING"; exit 1; }
if [[ -f "$VAULT_ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$VAULT_ENV_FILE"
fi

[[ $# -gt 0 ]] || { echo "Usage: $0 <command...>"; exit 1; }

exec "$INJECT_SCRIPT" --backend hcv --mapping "$MAPPING" -- "$@"
