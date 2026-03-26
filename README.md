# signal-engine

Autonomous signal ingestion + delivery for:
- Amazon return/refund emails
- Manulife claim status emails

Admin Hub also supports:
- AI-assisted `Filter Drafts` onboarding from 1-2 pasted sample emails
- proposal review before creating a disabled draft monitor

## Gmail OAuth
See `docs/gmail-oauth.md` for setup and the manual smoke test flow.

## Operations
See `docs/operations.md` for systemd scheduling, alerts, and retention checks.

Key commands:
- `npm run poll`
- `npm run deliver`
- `npm run run:scheduled` (single cycle: poll then deliver)
- `npm run test:amazon`
- `npm run test:manulife`
- `npm run test:delivery:money-recovery`

Admin commands:
- `cd email-scanning-admin/api && npm test`
- `cd email-scanning-admin/ui && npm run test:templates`

## Azure Deployment
See `docs/azure-deploy.md` for the dev Container Apps job deployment.

## Handoff
See HANDOFF.md for current state, progress, and next steps.

## Vault-backed config
Secrets/config are now sourced from `vaultSolution` runtime outputs.

```bash
cd /media/nas/workspaces/vaultSolution
bin/vaultctl render --project EmailScanning

cd /media/nas/workspaces/EmailScanning
bash scripts/use-vault-env.sh
npm run verify:secrets
```
