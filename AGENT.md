PROJECT PROMPT — SIGNAL ENGINE (EMAIL / SIGNAL INGESTION SERVICE)

TRACKER PROGRESS FORMAT (MANDATORY)
- Update root `PROGRESS.md` after meaningful work.
- Keep `Last updated: YYYY-MM-DD` near the top.
- Keep one primary `Status: ...` line near the top (`IN PROGRESS`, `BLOCKED`, or `COMPLETE`).
- Keep immediate actions under `## NEXT` using markdown checkboxes.
- Use `- [ ]` for pending and `- [x]` for completed items.

This document is the authoritative, complete prompt for building the
Signal Engine service. It supersedes partial prompts and updates.

Copy and paste this entire block as a single instruction.

---

## Project name

signal-engine

---

## Mission

Build a standalone service that ingests external signals (starting with email),
interprets them using rules and AI, and emits structured events to the RVI system.

This service:
- Does NOT own business state.
- Does NOT close claims.
- Does NOT mutate RVI data directly.
- Produces auditable, replayable events only.

RVI remains the system of record.

---

## Core principles

- Deterministic behavior.
- Idempotent processing.
- Auditable at every step.
- Event-driven architecture.
- Raw data is immutable.
- AI suggests meaning. Rules decide action.
- No silent failure modes.

---

## Scope (Phase 1)

- Email ingestion only.
- Microsoft Graph first.
- Gmail later.
- Multiple independent email accounts.
- Static account assignment per instance.

---

## High-level architecture

1. Email ingestion
2. Raw data persistence
3. Monitor evaluation
4. AI classification
5. Event outbox
6. Delivery to RVI
7. Audit and replay tooling

No UI.
No dashboards.

---

## Technology constraints

- Language: same backend stack as RVI.
- Database: PostgreSQL.
- Object storage: Azure Blob Storage or S3-compatible.
- AI: pluggable provider, strict JSON output.
- Deployment: stateless service instances.

---

## Data ownership model

- Database stores facts and indexes.
- Object storage stores evidence.
- AI output is derived, versioned, replaceable.
- RVI owns business truth.

---

## Database schema (required)

### mail_accounts (authoritative)

Represents all known email accounts.

Fields:
- id (pk)
- provider
- account_label
- mailbox_address
- auth_type
- encrypted_credentials_ref
- enabled
- created_at

This table is global and shared.

---

### emails_raw

Stores immutable metadata per email.

Fields:
- id (pk)
- mail_account_id (fk → mail_accounts.id)
- provider
- message_id
- thread_id
- from_address
- subject
- received_at
- body_hash (sha256 of normalized text)
- body_object_key
- attachment_metadata (json)
- first_seen_at
- last_seen_at

Uniqueness constraint:
- (mail_account_id, message_id)

Every email is stored once per mailbox.

---

### email_monitor_status

Tracks monitor evaluation per email.

Fields:
- email_id (fk)
- monitor_id
- status (ignored | processed | errored)
- evaluated_at

---

### ai_inference_runs

Stores AI output verbatim.

Fields:
- id (pk)
- email_id
- monitor_id
- model_name
- prompt_version
- output_json
- confidence
- created_at

---

### events_outbox

Stores emitted events.

Fields:
- id (pk)
- event_type
- payload_json
- source_email_id
- confidence
- status (pending | delivered | rejected)
- created_at

---

### events_delivery_log

Fields:
- event_id
- rvi_response
- delivered_at

---

## Object storage rules

For each email, store immutable artifacts:

- raw_body_text.txt
- raw_body_html.html
- normalized_text.txt
- attachments/

Object key format:
emails/{provider}/{yyyy}/{mm}/{message_id}/

Raw content is never overwritten.

---

## Statelessness requirement

The service must NOT:
- Persist polling cursors in memory.
- Store offsets in local files.
- Rely on inbox flags for progress.

All idempotency and progress must derive from persisted metadata
(message_id + body_hash).

---

## Multi-account processing model (Phase 1)

