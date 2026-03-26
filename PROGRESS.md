# signal-engine

Last updated: 2026-03-26
Status: IN PROGRESS

## NEXT
- [ ] 0e. Add Mobility Room physio receipt automation for Rodney with prefilled WSIB ML -> OCT ML phases and receipt attachment handoff
- [x] 0c. Add filter draft session schema + Admin Hub AI-assisted "new filter from sample emails" flow
- [x] 0d. Add shared email-derived title/description formatter + clean orthodontics delivery descriptions
- [x] 0. Template registry (file-based) implemented for Admin Hub monitor creation
- [x] 0b. Fix template registry runtime file missing in admin container (`/app/templates/templates.json` ENOENT)
- [ ] 1. Configure/verify `moneyrecovery_person_code` on all active Amazon/Manulife mail accounts
- [ ] 2. Refresh Gmail OAuth token for account `id=1` (`invalid_grant`) and re-run live ingestion
- [x] 3. Autonomous ingest+delivery scheduler + Manulife integration completed
- [x] 4. Replace static/session tokens with proper service auth (`RVI` client credentials + official iGPT server credential)

## 2026-03-20 - Filter draft onboarding + title cleanup
Status: COMPLETE
- Scope confirmed from task brief:
  - add Admin Hub draft-session workflow for creating a monitor from 1-2 sample emails
  - persist auditable sample-analysis sessions, structured questions/answers, and draft proposals
  - add pluggable Azure OpenAI-backed analysis with strict JSON + heuristic fallback
  - add reusable email-derived title/description formatter and remove orthodontics transaction/plan noise from visible descriptions
- Constraints being followed:
  - keep existing Amazon, Manulife, and orthodontics parsing/delivery behavior intact outside the targeted description cleanup
  - keep changes additive and reversible
  - update HANDOFF.md if delivered behavior/runbook changes
- Implementation started:
  - traced current admin monitor/template flow, deterministic orthodontics event emission, and MoneyRecovery title/memo construction
  - identified current orthodontics noise source in `src/delivery/moneyRecoveryClient.ts` (`createOrthodonticsInsuranceRvi` + memo append path)
  - identified admin entry points for new draft APIs/UI in `email-scanning-admin/api/src/app.ts`, `store.ts`, and `email-scanning-admin/ui/src/pages`
- Delivered:
  - added Prisma/admin schema for auditable filter draft sessions, samples, questions, answers, proposals, plus `monitors.capture_key`
  - added migration `20260320110000_filter_drafts_and_monitor_capture_key`
  - added admin API routes for draft create/get, sample upload, analyze, answer submission, and proposal-to-monitor creation
  - added Azure OpenAI-backed strict-JSON analysis provider with heuristic fallback when AI is disabled, unavailable, or invalid
  - added Admin Hub UI flow for `Filter Drafts` with 1-2 sample inputs, extracted structure summary, targeted follow-up questions, proposal review, and create-monitor handoff
  - added shared delivery description formatter and switched orthodontics visible descriptions to compact human-facing titles with `(via <filter_key>)`
- Validation:
  - `npm run build` => PASS
  - `cd email-scanning-admin/api && npm run build && npm test` => PASS
  - `cd email-scanning-admin/ui && npm run build && npm run test:templates` => PASS
  - `npm run test:orthodontics` => PASS
  - `npm run test:delivery:descriptions` => PASS
  - `npm run test:delivery:money-recovery` => PASS

## 2026-03-20 - Azure rollout for filter drafts
Status: COMPLETE
- Goal:
  - deploy the completed filter-draft onboarding and title/description cleanup changes to Azure dev so the hosted Admin Hub can be tested
- Planned rollout:
  - apply Prisma migration in the shared dev database
  - build/push updated `email-scanning-admin` image to ACR
  - update Azure Container App `email-scanning-admin-dev`
  - verify hosted `/admin/filter-drafts/new` and API behavior after rollout
- Completed rollout:
  - applied Prisma migration `20260320110000_filter_drafts_and_monitor_capture_key` to Azure dev Postgres
  - built/pushed `emailscanacr354705.azurecr.io/email-scanning-admin:filter-drafts-20260320-211137`
  - built/pushed `emailscanacr354705.azurecr.io/signal-engine:filter-drafts-20260320-211137`
  - updated Azure Container App `email-scanning-admin-dev` to revision `email-scanning-admin-dev--0000012`
  - updated Azure jobs `signal-engine-dev` and `signal-engine-deliver-dev` to the new signal-engine image
- Deployment validation:
  - `npm run db:migrate:deploy` => PASS
  - `az acr build ... email-scanning-admin:filter-drafts-20260320-211137` => PASS
  - `az acr build ... signal-engine:filter-drafts-20260320-211137` => PASS
  - `az containerapp update -n email-scanning-admin-dev ...` => PASS
  - `az containerapp job update -n signal-engine-dev ...` => PASS
  - `az containerapp job update -n signal-engine-deliver-dev ...` => PASS
  - hosted admin revision `email-scanning-admin-dev--0000012` reports `Running` / `Healthy`

