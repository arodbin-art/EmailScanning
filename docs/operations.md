# Operations

## Poll scheduling (systemd)
Install the unit files:
```
sudo cp ops/systemd/signal-engine-poll.service /etc/systemd/system/
sudo cp ops/systemd/signal-engine-poll.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now signal-engine-poll.timer
```

Adjust interval by editing `ops/systemd/signal-engine-poll.timer`.

## Azure Postgres firewall IP drift
When your public IP changes, Azure Postgres firewall access can break. This repo includes an updater script:

```
ops/azure/update_pg_firewall_ip.sh
```

Default targets:
- Resource group: `GiftTrackerRG`
- Server: `gift-tracker-db-rod`
- Rule: `allow-email-scanning-current`

Cron (installed on NAS) runs every 10 minutes:

```
*/10 * * * * cd /media/nas/workspaces/EmailScanning && /media/nas/workspaces/EmailScanning/ops/azure/update_pg_firewall_ip.sh >> /media/nas/workspaces/EmailScanning/ops/logs/update_pg_firewall_ip.log 2>&1
```

## Alerts
Alert on log lines containing:
- `Gmail auth error`
- `Gmail quota error`
- `account ingestion failed`

## AI optional gating
Set `AI_ENABLED=true` to enable AI. When enabled, the OpenAI key is read from `secrets/OpenAI.key`.

## MoneyRecovery (RVI) delivery
This service writes detected signals to `events_outbox`. The delivery worker can translate Amazon events into MoneyRecovery API calls.

Environment variables:
- `RVI_BASE_URL` (example: `https://rvi-dev.proudmoss-21bb559c.canadacentral.azurecontainerapps.io`)
- `RVI_BEARER_TOKEN` (MoneyRecovery JWT)
- `RVI_DELIVERY_KIND=money_recovery`

Run the worker:
```
npm run deliver
```

## Amazon near-miss logging + AI fallback
When an Amazon return/refund email fails deterministic parsing, the system records a near-miss row in `amazon_return_near_miss` for tuning.

Optional Azure OpenAI fallback (borrowed from Yasmine Marketplace):
- `AMAZON_AI_ENABLED=true`
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_KEY`
- `AZURE_OPENAI_DEPLOYMENT` (e.g. `yasmine-suggest`)
- `AZURE_OPENAI_API_VERSION` (default `2024-02-15-preview`)

Near-miss query:
```
select
  nm.received_at,
  nm.subject,
  nm.order_id,
  nm.expected_event_type,
  nm.missing_fields,
  nm.reason,
  nm.ai_suggestion
from amazon_return_near_miss nm
order by nm.received_at desc;
```

## Retention check
Run log-only check:
```
npm run retention:check
```

## Gmail filters
Optional:
- `GMAIL_LABEL_IDS=INBOX,UNREAD`
- `GMAIL_QUERY=is:unread`

## Container deployment note (Gmail tokens)
For containerized deployments, you can supply the Gmail token store file via:
- `GMAIL_TOKEN_STORE_B64` (base64 encoded `gmail_tokens.json`)
- `GMAIL_TOKEN_STORE_PATH` (default `secrets/gmail_tokens.json`)

## Find-only validation query
```
select
  e.subject,
  m.name,
  mm.matched_fields
from monitor_matches mm
join emails_raw e on e.id = mm.email_id
join monitors m on m.id = mm.monitor_id
order by mm.matched_at desc;
```

## Manual poll harness
```
node dist/ingestion/index.js --provider gmail --limit 20
```

## Handoff
See HANDOFF.md for current state, progress, and next steps.
