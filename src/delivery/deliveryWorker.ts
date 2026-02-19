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
      include: {
        sourceEmail: {
          select: {
            id: true,
            mailAccountId: true,
            mailAccount: {
              select: {
                moneyRecoveryPersonCode: true,
              },
            },
          },
        },
      },
    })

    for (const event of pending) {
      await this.deliverEvent({
        eventId: event.id,
        eventType: event.eventType,
        payload: event.payloadJson as Record<string, unknown>,
        sourceEmailId: event.sourceEmail.id,
        mailAccountId: event.sourceEmail.mailAccountId,
        mailAccountPersonCode: event.sourceEmail.mailAccount.moneyRecoveryPersonCode,
      })
    }
  }

  async deliverByIds(eventIds: number[]): Promise<void> {
    if (eventIds.length === 0) {
      return
    }
    const events = await this.db.eventsOutbox.findMany({
      where: { id: { in: eventIds } },
      orderBy: { createdAt: "asc" },
      include: {
        sourceEmail: {
          select: {
            id: true,
            mailAccountId: true,
            mailAccount: {
              select: {
                moneyRecoveryPersonCode: true,
              },
            },
          },
        },
      },
    })

    for (const event of events) {
      await this.deliverEvent({
        eventId: event.id,
        eventType: event.eventType,
        payload: event.payloadJson as Record<string, unknown>,
        sourceEmailId: event.sourceEmail.id,
        mailAccountId: event.sourceEmail.mailAccountId,
        mailAccountPersonCode: event.sourceEmail.mailAccount.moneyRecoveryPersonCode,
      })
    }
  }

  private async deliverEvent(input: {
    eventId: number
    eventType: string
    payload: Record<string, unknown>
    sourceEmailId: number
    mailAccountId: number
    mailAccountPersonCode?: string | null
  }): Promise<void> {
    try {
      const response = await this.client.deliverOutboxEvent({
        eventId: input.eventId,
        eventType: input.eventType,
        payload: input.payload,
        sourceEmailId: input.sourceEmailId,
        mailAccountId: input.mailAccountId,
        mailAccountPersonCode: input.mailAccountPersonCode,
      })

      const nextStatus = mapStatus(response.status, response.raw)
      if (nextStatus) {
        await this.db.eventsOutbox.update({
          where: { id: input.eventId },
          data: { status: nextStatus },
        })
      }

      await this.db.eventsDeliveryLog.create({
        data: {
          eventId: input.eventId,
          rviResponse: response.raw as any,
          deliveredAt: new Date(),
        },
      })
    } catch (error) {
      // Leave as pending so it can retry on the next run.
      await this.db.eventsDeliveryLog.create({
        data: {
          eventId: input.eventId,
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
  if (status === "needs_review") {
    return "needs_review"
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

  // Permanent errors that are not actionable by operators stay rejected.
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
