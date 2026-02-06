# EmailScanning Handoff

Last updated: 2026-02-06T04:53:13Z

## Current state
- Signal engine service is running on NAS in /media/nas/workspaces/EmailScanning.
- Gmail ingestion works, GMAIL_QUERY is set to in:anywhere to include spam.
- Admin web UI is running and can edit mail accounts and monitors.
- Amazon return and refund parsing exists and emits amazon events to events_outbox.
- Parser now handles item titles from subjects/links, drop-off dates without year, and drop-off confirmation emails.
- Amazon replay emitted 12 events to events_outbox.
- Near-miss logging added for failed Amazon parsing (amazon_return_near_miss), with optional Azure OpenAI suggestions.
- Amazon return replay tool available for dry-run or emission from stored emails.

## Running services on NAS
- Admin UI dev server: http://nas:5175
- Admin API dev server: http://nas:4000
- Admin API process pid: 3998537
- Admin UI process pid: 3999213
- Admin token file: /media/nas/workspaces/EmailScanning/email-scanning-admin/.admin_token

## Key commands
- Ingestion poll: node dist/ingestion/index.js --provider gmail --limit 20
- Amazon parser test: npm run test:amazon:return-parser
- Amazon replay (dry-run): npm run replay:amazon -- --since-days 14 --limit 50
- Amazon replay (emit events): npm run replay:amazon -- --since-days 14 --limit 50 --emit
- Delivery worker: node dist/delivery/index.js
- Amazon near-miss query:
- select * from amazon_return_near_miss order by received_at desc;

## Recent checks
- Amazon emails last 14 days: 12 emails, newest 2026-01-29.
- Latest Gmail email in DB: 2026-02-06 01:26:51.
- events_outbox amazon events: 12 rows (after replay).
- Amazon replay (dry-run) parsed 12/12 emails including drop-off confirmations.

## Amazon return parsing
- Parser file: src/automation/amazonReturnParser.ts
- Emits events: amazon.return_requested and amazon.refund_issued
- Dedupe: md5 of provider, order_id, event_type
- Payload includes order_id, item_title, amount or refund_amount, drop_off_by, and email metadata

## RVI integration plan
- Signal engine currently only emits events_outbox rows.
- Next step is to add a delivery handler in MoneyRecovery or map events to new endpoints.
- Proposed mapping:
- amazon.return_requested: create or update RVI with external reference order_id and set return flow submitted.
- amazon.refund_issued: mark return flow refunded and update external reference if missing.

## Next steps
- Decide on event delivery target for MoneyRecovery. There is no /events endpoint yet.
- Add a delivery worker or webhook target that calls MoneyRecovery endpoints:
- GET /rvi/external-references/lookup
- PATCH /rvi/:id/external-references
- GET /rvi/returns/candidates
- PATCH /return-flows/:id/refund
- Update amazon parser to handle subject lines like Your refund for if needed.
- Run the Amazon replay tool with --emit to backfill events if needed.
- Decide on Azure deployment target (Container App/App Service) and secret strategy for Gmail token storage if deploying signal-engine.

## Notes
- Database schema is email_scanning in the signal_engine database.
- Admin UI uses VITE_API_BASE_URL to reach the API, and defaults to http://nas:4000.
