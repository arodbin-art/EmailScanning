# Gmail OAuth + Polling (Manual Test Plan)

## Required Google setup (manual)
- Create a Google Cloud project.
- Enable Gmail API.
- Create OAuth client (Web).
- Configure redirect URI (matches `GOOGLE_REDIRECT_URI`).
- Use scope: `https://www.googleapis.com/auth/gmail.readonly`.

## Environment variables
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GMAIL_TOKEN_STORE_PATH`
- `GMAIL_TOKEN_ENCRYPTION_KEY` (32 bytes, base64 or hex)

## Manual smoke test steps
1) Insert Gmail account row (enabled=false):
   - provider: `gmail`
   - auth_type: `oauth`
   - encrypted_credentials_ref: `secret://gmail/<label>`
2) Run OAuth flow:
   - `node dist/auth/gmailOAuthServer.js <label>`
3) Confirm refresh token stored at `GMAIL_TOKEN_STORE_PATH`.
4) Flip `enabled=true` on the Gmail account row.
5) Run ingestion poll:
   - `npm run poll`
6) Verify:
   - `emails_raw` rows created for Gmail messages
   - object storage writes under `emails/gmail/<yyyy>/<mm>/...`
   - re-running poll does not create duplicates

## Optional Gmail filters
- `GMAIL_LABEL_IDS=INBOX,UNREAD` (comma-separated)
- `GMAIL_QUERY=is:unread` (Gmail search syntax)

## Notes
- Gmail tokens are never stored in Postgres; only credential references are stored.
- If OAuth fails or no refresh token is returned, re-run with `prompt=consent`.

## Handoff
See HANDOFF.md for current state, progress, and next steps.
