# Operations

## Autonomous schedule (systemd, every 15 minutes)
Install the new unified service/timer (poll + delivery in one run):

```bash
sudo cp ops/systemd/email-scanning.service /etc/systemd/system/
sudo cp ops/systemd/email-scanning.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now email-scanning.timer
```

Notes:
- Service template now runs `npm run run:scheduled:vault` (Vault-injected secret env).
- Ensure `/home/rod/.config/vaultsolution/vault.env` exists with valid `VAULT_ADDR` + `VAULT_TOKEN`.

Check status/logs:

```bash
systemctl status email-scanning.timer
systemctl status email-scanning.service
journalctl -u email-scanning.service -n 200 --no-pager
tail -n 200 /media/nas/workspaces/EmailScanning/logs/email-scanning.log
```

Manual one-shot run:

```bash
npm run run:scheduled:vault
```

Admin local runs (vault-backed):

```bash
cd email-scanning-admin/api && npm run dev:vault
cd email-scanning-admin/ui && npm run dev:vault
```

## Log rotation
Install the included logrotate policy:

```bash
sudo cp ops/systemd/email-scanning.logrotate /etc/logrotate.d/email-scanning
sudo logrotate -f /etc/logrotate.d/email-scanning
```

## Ingestion AI controls (rules-first)
Defaults are rules-only:

- `AI_ENABLED=false`
- `AMAZON_AI_ENABLED=false`
- `MANULIFE_AI_ENABLED=false`

Behavior:
- Missing AI credentials never blocks ingestion.
- AI is optional and only used for near-miss suggestions.

## iGPT shadow mode (parallel, non-mutating)
Optional comparison path that runs in parallel with deterministic parsing:

- `IGPT_ENABLED=false` (default)
- `IGPT_AUTH_MODE=api_key` (default; service key only)
- `IGPT_API_KEY=...`
- `IGPT_BASE_URL=https://api.igpt.ai`
- `IGPT_SESSION_FALLBACK_ENABLED=false` (default; when `true`, `auto` mode may use session fallback)
- `IGPT_SESSION_TOKEN=...`
- `IGPT_SESSION_DEVICE_ID=...`
- `IGPT_SESSION_BASE_URL=https://igpt.ai/api/v1`
- `IGPT_TIMEOUT_MS=5000`
- `IGPT_FALLBACK_ENABLED=false` (optional, Azure OpenAI fallback when iGPT auth/response fails)

Behavior:
- iGPT never writes to `events_outbox` in this phase.
- iGPT candidate signals are stored in `email_scanning.ai_candidate_events` only.
- Ingestion remains non-blocking if iGPT fails.
- Optional fallback (`IGPT_FALLBACK_ENABLED=true`) uses configured Azure OpenAI credentials to generate shadow candidates for Amazon/Manulife-like emails when iGPT fails auth or returns empty.

Compare deterministic vs shadow results:

```bash
npm run compare:intelligence -- --since-days 14
```

Backfill historical stored emails into `ai_candidate_events` (shadow only):

```bash
npm run backfill:intelligence -- --since-days 14 --limit 200 --dry-run
npm run backfill:intelligence -- --since-days 14 --limit 200
npm run backfill:intelligence -- --since-days 365 --provider gmail --force --amazon-manulife-only --object-timeout-ms 10000
```

Notes:
- `--dry-run` analyzes and logs counts, but does not persist rows.
- default mode skips emails that already have ai candidates; add `--force` to reprocess.
- `--amazon-manulife-only` narrows scanning to likely Amazon/Manulife senders/subjects.
- `--object-timeout-ms` prevents hangs on slow object reads (default `20000`).

## Delivery auth (unattended)
Preferred: Entra client credentials for delivery worker.

Required:
- `RVI_BASE_URL`
- `RVI_DELIVERY_KIND=money_recovery`

Auth options:
1. Client credentials (default):
   - `RVI_AUTH_MODE=client_credentials`
   - `RVI_AUTH_TENANT_ID`
   - `RVI_AUTH_CLIENT_ID`
   - `RVI_AUTH_CLIENT_SECRET`
   - `RVI_AUTH_RESOURCE=api://<money-recovery-api-app-id>`
2. Static token (emergency fallback only):
   - `RVI_AUTH_MODE=static`
   - `RVI_BEARER_TOKEN=<jwt>`
   - `RVI_STATIC_BEARER_ALLOW=true`

Notes:
- Delivery defaults to OAuth client credentials (not Azure CLI tokens).
- Static bearer mode is blocked unless `RVI_STATIC_BEARER_ALLOW=true`.
- Worker auto-refreshes tokens before expiry.

## Delivery behavior
### Amazon
- Events:
  - `amazon.return_requested`
  - `amazon.return_dropped_off`
  - `amazon.refund_issued`
- Association:
  - external ref lookup: `source=email_scanning`, `ref_type=amazon_order_id`
  - fallback candidate lookup: `/rvi/returns/candidates`
  - auto-create return RVI when no match and mail account has `moneyrecovery_person_code`
  - `moneyrecovery_person_code` must be a valid 3-letter MoneyRecovery person code (`ROD|PRI|CHA|YAS|ADR`)
- No person code mapping:
  - event status -> `needs_review` with `missing_person_code_mapping_for_mail_account`

### Manulife
- Events:
  - `manulife.claim_received`
  - `manulife.claim_processed`
  - `manulife.claim_paid`
  - `manulife.claim_denied`
  - `manulife.claim_info_required`
  - `manulife.claim_status_update`
- Association:
  - external ref lookup: `source=email_scanning`, `ref_type=manulife_claim_id`
  - fallback candidate pass over `/rvi/urgent` by person/amount/date
  - auto-create insurance RVI when safe and `moneyrecovery_person_code` exists
- If claim status has no direct MoneyRecovery field (denied/info-required/status-update):
  - event -> `needs_review` with extracted status/amounts in delivery log

## Backfill command
Reprocess older rejected Amazon no-candidate events:

```bash
npm run deliver:backfill:amazon
```

## Monitor templates (Admin Hub)
In `Monitors`:
- `Add Amazon Template`
- `Add Manulife Template`

In `Events`:
- filter by status
- filter by event family (`amazon` / `manulife`)

## Near-miss tables
Amazon:

```sql
select received_at, subject, order_id, expected_event_type, missing_fields, reason, ai_suggestion
from email_scanning.amazon_return_near_miss
order by received_at desc;
```

Manulife:

```sql
select received_at, subject, claim_id, status_text, parse_reason, extracted_candidates
from email_scanning.manulife_claim_near_miss
order by received_at desc;
```

## Verification checklist
1. Poll once:
   - `npm run poll -- --provider gmail --limit 20`
2. Deliver once:
   - `npm run deliver`
3. Confirm outbox status split:

```sql
select event_type, status, count(*) 
from email_scanning.events_outbox
group by event_type, status
order by event_type, status;
```

4. Confirm latest delivery logs:

```sql
select event_id, delivered_at, rvi_response
from email_scanning.events_delivery_log
order by delivered_at desc
limit 50;
```

## Azure Postgres firewall drift
Updater script:

```bash
ops/azure/update_pg_firewall_ip.sh
```

Existing cron:

```bash
*/10 * * * * cd /media/nas/workspaces/EmailScanning && /media/nas/workspaces/EmailScanning/ops/azure/update_pg_firewall_ip.sh >> /media/nas/workspaces/EmailScanning/ops/logs/update_pg_firewall_ip.log 2>&1
```

## Handoff
See `HANDOFF.md` for current deployment and auth notes.
