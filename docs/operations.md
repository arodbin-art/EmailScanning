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

## Alerts
Alert on log lines containing:
- `Gmail auth error`
- `Gmail quota error`
- `account ingestion failed`

## AI optional gating
Set `AI_ENABLED=true` to enable AI. When enabled, the OpenAI key is read from `secrets/OpenAI.key`.

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
