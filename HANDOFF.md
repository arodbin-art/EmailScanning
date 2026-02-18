# EmailScanning Handoff

Last updated: 2026-02-18T23:40:00Z

## Current state
- Signal engine service is running on NAS in /media/nas/workspaces/EmailScanning.
- Gmail ingestion works, GMAIL_QUERY is set to in:anywhere to include spam.
- Admin web UI is running and can edit mail accounts and monitors.
- Admin web UI now includes an Events page to review all outbox events, including rejected delivery responses.
- Amazon return and refund parsing exists and emits amazon events to events_outbox.
- Parser now handles item titles from subjects/links, drop-off dates without year, and drop-off confirmation emails.
- Amazon replay emitted 12 events to events_outbox.
- Near-miss logging added for failed Amazon parsing (amazon_return_near_miss), with optional Azure OpenAI suggestions.
- Amazon near-miss AI suggestions enabled in Azure dev job (AMAZON_AI_ENABLED=true).
- Azure dev deployment created as a Container Apps Job (manual trigger) in rg-email-scanning-dev.
- Azure Automation schedule now triggers the ingestion job and a delivery job every 30 minutes via runbook (managed identity).
- Delivery job is configured with MoneyRecovery credentials in local `.env`; latest delivery run reached MoneyRecovery and rejected events with `no_candidate_rvi_found`.
- Amazon return replay tool available for dry-run or emission from stored emails.
- Azure Postgres firewall now has rule `allow-email-scanning-current` for current public IP.
- Cron job installed to auto-refresh Azure Postgres firewall IP every 10 minutes.

## Running services on NAS
- Admin UI dev server: http://nas:5175
- Admin API dev server: http://nas:4000
- Admin API process pid: 3998537
- Admin UI process pid: 3999213
- Admin token file: /media/nas/workspaces/EmailScanning/email-scanning-admin/.admin_token

## Azure dev admin app (control plane)
- Container App: email-scanning-admin-dev
- URL: https://email-scanning-admin-dev.icyrock-837789e5.canadacentral.azurecontainerapps.io/admin/dashboard
- Notes:
- API requires ADMIN_TOKEN; UI can read runtime token from localStorage key `email_scanning_admin_token`.
- Events page URL: https://email-scanning-admin-dev.icyrock-837789e5.canadacentral.azurecontainerapps.io/admin/events

## Azure dev deployment
- Resource group: rg-email-scanning-dev
- Container Apps environment: email-scan-dev-env
- ACR: emailscanacr354705
- Job: signal-engine-dev (manual trigger)
- Image: emailscanacr354705.azurecr.io/signal-engine:dev
- Last manual run: 2026-02-06T05:29:13Z (poll summary logged, 16 new emails)
- Last automation run: 2026-02-06T13:56:38Z (poll summary logged, 25 new emails)

## Azure automation schedule
- Automation account: email-scan-automation
- Runbook: trigger-signal-engine-job
- Schedule: signal-engine-30min (every 30 minutes, UTC)
- Runbook parameters: SubscriptionId, ResourceGroup=rg-email-scanning-dev, IngestionJobName=signal-engine-dev, DeliveryJobName=signal-engine-deliver-dev

## Azure delivery job
- Job: signal-engine-deliver-dev (manual trigger)
- Runs: node dist/delivery/index.js
- Requires:
- DATABASE_URL (same as ingestion)
- RVI_BASE_URL (MoneyRecovery API base)
- RVI_BEARER_TOKEN (MoneyRecovery JWT, currently obtained via UI localStorage authToken)
- RVI_DELIVERY_KIND=money_recovery

## Key commands
- Ingestion poll: node dist/ingestion/index.js --provider gmail --limit 20
- Amazon parser test: npm run test:amazon:return-parser
- Amazon replay (dry-run): npm run replay:amazon -- --since-days 14 --limit 50
- Amazon replay (emit events): npm run replay:amazon -- --since-days 14 --limit 50 --emit
- Delivery worker: node dist/delivery/index.js
- Amazon near-miss query:
- select * from amazon_return_near_miss order by received_at desc;

## Recent checks
- Amazon replay dry-run (2026-02-06): scanned 11, parsed 11 (last 14 days).
- Latest Azure job poll (2026-02-06T13:56Z): 25 new, 25 existing, errors 0.
- events_outbox amazon events: 12 rows (after replay).
- Amazon replay covers return request + drop-off confirmation templates.
- Delivery run (2026-02-18T22:59Z): DB connectivity restored; 8 events moved to `rejected` with reason `no_candidate_rvi_found`.
- Admin app redeploy (2026-02-18T23:33Z): new UI bundle includes Events page and `/api/events` integration.

## Amazon return parsing
- Parser file: src/automation/amazonReturnParser.ts
- Emits events: amazon.return_requested and amazon.refund_issued
- Dedupe: md5 of provider, order_id, event_type
- Payload includes order_id, item_title, amount or refund_amount, drop_off_by, and email metadata

## RVI integration plan
- Signal engine emits Amazon events to `events_outbox`.
- Delivery worker can translate Amazon events into MoneyRecovery API calls when configured:
- Lookup `amazon_order_id` external reference (source `signal-engine`).
- If missing, try `/rvi/returns/candidates?merchant=Amazon&amount_total=...` and only auto-link if there is exactly one candidate.
- For `amazon.return_dropped_off`, marks return flow submitted.
- For `amazon.refund_issued`, marks return flow refunded (uses email received timestamp as `refunded_at`).
- It does not auto-create RVIs because MoneyRecovery `POST /rvi` requires `person_code`, which is not derivable from emails safely.

## Next steps
- Add or sync MoneyRecovery external references for Amazon order IDs so candidate matching can resolve uniquely.
- Re-run delivery after references/candidates are available:
- Command: `npm run deliver`
- Optional: add a dedicated admin table/page for unresolved candidate diagnostics.

## Notes
- Database schema is email_scanning in the signal_engine database.
- Admin UI uses VITE_API_BASE_URL to reach the API, and defaults to http://nas:4000.
- Firewall sync script: `ops/azure/update_pg_firewall_ip.sh`
- Cron line: `*/10 * * * * cd /media/nas/workspaces/EmailScanning && /media/nas/workspaces/EmailScanning/ops/azure/update_pg_firewall_ip.sh >> /media/nas/workspaces/EmailScanning/ops/logs/update_pg_firewall_ip.log 2>&1`
