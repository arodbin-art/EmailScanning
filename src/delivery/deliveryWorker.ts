import { PrismaClient } from "@prisma/client"
import { RviClient } from "./rviClient.js"

export class DeliveryWorker {
  private readonly db: PrismaClient
  private readonly rvi: RviClient
  private readonly batchSize: number

  constructor(params: { db: PrismaClient; rvi: RviClient; batchSize?: number }) {
    this.db = params.db
    this.rvi = params.rvi
    this.batchSize = params.batchSize ?? 25
  }

  async deliverPending(): Promise<void> {
    const pending = await this.db.eventsOutbox.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      take: this.batchSize,
    })

    for (const event of pending) {
      await this.deliverEvent(event.id, event.payloadJson as Record<string, unknown>)
    }
  }

  private async deliverEvent(eventId: number, payload: Record<string, unknown>): Promise<void> {
    const response = await this.rvi.deliverEvent(payload)

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