The service supports multiple independent email accounts.

Assignment model:
- Accounts are assigned to a service instance via static configuration.
- Each instance processes only explicitly assigned accounts.

Each instance:
- Must not discover accounts dynamically.
- Must not process unassigned accounts.
- Must remain stateless with respect to assignment.

---

## Configuration & startup validation

### Assignment methods

Required:
- Environment variable:
  MAIL_ACCOUNT_IDS=1,3,7

Optional:
- Config file:
```yaml
mail_accounts:
  - 1
  - 3
  - 7
````

### Validation (fail fast)

Before polling starts:

1. Verify all configured IDs exist in mail_accounts.
2. Verify all configured IDs have enabled=true.
3. Verify at least one valid account is assigned.

Failure behavior:

* Log FATAL.
* Exit immediately.

Duplicate safety:

* If overlapping MAIL_ACCOUNT_IDS are detected across instances,
  log a WARNING.
* Database uniqueness constraints must prevent duplicate processing.

---

## Polling behavior

For each polling cycle:

1. Generate poll_cycle_id.
2. Resolve assigned mail_account_ids via assignment strategy.
3. For each account:

   * Authenticate independently.
   * Poll emails independently.
   * Normalize body text.
   * Hash normalized text.
   * Upsert metadata.
   * Store raw content in object storage.
   * Apply monitors scoped to that account.

Isolation rules:

* Each account is processed in its own execution boundary.
* Exceptions are caught per account.
* Failure in one account must not block others.

---

## Logging & observability

Structured logging is mandatory.

Every log entry during polling or processing must include:

* mail_account_id
* provider
* poll_cycle_id

Logs must allow reconstruction by:

* account
* polling cycle
* email message

---

## Monitor system

Monitors are configurable, not hardcoded.

Each monitor defines:

* id
* name
* enabled
* provider
* sender_rules
* subject_regex
* body_regex
* scope: all | selected
* mail_account_ids[] (if scope = selected)
* ai_prompt_template
* confidence_threshold
* allowed_event_types

Only monitors whose scope explicitly includes the current mail_account_id
are evaluated.

---

## AI classification contract

AI receives:

* Subject
* Normalized body
* Attachment summaries
* Monitor context

AI returns strict JSON only:

Fields:

* intent_type
* event_type
* reference_ids
* merchant_or_insurer
* amount
* dates
* suggested_deadline
* confidence (0–1)

Reject non-JSON output.
Store output verbatim.

---

## Event emission rules

* One event per email per monitor.
* Deterministic event IDs.
* Emit only if confidence ≥ threshold.
* Never write directly to RVI DB.

---

## RVI integration

API-only.

Endpoints:

* POST /events
* POST /events/batch

Responses:

* accepted
* rejected
* needs_review

All responses are logged.

---

## Guardrails

* Never infer account identity from deployment or hostname.
* Never process a mailbox not explicitly assigned.
* Never auto-close claims.
* Never let AI decide final state.

---

## Phase 2 compatibility (required)

Assignment logic must be isolated behind an interface:

Example:

* IAccountAssignmentStrategy

Phase 1 implementation:

* Static configuration only.

The polling loop must not know how accounts are assigned.

No environment variable reading inside core logic.

---

## Deliverables

1. Repo scaffold.
2. DB migrations.
3. Object storage abstraction.
4. Email ingestion service.
5. Monitor engine.
6. AI adapter with JSON enforcement.
7. Event outbox and delivery worker.
8. Replay and reprocessing command.
9. README with architecture and flows.
10. progress.md updated after each milestone.

---

## Implementation order (mandatory)

1. Database schema and migrations.
2. Object storage layer.
3. Email ingestion.
4. Assignment strategy abstraction.
5. Monitor evaluation.
6. AI classification.
7. Event outbox.
8. RVI delivery.
9. Replay tooling.

Proceed without asking questions unless blocked.

---

END OF PROMPT


## Handoff
See HANDOFF.md for current state, progress, and next steps.