## 2026-03-26 - Azure filter-draft save/analyze hotfix
Status: COMPLETE
- Symptom:
  - hosted Azure admin flow returned `Internal server error` on `Save as draft and analyze samples`
- Root cause identified from Azure Container App logs:
  - `createFilterDraftSession` inserted plain text into `filter_draft_sessions.scope`
  - Postgres rejected it because `scope` is enum type `email_scanning.monitor_scope`
  - error: `42804 column "scope" is of type monitor_scope but expression is of type text`
- Planned fix:
  - cast inserted scope value to `email_scanning.monitor_scope`
  - rebuild/redeploy admin app and recheck the flow
- Delivered:
  - patched `email-scanning-admin/api/src/filterDraftStore.ts` so draft session insert casts scope to `email_scanning.monitor_scope`
  - rebuilt/pushed hotfix image `emailscanacr354705.azurecr.io/email-scanning-admin:filter-drafts-hotfix-20260326-042614`
  - updated Azure Container App `email-scanning-admin-dev` to revision `email-scanning-admin-dev--0000014`
- Validation:
  - `cd email-scanning-admin/api && npm run build && npm test` => PASS
  - direct runtime validation against shared dev DB:
    - `createFilterDraftSession({ scope: "all" ... })` => PASS
    - inserted session reloaded with `scope = "all"` and `status = "draft"`
  - Azure revision `email-scanning-admin-dev--0000014` reports `Running` / `Healthy`

## 2026-03-26 - Baseline tagged before Mobility Room automation
Status: COMPLETE
- Baseline captured before starting the next reimbursement automation change:
  - current filter-draft onboarding feature is implemented and deployed
  - current Azure hotfix for enum-cast draft session creation is deployed and validated
  - docs refreshed to mark Mobility Room physio receipt automation as the next targeted work item
- Upcoming implementation scope:
  - detect `Mobility Room <notifications@janeapp.com>` / `Your Receipt - Mobility Room` receipt emails
  - create a Rodney physio RVI automatically instead of misclassifying the email as a Manulife monitor
  - treat the receipt amount as the remaining 10% out-of-pocket portion
  - prefill phase 1 `WSIB ML` as already claimed/paid at 90%
  - start workflow at phase 2 `OCT ML` for the remaining balance
  - attach the receipt PDF when available

## 2026-02-28 - Admin template registry runtime fix (ENOENT)
Status: COMPLETE
- Symptom:
  - Admin UI APIs returned:
    - `Template registry unavailable: ENOENT: no such file or directory, stat '/app/templates/templates.json'`
  - Affected pages: Templates and Monitors (template-backed prefill calls).
- Root cause:
  - `email-scanning-admin` runtime image did not copy `api/templates/templates.json`.
  - Resolver fallback in `api/src/templates.ts` checked `/app/templates/templates.json` first in container cwd scenarios.
- Fixes applied:
  - Docker image now includes template registry in runner stage:
    - `email-scanning-admin/Dockerfile`
    - added `COPY --from=build /app/api/templates ./api/templates`
  - Resolver hardened to check `/app/api/templates/templates.json` via cwd candidate:
    - `email-scanning-admin/api/src/templates.ts`
    - added candidate: `path.resolve(process.cwd(), 'api', 'templates', 'templates.json')`
- Validation:
  - `cd email-scanning-admin/api && npm test` => PASS
  - `cd email-scanning-admin/api && npm run build` => PASS
- Deployment:
  - Built/pushed image:
    - `emailscanacr354705.azurecr.io/email-scanning-admin:template-fix-20260228-0046`
  - Updated Container App:
    - `email-scanning-admin-dev--0000011`
  - Runtime check:
    - UI serves successfully from new revision.
    - API unauthenticated template route returns `401` (expected auth gate) instead of template-registry ENOENT.

## 2026-02-27 - Admin template registry (file-based)
Status: COMPLETE
- Replaced hardcoded monitor template buttons with a file-based template registry:
  - `email-scanning-admin/api/templates/templates.json`
  - templates included: `amazon-default`, `manulife-claims`, `durham-orthodontics-approved-payment`
- Added Admin API endpoints:
  - `GET /api/templates` (summary list)
  - `GET /api/templates/:id` (full template)
- Added runtime template loading with mtime cache + validation:
  - duplicate `id` blocked
  - missing `monitor_defaults.provider` blocked
  - clear `500` error when registry is missing/invalid
- Added Admin UI templates page:
  - `/admin/templates` shows list + read-only details
  - Durham template includes warning: `Requires parser orthodontics.payment_approved`
