#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${GMAIL_TOKEN_STORE_B64:-}" ]]; then
  TOKEN_PATH="${GMAIL_TOKEN_STORE_PATH:-secrets/gmail_tokens.json}"
  TOKEN_DIR="$(dirname "$TOKEN_PATH")"
  umask 077
  mkdir -p "$TOKEN_DIR"
  echo "$GMAIL_TOKEN_STORE_B64" | base64 -d > "$TOKEN_PATH"
fi

exec "$@"
