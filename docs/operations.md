# Operations

## Autonomous schedule (systemd, every 15 minutes)
Install the new unified service/timer (poll + delivery in one run):

```bash
sudo cp ops/systemd/email-scanning.service /etc/systemd/system/
sudo cp ops/systemd/email-scanning.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now email-scanning.timer
```

Check status/logs:

```bash
systemctl status email-scanning.timer
systemctl status email-scanning.service
journalctl -u email-scanning.service -n 200 --no-pager
tail -n 200 /media/nas/workspaces/EmailScanning/logs/email-scanning.log
```

Manual one-shot run:

```bash
npm run run:scheduled
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

## Delivery auth (unattended)
Preferred: Entra client credentials for delivery worker.

Required:
- `RVI_BASE_URL`
- `RVI_DELIVERY_KIND=money_recovery`

Auth options:
1. Static token:
   - `RVI_AUTH_MODE=static`
   - `RVI_BEARER_TOKEN=<jwt>`
2. Client credentials (preferred):
   - `RVI_AUTH_MODE=client_credentials`
   - `RVI_AUTH_TENANT_ID`
   - `RVI_AUTH_CLIENT_ID`
   - `RVI_AUTH_CLIENT_SECRET`
   - `RVI_AUTH_RESOURCE=api://<money-recovery-api-app-id>`

Notes:
- Delivery token minting uses OAuth client credentials (not Azure CLI tokens).
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
