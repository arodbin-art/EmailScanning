export type DeliveryStatus = "accepted" | "rejected" | "needs_review"

export type DeliveryResult = {
  status: DeliveryStatus
  raw: unknown
}

export type OutboxDeliveryInput = {
  eventId: number
  eventType: string
  payload: Record<string, unknown>
  sourceEmailId: number
  mailAccountId: number
  mailAccountPersonCode?: string | null
}

export interface DeliveryClient {
  deliverOutboxEvent(input: OutboxDeliveryInput): Promise<DeliveryResult>
}
