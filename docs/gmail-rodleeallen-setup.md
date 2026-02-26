# Gmail OAuth Setup (rodleeallen@gmail.com)

## Source credentials
From `/media/nas/workspaces/vaultSolution/runtime/email-scanning/rodleeallen_secrets.json`:
- client_id: <redacted-google-client-id>
- client_secret: <redacted-google-client-secret>
- redirect_uri: http://localhost:3000/oauth2callback

## Env vars applied in `.env`
```
GOOGLE_CLIENT_ID=<redacted-google-client-id>
GOOGLE_CLIENT_SECRET=<redacted-google-client-secret>
GOOGLE_REDIRECT_URI=http://localhost:3000/oauth2callback
GMAIL_TOKEN_STORE_PATH=/media/nas/workspaces/vaultSolution/runtime/email-scanning/gmail_tokens.json
GMAIL_TOKEN_ENCRYPTION_KEY=Fc/mZSrd63fS6MRdV5+yVJl+zh/xRkZdLlKjg+kr8Fw=
```

## OAuth runbook
1) Build: `npm run build`
2) Run OAuth server: `node dist/auth/gmailOAuthServer.js rodleeallen`
3) Follow the printed URL, approve Gmail readonly access.
4) Confirm refresh token stored in `/media/nas/workspaces/vaultSolution/runtime/email-scanning/gmail_tokens.json`.
5) Update mail account:
   - `encrypted_credentials_ref=secret://gmail/rodleeallen`
   - `enabled=true`
6) Poll: `npm run poll`
7) Verify:
   - `emails_raw` rows created
   - Blob writes under `emails/gmail/<yyyy>/<mm>/...`
   - Re-run poll (no duplicates)

## Optional filters
- Unread only: `GMAIL_QUERY=is:unread`
- Inbox only: `GMAIL_LABEL_IDS=INBOX`

## Retention check (log-only)
- `npm run retention:check`

## Notes
- Tokens are encrypted at rest in `/media/nas/workspaces/vaultSolution/runtime/email-scanning/gmail_tokens.json`.
- If no refresh token is returned, revoke access and re-run OAuth.

## Handoff
See HANDOFF.md for current state, progress, and next steps.
