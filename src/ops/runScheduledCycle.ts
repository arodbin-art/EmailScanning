import "dotenv/config"
import { prisma } from "../db/prisma.js"
import { runPoll } from "../ingestion/pollRunner.js"
import { DeliveryWorker } from "../delivery/deliveryWorker.js"
import { MoneyRecoveryClient } from "../delivery/moneyRecoveryClient.js"
import { RviClient } from "../delivery/rviClient.js"
import { createDeliveryTokenProviderFromEnv } from "../delivery/authTokenProvider.js"

function readNumber(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

async function runDeliveryOnce(): Promise<void> {
  const baseUrl = process.env.RVI_BASE_URL
  if (!baseUrl) {
    console.warn("scheduled_cycle_delivery_skipped", { reason: "missing_rvi_base_url" })
    return
  }

  const bearerToken = process.env.RVI_BEARER_TOKEN
  const timeoutMs = readNumber(process.env.RVI_TIMEOUT_MS)
  const batchSize = readNumber(process.env.RVI_BATCH_SIZE)
  const tokenProvider = createDeliveryTokenProviderFromEnv()
  const kind = (process.env.RVI_DELIVERY_KIND ?? "generic").toLowerCase()
  const client =
    kind === "money_recovery"
      ? new MoneyRecoveryClient({ baseUrl, bearerToken, timeoutMs, tokenProvider })
      : new RviClient({ baseUrl, bearerToken, timeoutMs, tokenProvider })

  const worker = new DeliveryWorker({ db: prisma, client, batchSize })
  await worker.deliverPending()
}

async function main() {
  const startedAt = Date.now()
  console.log("scheduled_cycle_started", { started_at: new Date(startedAt).toISOString() })
  await runPoll()
  await runDeliveryOnce()
  console.log("scheduled_cycle_completed", {
    duration_ms: Date.now() - startedAt,
    finished_at: new Date().toISOString(),
  })
}

main()
  .catch((error) => {
    console.error("scheduled_cycle_failed", error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
