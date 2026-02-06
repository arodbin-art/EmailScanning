# Email Scanning Admin Hub

Standalone admin web application for configuring email scanning. This is a control plane only.

## Purpose

- Manage email accounts (configuration only).
- Manage monitors and rules.
- Visualize configuration state.

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

All routes require admin auth and only touch configuration tables.

## Environment Variables

### API

- `DATABASE_URL`: PostgreSQL connection string.
- `ADMIN_TOKEN`: Required. Shared secret for admin API access.
- `ADMIN_ALLOWED_ORIGINS`: Comma-separated list of allowed UI origins (optional).
- `AI_ENABLED`: Set to `false` to disable AI globally. If a monitor has an AI prompt while disabled, the API returns a warning.
- `PORT`: API port (default `4000`).

### UI

- `VITE_API_BASE_URL`: Base URL for the admin API (default `http://localhost:4000`).
- `VITE_ADMIN_TOKEN`: Admin token injected into API requests.

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

## Future Integration Points

- Additional auth providers.
- Synchronization with external configuration sources.
- Read-only reporting endpoints for downstream services.

## Handoff
See HANDOFF.md for current state, progress, and next steps.
