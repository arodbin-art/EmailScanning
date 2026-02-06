# Object Storage

The Signal Engine stores email artifacts in object storage (Azure Blob or S3-compatible).

## Configuration

Set `STORAGE_PROVIDER` to `azure` or `s3` and provide the matching variables.

### Azure

- `AZURE_STORAGE_CONNECTION_STRING`
- `AZURE_STORAGE_CONTAINER`

### S3-compatible

- `S3_REGION`
- `S3_BUCKET`
- `S3_ENDPOINT` (optional)
- `S3_ACCESS_KEY_ID` (optional if using instance credentials)
- `S3_SECRET_ACCESS_KEY` (optional if using instance credentials)

## Usage

```
import { createObjectStorage, resolveStorageProvider } from "./storage/index.js"

const storage = createObjectStorage({ provider: resolveStorageProvider() })
await storage.putObject({ key: "emails/provider/2026/01/message-id/raw_body_text.txt", body: "..." })
```

## Handoff
See HANDOFF.md for current state, progress, and next steps.
