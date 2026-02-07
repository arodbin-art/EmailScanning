import { PrismaClient } from "@prisma/client"
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
    const response = await this.client.deliverOutboxEvent({ eventType, payload })

    await this.db.eventsOutbox.update({
      where: { id: eventId },
      data: { status: mapStatus(response.status) },
    })

    await this.db.eventsDeliveryLog.create({
      data: {
        eventId,
        rviResponse: response.raw as any,
        deliveredAt: new Date(),
      },
    })
  }
}

function mapStatus(status: "accepted" | "rejected" | "needs_review"): "delivered" | "rejected" {
  if (status === "accepted") {
    return "delivered"
  }
  return "rejected"
}
