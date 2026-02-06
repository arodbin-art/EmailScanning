# signal-engine

Start timestamp: 2026-01-30T03:03:17Z

Objective: Build a standalone service that ingests external signals (email first), interprets them using rules and AI, and emits structured, auditable events to RVI without mutating business state.
Objective (Added): Migrate to a dedicated signal_engine database (no gift_tracker changes), apply migrations, and run ingestion smoke test.
Objective (Added): Implement deterministic find-only monitor matching with persisted match results (AI optional).
Objective (Added): Detect Amazon refund discrepancies with deterministic parsing and deduplicated alerts.

## Task List (ordered)
- [x] 1. Database schema and migrations
- [x] 2. Object storage layer
- [x] 3. Email ingestion
- [x] 3a. Microsoft Graph authentication (client credentials) — Added during execution
- [x] 4. Assignment strategy abstraction
- [x] 5. Monitor evaluation
- [x] 6. AI classification
- [x] 7. Event outbox
- [x] 8. RVI delivery
- [x] 9. Replay tooling
- [x] 10. Create dedicated signal_engine database and apply migrations (Added during execution)
- [x] 11. Run ingestion smoke test on new database and verify storage (Added during execution)
- [ ] 12. Cleanup notice for old schema (Added during execution)
- [x] 13. Gmail OAuth + Gmail provider support (Added during execution)
- [x] 14. Deterministic find-only monitor matching and persistence (Added during execution)
- [x] 15. Amazon refund discrepancy detection (Added during execution)
- [x] 16. Email Scanning Admin Hub (web UI for rules) (Added during execution)

## Task 1 — Completed
Completed: 2026-01-30T03:18:48Z
Summary: Added Prisma schema for the Signal Engine tables and a baseline SQL migration that creates the dedicated email_scanning schema, enums, tables, and constraints.
Files:
- prisma/schema.prisma
- prisma/migrations/20260130030500_init/migration.sql
- .env.example
- package.json
- tsconfig.json
- .gitignore

Post-apply: 2026-01-30T04:01:39Z
- Applied migration to gift_tracker.email_scanning after granting privileges and resolving failed migration state.

## Task 2 — Completed
Completed: 2026-01-30T04:05:44Z
Summary: Added object storage abstraction with Azure Blob and S3-compatible implementations, plus configuration helpers and docs.
Files:
- src/storage/objectStorage.ts
- src/storage/azureBlobStorage.ts
- src/storage/s3Storage.ts
- src/storage/index.ts
- src/storage/README.md
- .env.example

## Task 3 — In Progress
Start: 2026-01-30T04:06:32Z
Focus: Implement email ingestion pipeline (Microsoft Graph polling, normalization, hashing, storage, and metadata upsert).

## Task 3 — Completed
Completed: 2026-01-30T04:10:52Z
Summary: Implemented Microsoft Graph email polling, normalization/hash, object storage writes, and metadata upsert pipeline. Added ingestion runner and configuration for token-based polling.
Files:
- src/ingestion/types.ts
- src/ingestion/logger.ts
- src/ingestion/normalization.ts
- src/ingestion/objectKeys.ts
- src/ingestion/microsoftGraphProvider.ts
- src/ingestion/emailIngestionService.ts
- src/ingestion/pollRunner.ts
- src/ingestion/index.ts
- src/config/graphTokenProvider.ts
- src/db/prisma.ts
- package.json
- tsconfig.json
- .env.example
- .env

## Task 3a — In Progress (Added during execution)
Start: 2026-01-30T04:28:19Z
Reason: Email ingestion requires durable auth; client-credentials avoids manual bearer token refresh.
Focus: Implement Microsoft Graph client-credentials token retrieval with caching and environment configuration.

## Task 3a — Completed (Added during execution)
Completed: 2026-01-30T04:30:18Z
Summary: Added Microsoft Graph client-credentials token retrieval with caching and updated environment configuration.
Files:
- src/config/graphTokenProvider.ts
- .env.example
- .env

## Task 6 — Completed
Completed: 2026-01-30T04:38:22Z
Summary: Added AI classification adapter with strict JSON enforcement, OpenAI client-credentials request format, and persistence to ai_inference_runs during monitor processing.
Files:
- src/ai/types.ts
- src/ai/jsonEnforcer.ts
- src/ai/openAiClient.ts
- src/ai/clientFactory.ts
- src/ingestion/emailIngestionService.ts
- src/ingestion/pollRunner.ts
- .env.example
- .env

## Task 7 — In Progress
Start: 2026-01-30T04:40:31Z
Focus: Implement event outbox emission with deterministic dedupe key and status management.

