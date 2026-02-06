import { AzureBlobStorage } from "./azureBlobStorage.js"
import { S3Storage } from "./s3Storage.js"
import { ObjectStorage } from "./objectStorage.js"

type StorageProvider = "azure" | "s3"

type StorageConfig = {
  provider: StorageProvider
}

export function createObjectStorage(config: StorageConfig): ObjectStorage {
  if (config.provider === "azure") {
    const connectionString = requireEnv("AZURE_STORAGE_CONNECTION_STRING")
    const containerName = requireEnv("AZURE_STORAGE_CONTAINER")
    return new AzureBlobStorage({ connectionString, containerName })
  }

  const region = requireEnv("S3_REGION")
  const bucket = requireEnv("S3_BUCKET")
  const endpoint = process.env.S3_ENDPOINT
  const accessKeyId = process.env.S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY
  return new S3Storage({ region, bucket, endpoint, accessKeyId, secretAccessKey })
}

export function resolveStorageProvider(): StorageProvider {
  const raw = (process.env.STORAGE_PROVIDER ?? "").trim().toLowerCase()
  if (raw === "azure" || raw === "s3") {
    return raw
  }
  throw new Error("STORAGE_PROVIDER must be set to 'azure' or 's3'")
}

function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`${key} is required for object storage configuration`)
  }
  return value
}