- Updated monitor creation UX:
  - `/admin/monitors` now uses `Create from template`
  - selected template pre-fills `/admin/monitors/new` form
  - manual flow retained as `Create blank monitor`
- Added minimal tests:
  - API registry load/validation test (`email-scanning-admin/api/src/templates.test.ts`)
  - UI prefill mapping test (`email-scanning-admin/ui/src/utils/templatePrefillTest.ts`)

## 2026-02-27 - Admin Entra ID authentication support
Status: COMPLETE
- Added configurable admin auth modes in API:
  - `ADMIN_AUTH_MODE=token|entra|hybrid`
  - `token`: static `ADMIN_TOKEN` validation (existing behavior)
  - `entra`: Entra JWT validation (issuer + audience + RS256 signature via JWKS)
  - `hybrid`: accept either static token or Entra JWT
- Added Entra validation env support:
  - `ADMIN_ENTRA_AUDIENCE`
  - `ADMIN_ENTRA_TENANT_ID` (or `ADMIN_ENTRA_ISSUER`)
- Startup validation now checks auth-mode requirements.
- Added tests:
  - `email-scanning-admin/api/src/auth.test.ts`
  - covers token mode and Entra-mode JWT validation with mocked OpenID config/JWKS.

## 2026-02-27 - Entra-only runtime hardening (admin)
Status: IN PROGRESS
- Updated vault runtime mappings for admin services:
  - `ops/vault/hcv-admin-api.envmap` now maps Entra config (`ADMIN_AUTH_MODE`, `ADMIN_ENTRA_TENANT_ID`, `ADMIN_ENTRA_AUDIENCE`) and removes `ADMIN_TOKEN`.
  - `ops/vault/hcv-admin-ui.envmap` no longer injects `VITE_ADMIN_TOKEN`.
- Goal is full Entra-only external auth (`ADMIN_AUTH_MODE=entra`) with no static token fallback.
- Pending deployment step:
  - apply/update Azure Container App env vars for `email-scanning-admin-dev`.
  - blocked in current session due DNS/network restriction to `management.azure.com`.

## 2026-02-27 - Manulife AI review score surfaced end-to-end
Status: COMPLETE
- Added `AiReview` contract + scoring helpers:
  - `src/intelligence/aiReview.ts`
  - includes `clamp01`, label thresholds, rationale truncation, deterministic baseline scoring.
- Added optional iGPT Manulife scorer (shadow scoring only):
  - `src/intelligence/igptReviewManulife.ts`
  - uses `IGPT_ENABLED`, `IGPT_API_KEY`, `IGPT_BASE_URL`, `IGPT_TIMEOUT_MS`
  - never throws; malformed/missing iGPT score falls back to deterministic baseline only.
- Ingestion integration:
  - `src/ingestion/emailIngestionService.ts`
  - each emitted `manulife.*` event now includes:
    - `payload.ai_review`
    - `payload.ai_review_low` when label is `low`
  - dedupe keys and event types unchanged.
- Delivery integration:
  - `src/delivery/moneyRecoveryClient.ts`
  - appends idempotent memo line for Manulife RVIs:
    - `AI Review[<claim_id>]: <label> (<score>) - <rationale>`
  - append is best-effort and does not fail delivery if memo patch fails.
- Admin visibility:
  - `email-scanning-admin/ui/src/pages/EventsPage.tsx`
  - `email-scanning-admin/ui/src/utils/aiReview.ts`
  - Events table shows compact AI review label/score and detail values (`baselineScore`, `igptScore`, `flags`, `rationale`).

Validation runs:
- `npm run build` ✅
- `npm run test:manulife` ✅
- `npm run test:intelligence:shadow` ✅
- `npm run test:igpt` ✅
- `npm run test:delivery:money-recovery` ✅

Additional UI safety test:
- `cd email-scanning-admin/ui && npm run test:ai-review` ✅

Deployment:
- Built and pushed:
  - `emailscanacr354705.azurecr.io/signal-engine:manual-manulife-ai-review-20260227-051213`
  - `emailscanacr354705.azurecr.io/email-scanning-admin:manual-manulife-ai-review-20260227-051626`
- Updated Azure resources:
  - Container Apps Job `signal-engine-dev` -> new signal-engine image
  - Container Apps Job `signal-engine-deliver-dev` -> new signal-engine image
  - Container App `email-scanning-admin-dev` -> new admin image
