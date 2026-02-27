# EmailScanning Handoff

Last updated: 2026-02-27T05:18:30Z

## Current state
- Signal engine service is running on NAS in /media/nas/workspaces/EmailScanning.
- Gmail ingestion works, GMAIL_QUERY is set to in:anywhere to include spam.
- Admin web UI is running and can edit mail accounts and monitors.
- Admin web UI now includes an Events page to review all outbox events, including rejected delivery responses.
- Admin Mail Accounts UI now supports `moneyrecovery_person_code` mapping per mailbox.
- Amazon return and refund parsing exists and emits amazon events to events_outbox.
- Amazon parser now supports all three lifecycle templates with order-level events:
  - `amazon.return_requested`
  - `amazon.return_dropped_off`
  - `amazon.refund_issued`
- Event payloads now include nested `amazon` data (`order_id`, order-level refund amount, destination text, status text, optional `items[]`) plus common metadata.
- Parser now handles item titles from subjects/links, drop-off dates without year, and drop-off confirmation emails.
- Parser now extracts `amount_total` and optional `payment_method_last4` from return-request emails.
- Added shadow-mode intelligence pipeline:
  - deterministic provider wrapper + iGPT provider run in parallel during ingestion
  - iGPT candidates persist to `email_scanning.ai_candidate_events` only
  - no iGPT writes to `events_outbox` and no delivery-side changes
  - failures are non-blocking; ingestion logs `stage=igpt_shadow` counts
- Added iGPT auth fallback mode (optional):
  - `IGPT_FALLBACK_ENABLED=true` enables Azure OpenAI fallback for Amazon/Manulife-like emails when iGPT returns auth/empty/error.
  - fallback still writes only to `ai_candidate_events` and never mutates delivery/outbox behavior.
- Added comparison CLI:
  - `npm run compare:intelligence -- --since-days 14`
- Added iGPT shadow backfill CLI for historical stored emails:
  - `npm run backfill:intelligence -- --since-days 14 --limit 200 --dry-run`
  - `npm run backfill:intelligence -- --since-days 14 --limit 200`
  - default behavior skips emails already present in `ai_candidate_events`; use `--force` to reprocess.
  - supports `--object-timeout-ms` (default `20000`) and `--amazon-manulife-only` filters.
- Azure dev ingestion job now has iGPT shadow env enabled:
  - `IGPT_ENABLED=true`
  - `IGPT_BASE_URL=https://api.igpt.ai`
  - `IGPT_TIMEOUT_MS=5000`
  - `IGPT_FALLBACK_ENABLED=true`
  - image: `emailscanacr354705.azurecr.io/signal-engine:manual-igpt-fallback-20260226-074551`
- iGPT auth status:
  - direct API-key endpoint (`https://api.igpt.ai/v1/recall/ask`) still returns `{"error":"auth"}` for tested `ak:` keys.
  - session-mode fallback (`x-token` + `x-deviceId`) is implemented as emergency-only path:
    - default runtime mode now stays `IGPT_AUTH_MODE=api_key`
    - `auto` mode only uses session fallback when `IGPT_SESSION_FALLBACK_ENABLED=true`
  - session credentials are stored in HCV for break-glass use:
    - `signal-engine/dev/igpt_session_token`
    - `signal-engine/dev/igpt_session_device_id`
    - `signal-engine/dev/igpt_session_user_id`
- Latest targeted backfill (session mode, no fallback) succeeded:
  - `npm run backfill:intelligence -- --since-days 365 --limit 200 --provider gmail --force --amazon-manulife-only --object-timeout-ms 10000`
  - summary: `scanned=43`, `processed=43`, `failed=0`, `persisted_signals=21`
- Local plaintext secrets moved under vaultSolution runtime and replaced with compatibility symlinks:
  - `/media/nas/workspaces/vaultSolution/runtime/email-scanning/`
- Added fixture-based parser tests for:
  - request confirmed (`702-3272715-0390601`, amount `31.12`, deadline `Feb 2`)
  - dropped off (`701-7116856-5433865`, amount `35.70`)
- Amazon replay emitted 12 events to events_outbox.
- Near-miss logging added for failed Amazon parsing (amazon_return_near_miss), with optional Azure OpenAI suggestions.
- Amazon near-miss AI suggestions enabled in Azure dev job (AMAZON_AI_ENABLED=true).
- Azure dev deployment created as a Container Apps Job (manual trigger) in rg-email-scanning-dev.
- Azure Automation schedule now triggers the ingestion job and a delivery job every 30 minutes via runbook (managed identity).
- Delivery job is configured with MoneyRecovery credentials in local `.env`; latest delivery run reached MoneyRecovery and rejected events with `no_candidate_rvi_found`.
- Delivery logic now auto-creates RVIs when no candidate exists and `moneyrecovery_person_code` is configured for the source mail account.
- No-match + missing person code now sets outbox status `needs_review` (instead of `rejected`).
- Manulife events now include deterministic `ai_review` scoring in outbox payload:
  - `payload.ai_review` with score/label/rationale/baseline/igptScore
  - `payload.ai_review_low=true` when label is `low`
  - scoring remains non-authoritative (deterministic parser still controls event emission)
