import { DeliveryClient, DeliveryResult, OutboxDeliveryInput } from "./types.js"

export class RviClient implements DeliveryClient {
  private readonly baseUrl: string
  private readonly bearerToken?: string
  private readonly tokenProvider?: () => Promise<string | undefined>
  private readonly timeoutMs: number

  constructor(params: {
    baseUrl: string
    bearerToken?: string
    timeoutMs?: number
    tokenProvider?: () => Promise<string | undefined>
  }) {
    this.baseUrl = params.baseUrl.replace(/\/$/, "")
    this.bearerToken = params.bearerToken
    this.tokenProvider = params.tokenProvider
    this.timeoutMs = params.timeoutMs ?? 10000
  }

  async deliverOutboxEvent(input: OutboxDeliveryInput): Promise<DeliveryResult> {
    // Back-compat with earlier payloads that didn't embed the event type.
    const enriched = { event_type: input.eventType, ...input.payload }
    return this.deliverEvent(enriched)
  }

  async deliverEvent(payload: Record<string, unknown>): Promise<DeliveryResult> {
    const headers = await this.buildHeaders()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await fetch(`${this.baseUrl}/events`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      const text = await response.text()
      const raw = safeJson(text)
      if (!response.ok) {
        return { status: "rejected", raw: { http_status: response.status, body: raw } }
      }

      const status = normalizeStatus(raw)
      return { status, raw }
    } finally {
      clearTimeout(timeout)
    }
  }

  private async buildHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    const dynamicToken = this.tokenProvider ? await this.tokenProvider() : undefined
    const token = dynamicToken ?? this.bearerToken
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }
    return headers
  }
}

function normalizeStatus(raw: unknown): "accepted" | "rejected" | "needs_review" {
  if (!raw || typeof raw !== "object") {
    return "accepted"
  }
  const obj = raw as Record<string, unknown>
  const candidate = (obj.status ?? obj.result ?? obj.decision) as string | undefined
  if (!candidate) {
    return "accepted"
  }
  const normalized = candidate.toLowerCase()
  if (normalized === "accepted") {
    return "accepted"
  }
  if (normalized === "rejected") {
    return "rejected"
  }
  if (normalized === "needs_review" || normalized === "needs review") {
    return "needs_review"
  }
  return "needs_review"
}

function safeJson(text: string): unknown {
  if (!text) {
    return null
  }
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}
