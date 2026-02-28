# Email Scanning Admin Hub

Standalone admin web application for configuring email scanning. This is a control plane only.

## Purpose

- Manage email accounts (configuration only).
- Manage monitors and rules.
- Review outbox events and delivery outcomes.
- Configure per-mailbox MoneyRecovery `person_code` mappings for Amazon auto-create.

## Boundaries

- No email polling or ingestion.
- No AI calls.
- No RVI integration.
- No background workers.
- No writes to `emails_raw`, `monitor_matches`, `ai_inference_runs`, `events_outbox`, or `events_delivery_log`.

## Tech Stack

- Backend: Node.js + TypeScript + Express
- Frontend: React + Vite
- Database: PostgreSQL (shared with signal-engine)

## Folder Structure

- `api`: Admin API server
- `ui`: React admin UI

## API Endpoints

- `GET /api/mail-accounts`
- `POST /api/mail-accounts`
- `PUT /api/mail-accounts/:id`
- `DELETE /api/mail-accounts/:id`
- `GET /api/monitors`
- `POST /api/monitors`
- `PUT /api/monitors/:id`
- `DELETE /api/monitors/:id`
- `GET /api/events?status=<pending|delivered|rejected>&limit=<n>`

All routes require admin auth and only touch configuration tables.

## Environment Variables

### API

- `DATABASE_URL`: PostgreSQL connection string.
- `ADMIN_AUTH_MODE`: `token` (default), `entra`, or `hybrid`.
- `ADMIN_TOKEN`: Required when `ADMIN_AUTH_MODE=token` or `hybrid`.
- `ADMIN_ENTRA_AUDIENCE`: Required when `ADMIN_AUTH_MODE=entra` or `hybrid` (example: `api://<app-id-uri>`).
- `ADMIN_ENTRA_TENANT_ID`: Entra tenant GUID (required unless `ADMIN_ENTRA_ISSUER` is set).
- `ADMIN_ENTRA_ISSUER`: Optional explicit issuer override (example: `https://login.microsoftonline.com/<tenant-id>/v2.0`).
- `ADMIN_ALLOWED_ORIGINS`: Comma-separated list of allowed UI origins (optional).
- `AI_ENABLED`: Set to `false` to disable AI globally. If a monitor has an AI prompt while disabled, the API returns a warning.
- `PORT`: API port (default `4000`).
- `UI_DIST_PATH`: When set, the API will serve the built UI from this directory (single-container deploy).

### UI

- `VITE_API_BASE_URL`: Base URL for the admin API (default `http://localhost:4000`).
- `VITE_ADMIN_TOKEN`: Admin token injected into API requests (optional).
  - If not set at build time, the UI will read `localStorage.email_scanning_admin_token` at runtime.
- `VITE_ENTRA_TENANT_ID`: Optional tenant override for MSAL login (defaults to project tenant).
- `VITE_UI_CLIENT_ID`: Optional Entra app client ID override for interactive login.
- `VITE_ENTRA_API_CLIENT_ID`: Optional API app client ID override used for scope construction.
- `VITE_API_SCOPE`: Optional explicit API scope override (default `api://<api-client-id>/access_as_user`).
- `VITE_REDIRECT_URI`: Optional override for MSAL redirect URI (defaults to current origin).

Mail account field:
- `moneyrecovery_person_code` (optional): when set, Amazon no-match events can auto-create RVIs for that mailbox.

## Development

### API

```
cd email-scanning-admin/api
npm install
npm run prisma:generate
npm run dev
```

The API will fail fast on schema mismatch if required columns are missing in `mail_accounts` or `monitors`.

### UI

```
cd email-scanning-admin/ui
npm install
npm run dev
```

## Docker (Single Container)

This repo includes `email-scanning-admin/Dockerfile`, which builds the API and UI and serves the UI from the API container.

Runtime env vars required:
- `DATABASE_URL`
- Auth:
  - `ADMIN_AUTH_MODE=token` with `ADMIN_TOKEN`, or
  - `ADMIN_AUTH_MODE=entra` with `ADMIN_ENTRA_AUDIENCE` + `ADMIN_ENTRA_TENANT_ID` (or `ADMIN_ENTRA_ISSUER`), or
  - `ADMIN_AUTH_MODE=hybrid` with both static token + Entra settings.

Optional:
- `ADMIN_ALLOWED_ORIGINS` (set to the deployed origin, e.g. `https://<fqdn>`)
- `AI_ENABLED=false`

## Azure (Dev)

Deployed as an Azure Container App in `rg-email-scanning-dev`:
- URL: `https://email-scanning-admin-dev.icyrock-837789e5.canadacentral.azurecontainerapps.io/admin/dashboard`
- Events page: `https://email-scanning-admin-dev.icyrock-837789e5.canadacentral.azurecontainerapps.io/admin/events`

Auth model:
- The API supports `ADMIN_AUTH_MODE=token|entra|hybrid`.
- Full external protection recommendation: `ADMIN_AUTH_MODE=entra`.
- The admin UI now includes `Login`/`Logout` controls in the sidebar and shows the signed-in user display name.
- In Entra mode, the UI acquires/stores bearer tokens via MSAL (`localStorage.authToken`) and sends them automatically.

Azure Container App env example (Entra-only):
```bash
az containerapp update \
  -g rg-email-scanning-dev \
  -n email-scanning-admin-dev \
  --set-env-vars \
    ADMIN_AUTH_MODE=entra \
    ADMIN_ENTRA_TENANT_ID=<tenant-guid> \
    ADMIN_ENTRA_AUDIENCE=api://<app-id-uri>
```

## Future Integration Points

- Additional auth providers.
- Synchronization with external configuration sources.
- Read-only reporting endpoints for downstream services.

## Handoff
See HANDOFF.md for current state, progress, and next steps.