## Task 7 — Completed
Completed: 2026-01-30T04:44:56Z
Summary: Added deterministic dedupe keys for events_outbox, emitted events from AI classifications when allowed and above threshold, and applied migration to email_scanner.
Files:
- prisma/schema.prisma
- prisma/migrations/20260130044031_add_events_outbox_dedupe/migration.sql
- src/ingestion/emailIngestionService.ts

## Task 8 — In Progress
Start: 2026-01-30T04:49:12Z
Focus: Implement RVI delivery worker for pending outbox events.

## Task 8 — Completed
Completed: 2026-01-30T04:52:07Z
Summary: Added RVI delivery client/worker to POST pending outbox events and record delivery logs.
Files:
- src/delivery/rviClient.ts
- src/delivery/deliveryWorker.ts
- src/delivery/index.ts
- package.json
- .env.example
- .env

## Task 4 — In Progress
Start: 2026-01-30T04:12:04Z
Focus: Add assignment strategy abstraction and a static configuration implementation.

## Task 4 — Completed
Completed: 2026-01-30T04:13:56Z
Summary: Added assignment strategy abstraction with a static MAIL_ACCOUNT_IDS implementation and validation, wiring it into the polling runner.
Files:
- src/assignment/types.ts
- src/assignment/staticAssignmentStrategy.ts
- src/ingestion/pollRunner.ts
- src/ingestion/index.ts
- .env.example
- .env

Post-apply: 2026-01-30T04:20:29Z
- Created dedicated database `email_scanner` on gift-tracker-db-rod and applied initial migration to schema `email_scanning`.

## Task 5 — In Progress
Start: 2026-01-30T04:22:11Z
Focus: Add monitor evaluation engine and monitor selection by account scope.

## Task 5 — Completed
Completed: 2026-01-30T04:25:42Z
Summary: Added monitors table + schema, repository loader, and evaluator logic with account scoping, wired into ingestion flow.
Files:
- prisma/schema.prisma
- prisma/migrations/20260130042211_add_monitors/migration.sql
- src/monitors/types.ts
- src/monitors/monitorRepository.ts
- src/monitors/monitorEvaluator.ts
- src/ingestion/emailIngestionService.ts

## Task 6 — In Progress
Start: 2026-01-30T04:32:44Z
Focus: Implement AI classification adapter with strict JSON enforcement and persistence in ai_inference_runs.

## Task 10 — Completed
Completed: 2026-01-30T21:40:28Z
Summary: Created the dedicated signal_engine database, added emailscanninguser, and applied the baseline migration to the email_scanning schema.
Post-apply: 2026-01-30T21:40:28Z
- Migrations applied via prisma migrate deploy.
- Verified email_scanning tables exist in signal_engine.

## Task 11 — In Progress
Start: 2026-01-30T21:40:28Z
Focus: Run ingestion smoke test on the new database and verify emails_raw + object storage artifacts.

## Task 11 — Completed
Completed: 2026-02-02T05:45:21Z
Summary: Ran Gmail poll cycle after enabling Gmail account; verified emails_raw rows and blob storage writes, with idempotent re-run.
Verification:
- emails_raw provider=gmail count: 50 (no change after re-run).
- body_object_key path matches emails/gmail/YYYY/MM/<message-id>/.
- attachment blob exists in Azure container.

## Task 13 — In Progress
Start: 2026-01-31T01:18:05Z
Focus: Add Gmail OAuth + Gmail provider support because Microsoft Graph polling is blocked on a Gmail mailbox and OAuth is required for Gmail access.

Progress: 2026-01-31T01:18:05Z
- Added Gmail OAuth server and encrypted local token store scaffolding.

Progress: 2026-01-31T01:18:05Z
- Added Gmail API client/provider and wired provider selection for microsoft/gmail.
- Documented Gmail OAuth env vars and manual smoke test flow.

Progress: 2026-01-31T01:18:05Z
- Added Gmail OAuth/credentials env documentation, README pointer, and provider typing updates.

### Blocked
- Blocker: Gmail OAuth flow not executed yet; no stored refresh token reference to validate polling.
- Need: Run `node dist/auth/gmailOAuthServer.js <label>` after setting Google OAuth env vars, store token, update mail_accounts with `encrypted_credentials_ref=secret://gmail/<label>`, and enable the account.

Progress: 2026-01-31T01:18:05Z
- Build passes with Gmail OAuth/provider code.

Progress: 2026-01-31T01:18:05Z
- Updated signal_engine.mail_accounts id=1 to provider=gmail with oauth credential ref and enabled=false pending OAuth.

Progress: 2026-01-31T01:18:05Z
- Clarified Gmail token encryption key requirements in .env.example.