- Manual run validation:
  - `signal-engine-dev-dhdy0ml` => `Succeeded`
  - initial delivery run `signal-engine-deliver-dev-eei233e` => `Failed` (missing client-credentials env vars)
  - applied job env workaround (`RVI_AUTH_MODE=static`, `RVI_STATIC_BEARER_ALLOW=true`)
  - rerun `signal-engine-deliver-dev-eixkepw` => `Succeeded`
  - configured client-credentials vars/secrets on delivery job and switched back to:
    - `RVI_AUTH_MODE=client_credentials`
    - `RVI_AUTH_TENANT_ID`, `RVI_AUTH_CLIENT_ID`, `RVI_AUTH_RESOURCE`, `RVI_AUTH_CLIENT_SECRET`
  - verification execution `signal-engine-deliver-dev-yaf476s` => `Succeeded`

## Tracker Format (Codex)
Required file shape for tracker compatibility:
- Keep `Last updated: YYYY-MM-DD` near the top.
- Keep one primary `Status: ...` line near the top.
- Keep immediate tasks under `## NEXT` using markdown checkboxes.
- Use unchecked items for pending actions and checked items for completed actions.

## 2026-02-26 - Vault cutover for local secrets/config
Status: COMPLETE
- Added iGPT Vault mappings for runtime injection:
  - `IGPT_API_KEY=signal-engine/dev/igpt_api_key`
  - `IGPT_SESSION_TOKEN=signal-engine/dev/igpt_session_token`
  - `IGPT_SESSION_DEVICE_ID=signal-engine/dev/igpt_session_device_id`
  - `IGPT_SESSION_USER_ID=signal-engine/dev/igpt_session_user_id`
- Updated vault wrappers to auto-source `/home/rod/.config/vaultsolution/vault.env` (main service + admin API).
- Added admin UI vault wrapper and scripts:
  - `email-scanning-admin/ui/scripts/run_with_hcv.sh`
  - `npm run dev:vault|build:vault|preview:vault` (UI package)
- Updated systemd templates to run vault-backed commands:
  - `ops/systemd/email-scanning.service` -> `npm run run:scheduled:vault`
  - `ops/systemd/signal-engine-poll.service` -> `npm run poll:vault`
  - both templates now set `VAULT_ENV_FILE=/home/rod/.config/vaultsolution/vault.env`
- Migrated local plaintext secret files into centralized runtime storage and left compatibility symlinks:
  - target: `/media/nas/workspaces/vaultSolution/runtime/email-scanning/`
  - moved files include `.admin_token`, `gmail_tokens.json`, `rvi.bearertoken`, `openai.key`, iGPT key files, and OAuth client JSON.
- Sanitized local `.env` files by clearing secret values so runtime now relies on Vault injection.

## 2026-02-26 - Proper service auth default cutover
Status: COMPLETE
- Delivery auth now defaults to Entra client credentials:
  - `RVI_AUTH_MODE=client_credentials` as default behavior.
  - static bearer path requires explicit emergency opt-in: `RVI_STATIC_BEARER_ALLOW=true`.
- Runtime vault injection now maps:
  - `RVI_AUTH_CLIENT_SECRET=signal-engine/dev/graph_client_secret`
  - removed default mapping of `RVI_BEARER_TOKEN`.
- iGPT auth defaults to service API key mode:
  - `IGPT_AUTH_MODE=api_key` default.
  - `auto` mode uses session fallback only when `IGPT_SESSION_FALLBACK_ENABLED=true`.
  - removed default runtime injection of iGPT session token/device/user.
- Validation:
  - Entra client-credentials token mint successful for MoneyRecovery API (`aud=api://a6167d86-539d-425d-8c6e-0d464d90ec07`, app role present).

## 2026-02-22 - Amazon lifecycle completion (dropped-off + refund-issued pending verification)
Status: COMPLETE
- Hardened Amazon parser to classify and extract deterministic order-level payloads for:
  - `amazon.return_requested`
  - `amazon.return_dropped_off`
  - `amazon.refund_issued`
- Added nested `amazon` payload contract with optional `items[]`, destination text, and status text.
- Updated Amazon dedupe usage to include order + primary amount + received date.
- Updated delivery translator to:
  - resolve one or many RVIs by external order reference (`rvi_ids`)
  - keep candidate fallback + auto-create behavior
  - call `PATCH /return-flows/:id/refund-detected` for `amazon.refund_issued` (no immediate close)
- Added parser fixtures + tests for:
  - request-confirmed sample (`702-3272715-0390601`, `31.12`, deadline Feb 2)
  - dropped-off sample (`701-7116856-5433865`, `35.70`)
- Validation completed:
  - `npm run build`
  - `npm run test:amazon`
  - `npm run test:delivery:money-recovery`

Deployment (2026-02-24):
- Built and pushed image:
  - `emailscanacr354705.azurecr.io/signal-engine:manual-amazon-lifecycle-20260223-234542`
- Updated Container Apps Jobs:
  - `signal-engine-dev`
  - `signal-engine-deliver-dev`
- Manual execution verification:
  - `signal-engine-dev-7w1dc50` => `Succeeded`
  - `signal-engine-deliver-dev-9f126m4` => `Succeeded`