- Delivery now appends idempotent visible Manulife memo line on matched RVIs:
  - `AI Review[<claim_id>]: <label> (<score>) - <rationale>`
  - memo append is best-effort and does not fail delivery when memo patch fails
- Amazon return replay tool available for dry-run or emission from stored emails.
- Azure Postgres firewall now has rule `allow-email-scanning-current` for current public IP.
- Cron job installed to auto-refresh Azure Postgres firewall IP every 10 minutes.
- Manulife claims parser added with deterministic event emission and near-miss capture (`manulife_claim_near_miss`).
- Event payloads are now standardized with deterministic dedupe keys based on provider + mail account + event type + primary reference + amount + date.
- Delivery now supports both Amazon and Manulife event families.
- Delivery auth supports unattended Entra client-credentials token minting (`RVI_AUTH_MODE=client_credentials`) with v2->v1 fallback.
- Delivery auth defaults to `client_credentials`; static bearer mode is blocked unless `RVI_STATIC_BEARER_ALLOW=true`.
- Runtime vault mapping now injects `RVI_AUTH_CLIENT_SECRET` and no longer injects `RVI_BEARER_TOKEN` by default.
- iGPT runtime defaults to service key mode (`IGPT_AUTH_MODE=api_key`); session fallback only runs when `IGPT_SESSION_FALLBACK_ENABLED=true`.
- External reference source normalized to `email_scanning` (with backward lookup fallback for `signal-engine`).
- Added unified NAS scheduled runner (`npm run run:scheduled:vault`) with systemd units:
  - `ops/systemd/email-scanning.service`
  - `ops/systemd/email-scanning.timer`
  - `ops/systemd/email-scanning.logrotate`
- systemd service template now exports:
  - `VAULT_ENV_FILE=/home/rod/.config/vaultsolution/vault.env`
  - to load HCV credentials for vault-injected runtime secrets.
- Systemd timer `email-scanning.timer` is installed and active (15-minute cadence).
- Legacy `signal-engine-poll.timer` disabled to avoid duplicate poll runs.
- Current ingestion blocker on NAS: Gmail OAuth refresh returns `invalid_grant` for mail account `id=1`; delivery still runs.
- Admin UI now includes monitor template buttons (Amazon + Manulife) and event family filters on `/admin/events`.
- Admin Events page now shows Manulife AI review summary and detail values (`baselineScore`, `igptScore`, `flags`, `rationale`).
- Azure deployment completed for this change set:
  - `signal-engine` image: `emailscanacr354705.azurecr.io/signal-engine:manual-manulife-ai-review-20260227-051213`
  - `email-scanning-admin` image: `emailscanacr354705.azurecr.io/email-scanning-admin:manual-manulife-ai-review-20260227-051626`
  - updated resources:
    - job `signal-engine-dev` (Succeeded execution: `signal-engine-dev-dhdy0ml`)
    - job `signal-engine-deliver-dev` (Succeeded execution: `signal-engine-deliver-dev-eixkepw`)
    - container app `email-scanning-admin-dev` revision `email-scanning-admin-dev--0000005` (Ready/Running)
- Delivery runtime note:
  - current Azure delivery job is running with static token mode (`RVI_AUTH_MODE=static`, `RVI_STATIC_BEARER_ALLOW=true`) because client-credentials env vars are not configured in that job template yet.
  - move back to client-credentials once `RVI_AUTH_TENANT_ID`, `RVI_AUTH_CLIENT_ID`, `RVI_AUTH_CLIENT_SECRET`, `RVI_AUTH_RESOURCE` are set.

## 2026-02-22 integration update
- Amazon ingestion keeps deterministic rules parsing and emits:
  - `amazon.return_requested`
  - `amazon.return_dropped_off`
  - `amazon.refund_issued`
- Manulife ingestion emits:
  - `manulife.claim_received`
  - `manulife.claim_processed`
  - `manulife.claim_paid`
  - `manulife.claim_denied`
  - `manulife.claim_info_required`
  - `manulife.claim_status_update`
- Delivery behavior:
  - Amazon: lookup by `amazon_order_id` external ref -> candidates -> auto-create return RVI when `moneyrecovery_person_code` is set.
  - Manulife: lookup by `manulife_claim_id` external ref -> urgent-list candidate pass -> auto-create insurance RVI when safe and person mapping exists.
  - Missing mail-account person mapping: event becomes `needs_review` (not `rejected`).
  - Unmappable Manulife status states (`denied/info_required/status_update`) are routed to `needs_review` with extracted context.