Progress: 2026-02-01T17:22:00Z
- Loaded Gmail OAuth client config from secrets/rodleeallen_secrets.json into .env.
- Generated and set GMAIL_TOKEN_ENCRYPTION_KEY.
- Documented rodleeallen Gmail OAuth setup in docs/gmail-rodleeallen-setup.md.

Progress: 2026-02-02T05:08:00Z
- Added hard Gmail auth/quota validation and forced refresh-token access token retrieval in Gmail client.

### Blocked
- Blocker: OAuth server failed because GOOGLE_CLIENT_ID was not loaded (dotenv missing in gmailOAuthServer).
- Action: Added dotenv/config import; need rebuild and re-run OAuth.

## Task 13 — Completed
Completed: 2026-02-02T05:45:21Z
Summary: Gmail OAuth + Gmail provider support enabled with encrypted refresh token storage and Gmail polling verified.
Files:
- src/auth/gmailOAuthServer.ts
- src/auth/gmailTokenStore.ts
- src/providers/gmail/gmailClient.ts
- src/providers/gmail/gmailEmailProvider.ts
- src/ingestion/emailIngestionService.ts
- src/ingestion/pollRunner.ts
- src/ingestion/microsoftGraphProvider.ts
- src/ingestion/types.ts
- docs/gmail-oauth.md
- docs/gmail-rodleeallen-setup.md
- .env.example
- README.md
- package.json
- package-lock.json
Gmail is live:
- Credential label: rodleeallen
- Date enabled: 2026-02-02
- Verification steps: poll run, emails_raw count, blob path check, attachment blob check, idempotent re-run.

## Task 12 — Pending
Note: Old schema gift_tracker.email_scanning can be dropped manually later if desired (do not auto-drop).

## Task 14 — Completed
Completed: 2026-02-04T07:51:44Z
Summary: Added deterministic find-only monitor matching with persisted match results and AI optional gating; added CLI poll harness.
Files:
- src/ai/clientFactory.ts
- src/ingestion/index.ts
- src/ingestion/pollRunner.ts
- src/ingestion/emailIngestionService.ts
- src/ingestion/types.ts
- src/monitors/types.ts
- src/monitors/monitorEvaluator.ts
- src/monitors/monitorRepository.ts
- src/providers/gmail/gmailEmailProvider.ts
- prisma/schema.prisma
- prisma/migrations/20260202064000_find_only_monitor_matches/migration.sql
- docs/operations.md
- .env.example
- .env
Post-apply: 2026-02-04T07:51:44Z
- Applied migration 20260202064000_find_only_monitor_matches to signal_engine.
- Verified poll harness with `--provider gmail --limit 5` (existing emails only).

Progress: 2026-02-04T12:02:29Z
- Seeded a demo Gmail monitor (seed-gmail-any) and verified 5 monitor_matches rows on a 5-message poll run.

## Task 15 — In Progress
Start: 2026-02-04T07:52:00Z
Focus: Implement deterministic Amazon refund discrepancy detection with dedupe by Order ID and structured results.

## Task 15 — Completed
Completed: 2026-02-05T04:36:23Z
Summary: Added Amazon refund discrepancy detection with defensive parsing, dedupe by Order ID, and structured output logging; persisted processed Order IDs and discrepancies.
Files:
- src/automation/amazonRefundDetector.ts
- src/ingestion/emailIngestionService.ts
- prisma/schema.prisma
- prisma/migrations/20260204082000_amazon_refund_discrepancies/migration.sql
Post-apply: 2026-02-05T04:36:23Z
- Applied migration 20260204082000_amazon_refund_discrepancies to signal_engine.
- Ran poll harness with `--provider gmail --limit 5`; no discrepancies detected in sample run.

Progress: 2026-02-05T04:40:00Z
- Set Gmail query filter to `from:return@amazon.ca` in .env for Amazon refund detection.

Progress: 2026-02-02T06:02:34Z
- Added poll summary logging, Gmail label/query filters, retention check script, and systemd timer docs.

Progress: 2026-02-02T06:03:05Z
- Configured retention env vars and ran log-only retention check (no rows/blobs over cutoff).

## Task 16 — In Progress (Added during execution)
Start: 2026-02-06T00:21:15Z
Reason: Provide a webpage to view/edit configured email rules (monitors) and mail accounts.
Focus: Make `email-scanning-admin` runnable, accessible from other machines, and compatible with the `email_scanning` schema.

