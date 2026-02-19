import "dotenv/config"
import { prisma } from "../db/prisma.js"
import { DeliveryWorker } from "./deliveryWorker.js"
import { MoneyRecoveryClient } from "./moneyRecoveryClient.js"
import { RviClient } from "./rviClient.js"

async function main() {
  const baseUrl = process.env.RVI_BASE_URL
  if (!baseUrl) {
    throw new Error("RVI_BASE_URL is required")
  }
  const bearerToken = process.env.RVI_BEARER_TOKEN
  const timeoutMs = process.env.RVI_TIMEOUT_MS ? Number(process.env.RVI_TIMEOUT_MS) : undefined

  const kind = (process.env.RVI_DELIVERY_KIND ?? "generic").toLowerCase()
  const client =
    kind === "money_recovery"
      ? new MoneyRecoveryClient({ baseUrl, bearerToken, timeoutMs })
      : new RviClient({ baseUrl, bearerToken, timeoutMs })

  const rows = (await prisma.$queryRawUnsafe(`
    SELECT DISTINCT eo.id
    FROM email_scanning.events_outbox eo
    JOIN email_scanning.events_delivery_log edl
      ON edl.event_id = eo.id
    WHERE eo.status = 'rejected'
      AND eo.event_type IN ('amazon.return_requested','amazon.return_dropped_off','amazon.refund_issued')
      AND (
        eo.payload_json->>'reason' = 'no_candidate_rvi_found'
        OR eo.payload_json->'body'->>'reason' = 'no_candidate_rvi_found'
        OR
        edl.rvi_response->>'reason' = 'no_candidate_rvi_found'
        OR edl.rvi_response->'body'->>'reason' = 'no_candidate_rvi_found'
      )
    ORDER BY eo.id ASC
  `)) as Array<{ id: number }>

  const eventIds = rows.map((row) => row.id)
  if (eventIds.length === 0) {
    console.log("amazon_backfill_noop", { reason: "no_matching_rejected_events" })
    return
  }

  await prisma.eventsOutbox.updateMany({
    where: { id: { in: eventIds } },
    data: { status: "pending" },
  })

  const worker = new DeliveryWorker({ db: prisma, client, batchSize: Math.max(eventIds.length, 25) })
  await worker.deliverByIds(eventIds)

  const statusCounts = await prisma.eventsOutbox.groupBy({
    by: ["status"],
    where: { id: { in: eventIds } },
    _count: { _all: true },
  })

  console.log("amazon_backfill_complete", {
    selected: eventIds.length,
    counts: statusCounts.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = row._count._all
      return acc
    }, {}),
  })
}

main()
  .catch((error) => {
    console.error("amazon_backfill_failed", error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