- Backfill command remains:
  - `npm run deliver:backfill:amazon`

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
- RVI_AUTH_MODE=client_credentials
- RVI_AUTH_TENANT_ID
- RVI_AUTH_CLIENT_ID
- RVI_AUTH_CLIENT_SECRET
- RVI_AUTH_RESOURCE=api://<money-recovery-api-app-id>
- RVI_DELIVERY_KIND=money_recovery
- Static bearer mode is emergency-only:
  - `RVI_AUTH_MODE=static`
  - `RVI_BEARER_TOKEN=<jwt>`
  - `RVI_STATIC_BEARER_ALLOW=true`

## Key commands
- Ingestion poll: node dist/ingestion/index.js --provider gmail --limit 20
- Amazon parser test: npm run test:amazon:return-parser
- Amazon replay (dry-run): npm run replay:amazon -- --since-days 14 --limit 50
- Amazon replay (emit events): npm run replay:amazon -- --since-days 14 --limit 50 --emit
- Delivery worker: node dist/delivery/index.js
- Amazon rejected backfill: npm run deliver:backfill:amazon
- Amazon near-miss query:
- select * from amazon_return_near_miss order by received_at desc;

## Recent checks
- Amazon replay dry-run (2026-02-06): scanned 11, parsed 11 (last 14 days).
- Latest Azure job poll (2026-02-06T13:56Z): 25 new, 25 existing, errors 0.
- events_outbox amazon events: 12 rows (after replay).
- Amazon replay covers return request + drop-off confirmation templates.
- Delivery run (2026-02-18T22:59Z): DB connectivity restored; 8 events moved to `rejected` with reason `no_candidate_rvi_found`.
- Backfill run (2026-02-19T00:12Z): selected 8 previously rejected Amazon events; moved to `pending`, but current delivery attempts return 401 Unauthorized.
- Admin app redeploy (2026-02-18T23:33Z): new UI bundle includes Events page and `/api/events` integration.

## Amazon return parsing
- Parser file: src/automation/amazonReturnParser.ts
- Emits events: amazon.return_requested, amazon.return_dropped_off, amazon.refund_issued
- Dedupe: md5 of provider + mail account + event type + order_id + primary amount + received_at date
- Payload includes common metadata plus nested `amazon` object with order-level details

## RVI integration plan
- Signal engine emits Amazon events to `events_outbox`.
- Delivery worker translates Amazon events into MoneyRecovery API calls when configured:
- Lookup `amazon_order_id` external reference (source `signal-engine`).
- If missing, try `/rvi/returns/candidates?merchant=Amazon&amount_total=...`.
- If still missing and source mail account has `moneyrecovery_person_code`, auto-create an RVI and attach external reference `amazon_order_id`.
- If still missing and no person code mapping, mark outbox event `needs_review` with reason `missing_person_code_mapping_for_mail_account`.
- For `amazon.return_dropped_off`, marks return flow submitted.
- For `amazon.return_requested`, marks return requested and applies deadline/amount/title when available.
- For `amazon.refund_issued`, delivery now calls MoneyRecovery `PATCH /return-flows/:id/refund-detected` and does **not** finalize refund.
- Delivery now accepts one or many RVIs for the same order lookup (`rvi_ids`) and applies updates across all matches.
- Auto-create is now allowed via explicit per-mail-account person code mapping.

## Latest status (2026-02-22)
- Auto-RVI creation is working with valid mailbox mapping (`moneyrecovery_person_code=ROD`).
- Amazon delivery status snapshot:
  - `amazon.refund_issued`: delivered (6)
  - `amazon.return_requested`: delivered (1)
  - `amazon.return_dropped_off`: needs_review (1, return flow not ready)
- Admin validation now enforces `moneyrecovery_person_code` as exact 3-letter uppercase code.

## Next steps
- Keep mail account person mapping set to a valid code (`ROD|PRI|CHA|YAS|ADR`) in Admin Hub (`/admin/mail-accounts`).
- For the remaining dropped-off event in `needs_review`, resolve return-flow readiness in MoneyRecovery and re-run:
  - `npm run deliver`
- Verify Events page (`/admin/events`) stays in `delivered`/`needs_review` and no new `rejected` rows appear for person-code issues.

## Notes
- Database schema is email_scanning in the signal_engine database.
- Admin UI uses VITE_API_BASE_URL to reach the API, and defaults to http://nas:4000.
- Firewall sync script: `ops/azure/update_pg_firewall_ip.sh`
- Cron line: `*/10 * * * * cd /media/nas/workspaces/EmailScanning && /media/nas/workspaces/EmailScanning/ops/azure/update_pg_firewall_ip.sh >> /media/nas/workspaces/EmailScanning/ops/logs/update_pg_firewall_ip.log 2>&1`