## 2026-02-26 - iGPT shadow-mode parallel intelligence
Status: COMPLETE
- Added `EmailIntelligenceProvider` abstraction with:
  - deterministic wrapper provider (`src/intelligence/deterministicProvider.ts`)
  - iGPT provider (`src/intelligence/igptProvider.ts`)
- Ingestion now runs deterministic + iGPT analysis in parallel shadow flow per email, then:
  - emits deterministic events exactly as before
  - persists iGPT-only candidates to `email_scanning.ai_candidate_events`
  - never emits iGPT candidates to `events_outbox`
- Added resilient guardrails:
  - `IGPT_ENABLED=false` default
  - iGPT failures are non-blocking for ingestion
  - structured log emitted: `stage=igpt_shadow`, deterministic and iGPT counts
- Added comparison CLI:
  - `npm run compare:intelligence -- --since-days 14`
- Added tests:
  - `npm run test:igpt`
  - `npm run test:intelligence:shadow`
- Added migration:
  - `prisma/migrations/20260226091500_add_ai_candidate_events/migration.sql`
- Azure dev rollout:
  - built/pushed `emailscanacr354705.azurecr.io/signal-engine:manual-igpt-shadow-20260226-054141`
  - updated jobs `signal-engine-dev` + `signal-engine-deliver-dev` to new image
  - enabled ingestion env: `IGPT_ENABLED=true`, `IGPT_BASE_URL=https://api.igpt.ai`, `IGPT_TIMEOUT_MS=5000`
  - manual ingestion run `signal-engine-dev-7ih41nw` succeeded but processed 0 emails due `invalid_grant`
  - iGPT candidate rows remain 0 until Gmail auth and `IGPT_API_KEY` are configured

## 2026-02-26 - iGPT auth hardening + autonomous fallback
Status: COMPLETE
- Implemented iGPT shadow fallback path in `IGPTProvider`:
  - if iGPT returns auth/empty/fetch error and `IGPT_FALLBACK_ENABLED=true`, provider uses Azure OpenAI to produce shadow `StructuredSignal[]` for Amazon/Manulife-like emails.
  - still no writes to `events_outbox`; candidates only persist to `ai_candidate_events`.
- Added test coverage:
  - `testAuthErrorFallsBackToAzureOpenAi` in `src/intelligence/igptProviderTest.ts`.
- Azure dev updated:
  - image: `emailscanacr354705.azurecr.io/signal-engine:manual-igpt-fallback-20260226-074551`
  - env: `IGPT_FALLBACK_ENABLED=true`
- Validation:
  - Gmail `invalid_grant` resolved (Azure ingestion now processes emails again).
  - latest run had only existing emails (`new_emails=0`), so no new shadow candidates were generated in that cycle.

## 2026-02-26 - iGPT shadow backfill tool for stored emails
Status: COMPLETE
- Added historical backfill CLI:
  - `src/analysis/backfillAiCandidates.ts`
  - `npm run backfill:intelligence -- --since-days 14 --limit 200 [--dry-run]`
- Behavior:
  - loads stored normalized email text from object storage
  - runs iGPT provider in shadow mode and persists to `email_scanning.ai_candidate_events`
  - never emits to `events_outbox`
  - skips already-processed emails by default; supports `--force`
- Validation:
  - `npm run build`
  - `npm run test:igpt`
  - `npm run test:intelligence:shadow`
  - dry run: `npm run backfill:intelligence -- --since-days 14 --limit 20 --dry-run`
    - result: `scanned=20`, `processed=20`, `failed=0`, `candidate_signals=0` (expected while iGPT auth remains failing)

## 2026-02-26 - iGPT shadow backfill hardening + targeted fallback run
Status: COMPLETE
- Hardened `src/analysis/backfillAiCandidates.ts`:
  - `--object-timeout-ms` flag (default `20000`) to prevent indefinite blob read hangs.
  - `--amazon-manulife-only` flag to focus candidate generation on likely relevant emails.
- Validation run (fallback path enabled with Azure OpenAI config, while iGPT key still auth-failing):
  - `--since-days 365 --limit 200 --provider gmail --force --amazon-manulife-only --object-timeout-ms 10000`
  - result: `scanned=43`, `processed=43`, `failed=0`, `candidate_signals=4`, `persisted_signals=4`
- Post-run verification:
  - `ai_candidate_events` total rows: `4`
  - `npm run compare:intelligence -- --since-days 365`:
    - `total_emails=11`, `deterministic_only=7`, `ai_only=3`, `match_count=1`, `mismatch_count=0`

## 2026-02-26 - Secrets/config migrated to vaultSolution runtime
Status: COMPLETE
- Cutover completed to centralized vault runtime env:
  - `.env` -> `/media/nas/workspaces/vaultSolution/runtime/projects/EmailScanning/.env.runtime`
  - `email-scanning-admin/api/.env` -> same runtime file
  - `email-scanning-admin/ui/.env` -> same runtime file
