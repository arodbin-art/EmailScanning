#!/usr/bin/env bash
set -euo pipefail

RG="${AZ_PG_RG:-GiftTrackerRG}"
SERVER="${AZ_PG_SERVER:-gift-tracker-db-rod}"
RULE="${AZ_PG_RULE:-allow-email-scanning-current}"
IP_SOURCE_URL="${IP_SOURCE_URL:-https://api.ipify.org}"

if ! command -v az >/dev/null 2>&1; then
  echo "az CLI not found" >&2
  exit 1
fi

CURRENT_IP="$(curl -fsS "$IP_SOURCE_URL" | tr -d '[:space:]')"
if [[ ! "$CURRENT_IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  echo "Failed to detect a valid IPv4 address: '$CURRENT_IP'" >&2
  exit 1
fi

EXISTING_START="$(az postgres flexible-server firewall-rule show \
  -g "$RG" \
  -n "$SERVER" \
  -r "$RULE" \
  --query startIpAddress -o tsv 2>/dev/null || true)"
EXISTING_END="$(az postgres flexible-server firewall-rule show \
  -g "$RG" \
  -n "$SERVER" \
  -r "$RULE" \
  --query endIpAddress -o tsv 2>/dev/null || true)"

if [[ "$EXISTING_START" == "$CURRENT_IP" && "$EXISTING_END" == "$CURRENT_IP" ]]; then
  echo "No change. Firewall rule '$RULE' already set to $CURRENT_IP"
  exit 0
fi

az postgres flexible-server firewall-rule create \
  -g "$RG" \
  -n "$SERVER" \
  -r "$RULE" \
  --start-ip-address "$CURRENT_IP" \
  --end-ip-address "$CURRENT_IP" \
  --output none

echo "Updated firewall rule '$RULE' on '$SERVER' to $CURRENT_IP"
