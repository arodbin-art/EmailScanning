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

## Email Scanning Admin Hub (Dev)

The admin hub deploys as a regular Container App (not a job). It serves the React UI from the API container.

Build + push:

```
RG=rg-email-scanning-dev
ACR=emailscanacr354705
IMAGE=email-scanning-admin
TAG=dev

az acr login -n $ACR

docker build -t $IMAGE:$TAG -f email-scanning-admin/Dockerfile email-scanning-admin
docker tag $IMAGE:$TAG $ACR.azurecr.io/$IMAGE:$TAG
docker push $ACR.azurecr.io/$IMAGE:$TAG
```

Cloud build alternative (no local Docker daemon required):

```
AZURE_CONFIG_DIR=/tmp/azure az acr build \
  -r emailscanacr354705 \
  -t email-scanning-admin:dev \
  -f email-scanning-admin/Dockerfile \
  email-scanning-admin
```

Create the container app:

```
az containerapp create \
  -g $RG \
  -n email-scanning-admin-dev \
  --environment email-scan-dev-env \
  --image $ACR.azurecr.io/$IMAGE:$TAG \
  --registry-server $ACR.azurecr.io \
  --ingress external \
  --target-port 4000
```

Set secrets and env vars (control plane only; config tables only):

```
az containerapp secret set -g $RG -n email-scanning-admin-dev --secrets \
  database-url='<DATABASE_URL>' \
  admin-token='<ADMIN_TOKEN>'

az containerapp update -g $RG -n email-scanning-admin-dev --set-env-vars \
  DATABASE_URL=secretref:database-url \
  ADMIN_TOKEN=secretref:admin-token \
  ADMIN_ALLOWED_ORIGINS='https://<fqdn>' \
  AI_ENABLED=false \
  PORT=4000 \
  UI_DIST_PATH=/app/ui-dist
```

Get the URL:

```
az containerapp show -g $RG -n email-scanning-admin-dev --query properties.configuration.ingress.fqdn -o tsv
```

Deploy an updated image revision:

```
AZURE_CONFIG_DIR=/tmp/azure az containerapp update \
  -g rg-email-scanning-dev \
  -n email-scanning-admin-dev \
  --image emailscanacr354705.azurecr.io/email-scanning-admin:dev
```

Events page:

```
https://email-scanning-admin-dev.icyrock-837789e5.canadacentral.azurecontainerapps.io/admin/events
```

## Notes

- The container entrypoint writes `GMAIL_TOKEN_STORE_B64` to `GMAIL_TOKEN_STORE_PATH` at startup.
- The automation account managed identity has `Contributor` on `rg-email-scanning-dev`.