- Added helper and guard:
  - `scripts/use-vault-env.sh`
  - `npm run verify:secrets`
- Validation:
  - `npm run backfill:intelligence -- --since-days 14 --limit 20 --dry-run` succeeded.
  - `vaultSolution/bin/vaultctl verify` passed.

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
- [x] 17. Amazon return parsing enhancements + near-miss logging (Added during execution)
- [x] 18. Azure dev deployment + scheduling (Added during execution)
- [x] 19. Deterministic Amazon + Manulife event model + parser integration (Added during execution)
- [x] 20. Delivery auth client-credentials token provider + Amazon/Manulife translator (Added during execution)
- [x] 21. Unified 15-minute NAS scheduled cycle (poll + deliver) (Added during execution)
- [x] 22. Admin monitor templates + event family filters (Added during execution)

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

## Task 19 — Completed (Added during execution)
Completed: 2026-02-22T09:00:00Z
Summary:
- Added deterministic Manulife parsing/events and near-miss table.
- Standardized outbox payload contract for Amazon + Manulife.
- Updated event dedupe to use provider + mail account + event type + primary ref + amount + date hash.
Files:
- `src/events/signalEvents.ts`
- `src/automation/manulifeClaimParser.ts`
- `src/automation/manulifeClaimParserTest.ts`
- `src/automation/manulifeClaimReplay.ts`
- `src/ingestion/emailIngestionService.ts`
- `prisma/schema.prisma`
- `prisma/migrations/20260222080000_manulife_claim_near_miss/migration.sql`

## Task 20 — Completed (Added during execution)
Completed: 2026-02-22T09:00:00Z
Summary:
- Delivery worker now handles Amazon + Manulife mapping/idempotency paths against MoneyRecovery.
- Added unattended Entra client-credentials token provider (with v2->v1 fallback) for delivery auth.
- External ref source normalized to `email_scanning` with backward-compat lookup.
Files:
- `src/delivery/moneyRecoveryClient.ts`
- `src/delivery/authTokenProvider.ts`
- `src/delivery/rviClient.ts`
- `src/delivery/index.ts`
- `src/delivery/backfillAmazonRejected.ts`
- `src/delivery/moneyRecoveryClientTest.ts`

## Task 21 — Completed (Added during execution)
Completed: 2026-02-22T09:00:00Z
Summary:
- Added single-command scheduled cycle (`poll` then `deliver`) and systemd/logrotate artifacts for 15-minute unattended NAS operation.
Files:
- `src/ops/runScheduledCycle.ts`
- `ops/systemd/email-scanning.service`
- `ops/systemd/email-scanning.timer`
- `ops/systemd/email-scanning.logrotate`

## Task 22 — Completed (Added during execution)
Completed: 2026-02-22T09:00:00Z
Summary:
- Added monitor template actions for Amazon and Manulife in Admin Hub.
- Added outbox filtering by event family prefix in Admin API/UI.
Files:
- `email-scanning-admin/ui/src/pages/MonitorsPage.tsx`
- `email-scanning-admin/ui/src/pages/EventsPage.tsx`
- `email-scanning-admin/api/src/index.ts`
- `email-scanning-admin/api/src/store.ts`
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

Progress: 2026-02-06T05:30:30Z
- Bumped package version to 1.0.0 and tagged git release v1.0.0.

Progress: 2026-02-06T13:56:52Z
- Created Azure Automation account email-scan-automation and enabled managed identity.
- Assigned Contributor role on rg-email-scanning-dev to the automation identity.
- Created runbook trigger-signal-engine-job (PowerShell) to start Container Apps Job via REST.
- Created schedule signal-engine-hourly and linked runbook via job schedule.
- Manual runbook start succeeded; Container Apps Job execution signal-engine-dev-bv0jdc5 completed with 25 new emails.

Progress: 2026-02-07T05:05:00Z
- Enabled Amazon AI fallback in the dev Container Apps Job (Azure OpenAI endpoint + key).
- Replaced hourly Automation schedule with signal-engine-30min (every 30 minutes, UTC) and re-linked job schedule.

Progress: 2026-02-07T05:25:00Z
- Added MoneyRecovery delivery mode for Amazon events (no generic /events endpoint dependency).
- Delivery worker now passes `eventType` explicitly to delivery clients.
- MoneyRecovery delivery behavior:
- Lookup external reference for `amazon_order_id` (source `signal-engine`), else try candidates by amount.
- Auto-links only when exactly 1 candidate is returned; otherwise marks event `needs_review`.
- For drop-off confirmation: marks return flow submitted.
- For refund issued: marks return flow refunded with `refunded_at` from email received timestamp.

