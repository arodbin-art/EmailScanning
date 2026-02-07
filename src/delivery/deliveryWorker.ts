import { EventsOutboxStatus, PrismaClient } from "@prisma/client"
import { DeliveryClient } from "./types.js"

export class DeliveryWorker {
  private readonly db: PrismaClient
  private readonly client: DeliveryClient
  private readonly batchSize: number

  constructor(params: { db: PrismaClient; client: DeliveryClient; batchSize?: number }) {
    this.db = params.db
    this.client = params.client
    this.batchSize = params.batchSize ?? 25
  }

  async deliverPending(): Promise<void> {
    const pending = await this.db.eventsOutbox.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      take: this.batchSize,
    })

    for (const event of pending) {
      await this.deliverEvent(event.id, event.eventType, event.payloadJson as Record<string, unknown>)
    }
  }

  private async deliverEvent(eventId: number, eventType: string, payload: Record<string, unknown>): Promise<void> {
    try {
      const response = await this.client.deliverOutboxEvent({ eventType, payload })

      const nextStatus = mapStatus(response.status, response.raw)
      if (nextStatus) {
        await this.db.eventsOutbox.update({
          where: { id: eventId },
          data: { status: nextStatus },
        })
      }

      await this.db.eventsDeliveryLog.create({
        data: {
          eventId,
          rviResponse: response.raw as any,
          deliveredAt: new Date(),
        },
      })
    } catch (error) {
      // Leave as pending so it can retry on the next run.
      await this.db.eventsDeliveryLog.create({
        data: {
          eventId,
          rviResponse: { error: error instanceof Error ? error.message : String(error) } as any,
          deliveredAt: new Date(),
        },
      })
    }
  }
}

function mapStatus(
  status: "accepted" | "rejected" | "needs_review",
  raw: unknown
): EventsOutboxStatus | null {
  if (status === "accepted") {
    return "delivered"
  }

  // Do not burn the event on transient auth/outage issues.
  const httpStatus = extractHttpStatus(raw)
  if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    httpStatus === 404 || // usually "endpoint not deployed yet" or wrong base URL; keep pending until fixed
    httpStatus === 429 ||
    (httpStatus !== null && httpStatus >= 500)
  ) {
    return null
  }

  // needs_review and permanent errors get rejected so they don't retry forever.
  return "rejected"
}

function extractHttpStatus(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  const candidates = [obj.http_status, obj.httpStatus]
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string" && value.trim().length > 0) {
      const n = Number(value)
      if (Number.isFinite(n)) return n
    }
  }
  return null
}
