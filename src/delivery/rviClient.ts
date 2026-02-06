export type RviResponse = {
  status: "accepted" | "rejected" | "needs_review"
  raw: unknown
}

export class RviClient {
  private readonly baseUrl: string
  private readonly bearerToken?: string
  private readonly timeoutMs: number

  constructor(params: { baseUrl: string; bearerToken?: string; timeoutMs?: number }) {
    this.baseUrl = params.baseUrl.replace(/\/$/, "")
    this.bearerToken = params.bearerToken
    this.timeoutMs = params.timeoutMs ?? 10000
  }

  async deliverEvent(payload: Record<string, unknown>): Promise<RviResponse> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await fetch(`${this.baseUrl}/events`, {
        method: "POST",
        headers: this.buildHeaders(),
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

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    if (this.bearerToken) {
      headers.Authorization = `Bearer ${this.bearerToken}`
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