Progress: 2026-02-07T06:40:00Z
- Added Azure dev delivery job `signal-engine-deliver-dev` (manual trigger) and updated Azure Automation runbook to start both ingestion and delivery jobs every 30 minutes.
- Fixed delivery worker so auth/outage/404 errors do not burn events (keeps them pending for retry).
- Redeployed MoneyRecovery dev container app image so `/rvi/external-references/lookup` and `/rvi/returns/candidates` endpoints are present (they return 401 without a token).

Progress: 2026-02-08T00:20:00Z
- Deployed Email Scanning Admin Hub to Azure as a Container App: `email-scanning-admin-dev`.
- Admin URL: https://email-scanning-admin-dev.icyrock-837789e5.canadacentral.azurecontainerapps.io/admin/dashboard
- UI is served from the API container (`UI_DIST_PATH=/app/ui-dist`); UI reads the admin token from runtime localStorage key `email_scanning_admin_token` when not baked at build time.

Progress: 2026-02-18T23:20:00Z
- Added read-only admin events visibility for all outbox statuses (pending/delivered/rejected).
- API: new `GET /api/events` endpoint with status and limit filters, including latest delivery log response and source email metadata.
- UI: new `/admin/events` page with status tabs and delivery response details for rejected-event review.

Progress: 2026-02-18T23:33:00Z
- Built and pushed updated `email-scanning-admin:dev` image (ACR build run `cx1`).
- Updated Azure Container App `email-scanning-admin-dev` to latest image; live app now serves `/admin/events`.

Progress: 2026-02-18T23:35:00Z
- Added Azure Postgres firewall IP updater script `ops/azure/update_pg_firewall_ip.sh`.
- Installed NAS cron job to refresh firewall rule `allow-email-scanning-current` every 10 minutes.

Progress: 2026-02-19T00:10:00Z
- Added `mail_accounts.moneyrecovery_person_code` mapping and deployed migration `20260218234500_moneyrecovery_person_code_and_needs_review`.
- Extended `events_outbox_status` enum with `needs_review` and updated delivery worker status mapping.
- MoneyRecovery delivery now supports fallback auto-create:
- lookup external reference -> candidates -> create RVI (if person code exists) -> ensure external reference -> apply event transitions.
- Missing person code now yields `needs_review` with reason `missing_person_code_mapping_for_mail_account` (not rejected).
- Added Amazon rejected-event backfill tool: `npm run deliver:backfill:amazon`.
- Added admin support for person code configuration (API + UI), plus warning banners on mail accounts/monitors/events screens for missing mappings.
- Added parser improvements for return-request amount_total, payment method last4 extraction, and year-boundary inference for missing-year dates.
- Added tests for auto-create flow, replay idempotency, missing mapping behavior, refund-first flow, and Rodney sample parsing.
- Validation:
- `npm run db:generate` (pass)
- `npm run db:migrate:deploy` (pass)
- `npm run build` (pass)
- `npm run test:amazon:return-parser` (pass)
- `npm run test:delivery:money-recovery` (pass)

Progress: 2026-02-19T00:12:00Z
- Ran `npm run deliver:backfill:amazon` for previously rejected Amazon no-candidate events.
- Selected 8 events and reset to pending, but delivery is currently blocked by MoneyRecovery 401 Unauthorized (token expired/invalid), so events remain pending for retry.

Progress: 2026-02-22T20:20:00Z
- Major release prep: bumped package version to `2.0.0`.
- Confirmed MoneyRecovery person mapping must use valid 3-letter person codes (`ROD`, `PRI`, `CHA`, `YAS`, `ADR`), and set active mailbox mapping to `ROD`.
- Re-ran Amazon delivery with mapping fixed:
  - `amazon.refund_issued`: delivered (6)
  - `amazon.return_requested`: delivered (1)
  - `amazon.return_dropped_off`: needs_review (1)
- Hardened delivery worker behavior:
  - auto-create memo is truncated to 200 chars before POST `/rvi`
  - return-flow readiness/artifact 400s are classified as `needs_review` (not `rejected`)
- Tightened Admin Mail Account validation for `moneyrecovery_person_code` to exact 3-letter uppercase format.

Progress: 2026-02-28T01:39:00Z
- Switched Azure `email-scanning-admin-dev` to Entra-only auth mode.
- Applied env vars: `ADMIN_AUTH_MODE=entra`, `ADMIN_ENTRA_TENANT_ID`, `ADMIN_ENTRA_AUDIENCE`.
- Removed static token auth config from Azure Container App (`ADMIN_TOKEN`, `TOKEN_ROTATED_AT`, `admin-token` secret).
- Deployed admin API/UI image with Entra bearer validation and verified unauthorized requests return `401`.
- Live ready revision: `email-scanning-admin-dev--0000008`.

