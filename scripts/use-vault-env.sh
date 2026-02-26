#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VAULT_ENV="/media/nas/workspaces/vaultSolution/runtime/projects/EmailScanning/.env.runtime"
TARGET="$PROJECT_ROOT/.env"
ADMIN_API_ENV="$PROJECT_ROOT/email-scanning-admin/api/.env"
ADMIN_UI_ENV="$PROJECT_ROOT/email-scanning-admin/ui/.env"

backup_if_plain() {
  local file="$1"
  if [[ -f "$file" && ! -L "$file" ]]; then
    local backup="$file.pre-vault.$(date +%Y%m%d%H%M%S).bak"
    mv "$file" "$backup"
    chmod 600 "$backup" || true
    echo "Backed up plaintext env to $backup"
  fi
}

if [[ ! -f "$VAULT_ENV" ]]; then
  echo "Missing runtime env: $VAULT_ENV" >&2
  echo "Run: /media/nas/workspaces/vaultSolution/bin/vaultctl render --project EmailScanning" >&2
  exit 1
fi

backup_if_plain "$TARGET"
backup_if_plain "$ADMIN_API_ENV"
backup_if_plain "$ADMIN_UI_ENV"

ln -sfn "$VAULT_ENV" "$TARGET"
ln -sfn "$VAULT_ENV" "$ADMIN_API_ENV"
ln -sfn "$VAULT_ENV" "$ADMIN_UI_ENV"
echo "Linked $TARGET -> $VAULT_ENV"
echo "Linked $ADMIN_API_ENV -> $VAULT_ENV"
echo "Linked $ADMIN_UI_ENV -> $VAULT_ENV"
