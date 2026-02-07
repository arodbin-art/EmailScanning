export type DeliveryStatus = "accepted" | "rejected" | "needs_review"

export type DeliveryResult = {
  status: DeliveryStatus
  raw: unknown
}

export type OutboxDeliveryInput = {
  eventType: string
  payload: Record<string, unknown>
}

export interface DeliveryClient {
  deliverOutboxEvent(input: OutboxDeliveryInput): Promise<DeliveryResult>
}

