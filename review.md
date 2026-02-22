Current review status (2026-02-22):

- Previous P2 issue (AI missing credentials caused poll failure): resolved.
  - `createAiClient()` now degrades to rules-only mode when key is missing.
- Previous P2 issue (double polling from CLI entrypoint): resolved.
  - `ingestion/index.ts` now has an explicit single-run path and a regression test harness (`test:ingestion:entrypoint`).

Residual operational risks:

- Gmail OAuth token refresh for mail account `id=1` currently returns `invalid_grant`, so ingestion reports account errors until token is refreshed.
- Amazon/Manulife auto-link/create still requires `moneyrecovery_person_code` on active mail accounts to avoid `needs_review`.

## Handoff
See `HANDOFF.md` for current state and runbook.
