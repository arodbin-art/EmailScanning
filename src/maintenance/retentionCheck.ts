import "dotenv/config"
import { prisma } from "../db/prisma.js"
import { BlobServiceClient } from "@azure/storage-blob"
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3"

type RetentionConfig = {
  days: number
  provider: "azure" | "s3"
  prefix: string
}

export async function runRetentionCheck(): Promise<void> {
  const config = loadConfig()
  const cutoff = new Date(Date.now() - config.days * 24 * 60 * 60 * 1000)

  const oldEmails = await prisma.emailRaw.count({
    where: { receivedAt: { lt: cutoff } },
  })

  let oldBlobs = 0
  if (config.provider === "azure") {
    oldBlobs = await countOldAzureBlobs(config.prefix, cutoff)
  } else {
    oldBlobs = await countOldS3Objects(config.prefix, cutoff)
  }

  console.log(
    JSON.stringify({
      level: "info",
      message: "retention_check",
      retention_days: config.days,
      cutoff_iso: cutoff.toISOString(),
      email_rows_older_than_cutoff: oldEmails,
      blobs_older_than_cutoff: oldBlobs,
    })
  )
}

function loadConfig(): RetentionConfig {
  const days = Number(process.env.RETENTION_DAYS ?? "")
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error("RETENTION_DAYS must be set to a positive number")
  }
  const providerRaw = (process.env.STORAGE_PROVIDER ?? "").toLowerCase()
  if (providerRaw !== "azure" && providerRaw !== "s3") {
    throw new Error("STORAGE_PROVIDER must be 'azure' or 's3'")
  }
  const prefix = (process.env.RETENTION_BLOB_PREFIX ?? "emails/").trim()
  return {
    days,
    provider: providerRaw,
    prefix,
  }
}

async function countOldAzureBlobs(prefix: string, cutoff: Date): Promise<number> {
  const connectionString = requireEnv("AZURE_STORAGE_CONNECTION_STRING")
  const containerName = requireEnv("AZURE_STORAGE_CONTAINER")
  const serviceClient = BlobServiceClient.fromConnectionString(connectionString)
  const container = serviceClient.getContainerClient(containerName)
  let count = 0
  for await (const blob of container.listBlobsFlat({ prefix })) {
    if (blob.properties.lastModified && blob.properties.lastModified < cutoff) {
      count += 1
    }
  }
  return count
}

async function countOldS3Objects(prefix: string, cutoff: Date): Promise<number> {
  const region = requireEnv("S3_REGION")
  const bucket = requireEnv("S3_BUCKET")
  const endpoint = process.env.S3_ENDPOINT
  const accessKeyId = process.env.S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY
  const client = new S3Client({
    region,
    endpoint,
    credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
  })

  let continuationToken: string | undefined
  let count = 0
  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    )
    for (const obj of response.Contents ?? []) {
      if (obj.LastModified && obj.LastModified < cutoff) {
        count += 1
      }
    }
    continuationToken = response.NextContinuationToken
  } while (continuationToken)

  return count
}

function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`${key} is required for retention checks`)
  }
  return value
}

if (process.argv[1]?.includes("retentionCheck")) {
  runRetentionCheck().catch((error) => {
    console.error("retention check failed", error)
    process.exit(1)
  })
}