Progress: 2026-02-28T02:20:00Z
- Added Entra/MSAL login UX to Email Scanning Admin UI (pattern aligned with MoneyRecovery UI):
  - sidebar `Login` / `Logout` control
  - signed-in user name display
  - automatic token acquisition/storage and API auth header wiring
- UI now prioritizes `localStorage.authToken` (MSAL) for API calls, with fallback to legacy `email_scanning_admin_token`.
- Added MSAL UI env overrides (`VITE_ENTRA_TENANT_ID`, `VITE_UI_CLIENT_ID`, `VITE_ENTRA_API_CLIENT_ID`, `VITE_API_SCOPE`, `VITE_REDIRECT_URI`).
- Validation: `cd email-scanning-admin/ui && npm run build` passed.

Progress: 2026-02-28T02:33:00Z
- Fixed Entra sign-in redirect mismatch (`AADSTS50011`) for admin UI client `a3338ab1-ddb2-4c50-831d-051549e314cc`.
- Updated app registration SPA redirect URIs to include:
  - `https://email-scanning-admin-dev.icyrock-837789e5.canadacentral.azurecontainerapps.io`
  - `https://email-scanning-admin-dev.icyrock-837789e5.canadacentral.azurecontainerapps.io/`

Progress: 2026-02-28T02:50:00Z
- Fixed post-login `Unauthorized` state in admin UI by aligning API token validation with MoneyRecovery:
  - accepted issuer claims from both Entra formats (`sts.windows.net/<tenant>/` and `login.microsoftonline.com/<tenant>/v2.0`)
  - accepted audience claims in both forms (`api://<app-id>` and `<app-id>`)
- Deployed `email-scanning-admin-dev` revision `email-scanning-admin-dev--0000010` with auth verifier update.

Progress: 2026-02-28T03:18:00Z
- Implemented orthodontics payment ingestion payload upgrade and MoneyRecovery delivery translator.
- Orthodontics ingestion updates:
  - `orthodontics.payment_approved` now emits `transaction_id`, `person_code_hint`, and normalized `attachments` with `object_key` for artifact upload.
  - Dedupe for payment-approved now uses transaction ID when present; fallback uses subject+amount+received date (deterministic).
  - Parser keeps legacy `payment_reference` while standardizing on `transactionId`.
- MoneyRecovery delivery updates:
  - Added orthodontics delivery path for `orthodontics.payment_approved`:
    - resolve person code (mailbox mapping first, then payload hint)
    - match by external ref `orthodontics_txn_id`
    - fallback candidate match by person+amount+provider in recent urgent insurance RVIs
    - auto-create insurance RVI when no match, then attach external reference
    - upload email attachment artifacts (`receipt`) from object storage object keys
    - append memo line: `Orthodontics: invoice received via email. Plan: WSIB(ML) 50%, then OTIP(ML) 50% after COB.`
  - Added non-financial handling:
    - `orthodontics.appointment_scheduled` and `orthodontics.appointment_reminder` are now marked delivered with `reason=non_financial_signal` (no MoneyRecovery API call).
  - Artifact upload failures are non-blocking and returned as `delivery_warnings`.
- Files changed:
  - `src/automation/orthodonticsPaymentParser.ts`
  - `src/automation/orthodonticsPaymentParserTest.ts`
  - `src/automation/orthodonticsPaymentReplay.ts`
  - `src/ingestion/emailIngestionService.ts`
  - `src/intelligence/deterministicProvider.ts`
  - `src/events/signalEvents.ts`
  - `src/delivery/moneyRecoveryClient.ts`
  - `src/delivery/moneyRecoveryClientTest.ts`
- Validation:
  - `npm run build` => PASS
  - `npm run test:orthodontics` => PASS
  - `npm run test:delivery:money-recovery` => PASS
  - `npm run test:amazon:return-parser` => PASS
  - `npm run test:manulife` => PASS
- Runtime smoke commands (ops):
  - `npm run poll -- --provider gmail --limit 5`
  - `npm run deliver`

Progress: 2026-02-28T03:27:00Z
- Closed orthodontics delivery smoke test loop with live data.
- Reprocessed pending historical orthodontics events (`id` 9-14):
  - `orthodontics.payment_approved` now delivers and links to RVI `20`.
  - `orthodontics.appointment_*` events deliver as `non_financial_signal` (no MoneyRecovery mutation).
- Delivery log snapshot for event `9` now shows:
  - `linked=true`
  - `created=false` (idempotent replay)
  - `transaction_id=011225O3B-1B7C02C5-9366-4AC9-BE03-B811E956FE2C`
  - `delivery_warnings=[]`
- Validation rerun:
  - `npm run build` => PASS
  - `npm run test:orthodontics` => PASS
  - `npm run test:delivery:money-recovery` => PASS
