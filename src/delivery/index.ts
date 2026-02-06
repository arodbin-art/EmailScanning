import "dotenv/config"
import { prisma } from "../db/prisma.js"
import { DeliveryWorker } from "./deliveryWorker.js"
import { RviClient } from "./rviClient.js"

const baseUrl = process.env.RVI_BASE_URL
if (!baseUrl) {
  console.error("RVI_BASE_URL is required")
  process.exit(1)
}

const bearerToken = process.env.RVI_BEARER_TOKEN
const timeoutMs = process.env.RVI_TIMEOUT_MS ? Number(process.env.RVI_TIMEOUT_MS) : undefined
const batchSize = process.env.RVI_BATCH_SIZE ? Number(process.env.RVI_BATCH_SIZE) : undefined

const rvi = new RviClient({ baseUrl, bearerToken, timeoutMs })
const worker = new DeliveryWorker({ db: prisma, rvi, batchSize })

worker
  .deliverPending()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("delivery failed", error)
    process.exit(1)
  })
