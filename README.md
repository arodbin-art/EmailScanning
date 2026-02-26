# signal-engine

Autonomous signal ingestion + delivery for:
- Amazon return/refund emails
- Manulife claim status emails

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