## Task 16 — Completed (Added during execution)
Completed: 2026-02-06T00:21:15Z
Summary: Brought up the Email Scanning Admin Hub (API + UI) and fixed schema/runtime issues preventing it from working against the `email_scanning` schema. Updated monitor payload support for new columns and fixed UI API base resolution so accessing the UI via `http://nas:5175` talks to the NAS API (not the browser's localhost).
Files:
- email-scanning-admin/api/src/db.ts
- email-scanning-admin/api/src/index.ts
- email-scanning-admin/api/src/store.ts
- email-scanning-admin/api/src/types.ts
- email-scanning-admin/api/src/validation.ts
- email-scanning-admin/api/package.json
- email-scanning-admin/api/prisma/schema.prisma
- email-scanning-admin/ui/src/pages/MonitorEditorPage.tsx
- email-scanning-admin/ui/src/pages/MonitorsPage.tsx
- email-scanning-admin/ui/src/utils/api.ts
- email-scanning-admin/ui/src/utils/types.ts
Ops:
- Started UI dev server on port 5175 and API on port 4000.
- Generated admin token and wrote admin env files (token stored in `email-scanning-admin/.admin_token`).

## Task 17 — Completed
Completed: 2026-02-06T00:30:00Z
Summary: Added deterministic Amazon.ca return/refund email parsing (return request + refund issued) with outbox emission and idempotent dedupe by provider+order_id+event_type, plus a parser test script.
Files:
- src/automation/amazonReturnParser.ts
- src/automation/amazonReturnParserTest.ts
- src/ingestion/emailIngestionService.ts
- package.json

Progress: 2026-02-06T04:11:02Z
- Ran Gmail poll harness (node dist/ingestion/index.js --provider gmail --limit 20): 13 new, 7 existing.
- Queried Amazon returns last 14 days: 12 emails (2026-01-23 to 2026-01-29).
- Confirmed GMAIL_QUERY=in:anywhere to include spam.

Progress: 2026-02-06T04:17:34Z
- Created HANDOFF.md with current state, next steps, and integration plan.
- Verified latest Amazon emails in last 14 days are 12 rows in emails_raw.
- Confirmed events_outbox has zero amazon events so far; parser likely needs replay or more matches.

## Task 9 — Completed
Completed: 2026-02-06T04:25:17Z
Summary: Added a replay tool to reprocess recent Amazon return/refund emails from emails_raw using stored normalized text, with optional outbox emission and dry-run logging.
Files:
- src/automation/amazonReturnReplay.ts
- package.json

Progress: 2026-02-06T04:26:11Z
- Added dotenv loading to amazon replay tool so it can read DATABASE_URL and storage env vars.

Progress: 2026-02-06T04:34:18Z
- Expanded Amazon return parser to extract item titles from subjects/links and handle drop-off dates without a year.
- Updated replay tool and tests to pass receivedAt to the parser.

Progress: 2026-02-06T04:34:58Z
- Ran amazon replay dry-run: parsed 10/12 emails; 2 drop-off confirmations remain unparsed.

Progress: 2026-02-06T04:37:19Z
- Added parsing + outbox payload support for Amazon return drop-off confirmation emails.
- Extended parser tests to cover drop-off confirmations.

Progress: 2026-02-06T04:37:50Z
- Fixed Amazon date parsing to tolerate trailing punctuation for refund-by lines.

Progress: 2026-02-06T04:38:17Z
- Replay dry-run now parses 12/12 Amazon emails, including drop-off confirmations.

Progress: 2026-02-06T04:39:04Z
- Ran amazon replay with --emit; inserted 12 amazon events into events_outbox.

Progress: 2026-02-06T04:46:38Z
- Added amazon_return_near_miss table + Prisma model and migration; deployed migration.
- Added Amazon near-miss detection with optional Azure OpenAI suggestions (guarded by AMAZON_AI_ENABLED).
- Updated .env.example with Azure OpenAI configuration for Amazon fallback.

Progress: 2026-02-06T04:49:32Z
- Added Amazon near-miss logging + Azure OpenAI fallback, documented in operations.
- Ran amazon parser tests and rebuilt dist.

Progress: 2026-02-06T04:50:55Z
- Tests: npm run test:amazon:return-parser (pass), npm run build (pass).
- Git commits created for near-miss/AI fallback and ignore patterns.

Progress: 2026-02-06T04:53:13Z
- Azure CLI is available; subscription is logged in. No deployment executed yet due to missing target + secrets strategy.

Progress: 2026-02-06T05:29:44Z
- Added Dockerfile + entrypoint for container deployments and .dockerignore.
- Built and pushed signal-engine:dev image to emailscanacr354705.
- Created Azure resources: rg-email-scanning-dev, email-scan-dev-env, Container Apps Job signal-engine-dev (manual).
- Manual job run succeeded; poll summary logged and new emails ingested.
- Added docs/azure-deploy.md and updated README.
