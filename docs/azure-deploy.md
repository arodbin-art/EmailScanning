# Azure Deployment (Dev)

This project deploys as a Container Apps Job. The job runs the ingestion poll once per execution.

## Resources (dev)

- Resource group: `rg-email-scanning-dev`
- Container Apps environment: `email-scan-dev-env`
- ACR: `emailscanacr354705` (Canada Central)
- Job: `signal-engine-dev`
- Delivery job: `signal-engine-deliver-dev`

## Build + Push

```
RG=rg-email-scanning-dev
ACR=emailscanacr354705
IMAGE=signal-engine
TAG=dev

az acr login -n $ACR

docker build -t $IMAGE:$TAG .
docker tag $IMAGE:$TAG $ACR.azurecr.io/$IMAGE:$TAG
docker push $ACR.azurecr.io/$IMAGE:$TAG
```

## Job Configuration

The job uses manual trigger and relies on environment variables (secrets stored in Container Apps):

- `DATABASE_URL`
- `AZURE_STORAGE_CONNECTION_STRING`
- `AZURE_STORAGE_CONTAINER`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GMAIL_TOKEN_ENCRYPTION_KEY`
- `GMAIL_TOKEN_STORE_B64` (base64 gmail_tokens.json)
- `GMAIL_TOKEN_STORE_PATH` (default `/app/secrets/gmail_tokens.json`)
- `MAIL_ACCOUNT_IDS`
- `GMAIL_QUERY`

## Run Manual Execution

```
az containerapp job start -g rg-email-scanning-dev -n signal-engine-dev
az containerapp job start -g rg-email-scanning-dev -n signal-engine-deliver-dev
```

## Automation Schedule

Automation is enabled via Azure Automation (managed identity) to trigger the Container Apps Job on a schedule.

- Automation account: `email-scan-automation`
- Runbook: `trigger-signal-engine-job` (PowerShell)
- Schedule: `signal-engine-30min` (every 30 minutes, UTC)

Runbook logic:
- Connects with managed identity.
- Calls `Microsoft.App/jobs/start` using API version `2026-01-01` for both ingestion and delivery jobs.
- Parameters: `SubscriptionId`, `ResourceGroup`, `JobName`.

Manual runbook start:

```
az automation runbook start \
  --resource-group rg-email-scanning-dev \
  --automation-account-name email-scan-automation \
  --name trigger-signal-engine-job \
  --parameters SubscriptionId=<sub-id> ResourceGroup=rg-email-scanning-dev JobName=signal-engine-dev
```

Scheduling uses an Automation job schedule linked to the runbook. Adjust or disable with:

```
az automation schedule update \
  --resource-group rg-email-scanning-dev \
  --automation-account-name email-scan-automation \
  --name signal-engine-30min \
  --is-enabled false
```

## Logs

```
az containerapp job execution list -g rg-email-scanning-dev -n signal-engine-dev -o table
az containerapp job logs show -g rg-email-scanning-dev -n signal-engine-dev --execution <execution> --container signal-engine-dev --tail 200
```

## Notes

- The container entrypoint writes `GMAIL_TOKEN_STORE_B64` to `GMAIL_TOKEN_STORE_PATH` at startup.
- The automation account managed identity has `Contributor` on `rg-email-scanning-dev`.
