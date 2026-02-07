import { DeliveryClient, DeliveryResult, OutboxDeliveryInput } from "./types.js"

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export class MoneyRecoveryClient implements DeliveryClient {
  private readonly baseUrl: string
  private readonly bearerToken?: string
  private readonly timeoutMs: number

  constructor(params: { baseUrl: string; bearerToken?: string; timeoutMs?: number }) {
    this.baseUrl = params.baseUrl.replace(/\/$/, "")
    this.bearerToken = params.bearerToken
    this.timeoutMs = params.timeoutMs ?? 10000
  }

  async deliverOutboxEvent(input: OutboxDeliveryInput): Promise<DeliveryResult> {
    if (!input.eventType.startsWith("amazon.")) {
      return {
        status: "needs_review",
        raw: { reason: "unsupported_event_type", event_type: input.eventType },
      }
    }

    const payload = input.payload ?? {}
    const orderId = asString(payload.order_id)
    if (!orderId) {
      return { status: "needs_review", raw: { reason: "missing_order_id", payload } }
    }

    // Primary: exact match by external reference.
    const lookup = await this.lookupExternalReference(orderId)
    if (lookup.kind === "error") {
      return lookup.result
    }

    let rviId: number | null = lookup.rviId

    // Secondary: candidate match by merchant and approx amount, then link the order id.
    if (!rviId) {
      const amountTotal = inferAmazonAmount(payload)
      if (amountTotal === null) {
        return {
          status: "needs_review",
          raw: { reason: "no_external_ref_and_no_amount_for_candidates", order_id: orderId },
        }
      }

      const candidates = await this.listReturnCandidates({ merchant: "Amazon", amountTotal, limit: 10 })
      if (candidates.kind === "error") {
        return candidates.result
      }

      if (candidates.data.length === 0) {
        return {
          status: "needs_review",
          raw: { reason: "no_candidate_rvi_found", order_id: orderId, amount_total: amountTotal },
        }
      }

      if (candidates.data.length > 1) {
        return {
          status: "needs_review",
          raw: {
            reason: "multiple_candidate_rvis",
            order_id: orderId,
            amount_total: amountTotal,
            candidates: candidates.data,
          },
        }
      }

      rviId = candidates.data[0].id
    }

    // Ensure the external reference is attached (idempotent on the MoneyRecovery side).
    const upsertRef = await this.upsertExternalReference({
      rviId,
      source: "signal-engine",
      refType: "amazon_order_id",
      refValue: orderId,
    })
    if (upsertRef.kind === "error") {
      return upsertRef.result
    }

    // If the event implies flow movement, apply it.
    if (input.eventType === "amazon.return_dropped_off" || input.eventType === "amazon.refund_issued") {
      const detail = await this.getRviDetail(rviId)
      if (detail.kind === "error") {
        return detail.result
      }
      const returnFlowId = extractReturnFlowId(detail.data)
      if (!returnFlowId) {
        return {
          status: "needs_review",
          raw: { reason: "rvi_missing_return_flow", rvi_id: rviId, detail: detail.data },
        }
      }

      if (input.eventType === "amazon.return_dropped_off") {
        const submit = await this.markReturnFlowSubmitted(returnFlowId)
        if (submit.kind === "error") {
          return submit.result
        }
      }

      if (input.eventType === "amazon.refund_issued") {
        const refundedAt = asString((payload as any)?.email?.received_at) ?? undefined
        const refund = await this.markReturnFlowRefunded(returnFlowId, refundedAt)
        if (refund.kind === "error") {
          return refund.result
        }
      }
    }

    return {
      status: "accepted",
      raw: { rvi_id: rviId, linked: true, event_type: input.eventType, order_id: orderId },
    }
  }

  private async lookupExternalReference(orderId: string): Promise<
    | { kind: "ok"; rviId: number | null }
    | { kind: "error"; result: DeliveryResult }
  > {
    const qs = new URLSearchParams({
      source: "signal-engine",
      ref_type: "amazon_order_id",
      ref_value: orderId,
    })
    const res = await this.requestJson("GET", `/rvi/external-references/lookup?${qs.toString()}`)
    if (res.httpStatus === 404) {
      return { kind: "ok", rviId: null }
    }
    if (!res.ok) {
      return { kind: "error", result: { status: "rejected", raw: res } }
    }

    const rviId = asNumber((res.json as any)?.rvi_id)
    if (!rviId) {
      return { kind: "error", result: { status: "needs_review", raw: { reason: "bad_lookup_response", res } } }
    }
    return { kind: "ok", rviId }
  }

  private async upsertExternalReference(params: {
    rviId: number
    source: string
    refType: string
    refValue: string
  }): Promise<{ kind: "ok"; data: JsonValue } | { kind: "error"; result: DeliveryResult }> {
    const res = await this.requestJson("PATCH", `/rvi/${params.rviId}/external-references`, {
      source: params.source,
      ref_type: params.refType,
      ref_value: params.refValue,
    })

    if (!res.ok) {
      // 409 means that order id is already linked to another RVI: needs review, not an error.
      if (res.httpStatus === 409) {
        return { kind: "error", result: { status: "needs_review", raw: res } }
      }
      return { kind: "error", result: { status: "rejected", raw: res } }
    }

    return { kind: "ok", data: res.json }
  }

  private async listReturnCandidates(params: {
    merchant: string
    amountTotal: number
    limit: number
  }): Promise<
    | { kind: "ok"; data: Array<{ id: number; return_flow_id: number | null }> }
    | { kind: "error"; result: DeliveryResult }
  > {
    const qs = new URLSearchParams({
      merchant: params.merchant,
      amount_total: String(params.amountTotal),
      limit: String(params.limit),
    })

    const res = await this.requestJson("GET", `/rvi/returns/candidates?${qs.toString()}`)
    if (!res.ok) {
      return { kind: "error", result: { status: "rejected", raw: res } }
    }
    const raw = (res.json as any)?.data
    if (!Array.isArray(raw)) {
      return { kind: "error", result: { status: "needs_review", raw: { reason: "bad_candidates_response", res } } }
    }
    const data = raw
      .map((row: any) => ({
        id: asNumber(row?.id) ?? 0,
        return_flow_id: asNumber(row?.return_flow_id) ?? null,
      }))
      .filter((row: any) => Number.isInteger(row.id) && row.id > 0)
    return { kind: "ok", data }
  }

  private async getRviDetail(rviId: number): Promise<{ kind: "ok"; data: JsonValue } | { kind: "error"; result: DeliveryResult }> {
    const res = await this.requestJson("GET", `/rvi/${rviId}`)
    if (!res.ok) {
      return { kind: "error", result: { status: "rejected", raw: res } }
    }
    return { kind: "ok", data: res.json }
  }

  private async markReturnFlowSubmitted(returnFlowId: number): Promise<{ kind: "ok" } | { kind: "error"; result: DeliveryResult }> {
    const res = await this.requestJson("PATCH", `/return-flows/${returnFlowId}`, { submitted: true })
    if (!res.ok) {
      return { kind: "error", result: { status: "rejected", raw: res } }
    }
    return { kind: "ok" }
  }

  private async markReturnFlowRefunded(returnFlowId: number, refundedAt?: string): Promise<{ kind: "ok" } | { kind: "error"; result: DeliveryResult }> {
    const body: Record<string, unknown> = { refunded: true }
    if (refundedAt) {
      body.refunded_at = refundedAt
    }
    const res = await this.requestJson("PATCH", `/return-flows/${returnFlowId}/refund`, body)
    if (!res.ok) {
      return { kind: "error", result: { status: "rejected", raw: res } }
    }
    return { kind: "ok" }
  }

  private async requestJson(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    path: string,
    body?: unknown
  ): Promise<{ ok: boolean; httpStatus: number; json: JsonValue; rawText: string }> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: this.buildHeaders(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
      const rawText = await res.text()
      const json = safeJson(rawText)
      return { ok: res.ok, httpStatus: res.status, json, rawText }
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

function inferAmazonAmount(payload: Record<string, unknown>): number | null {
  const candidates = [payload.amount, payload.refund_amount, payload.estimated_refund]
  for (const value of candidates) {
    const num = asNumber(value)
    if (typeof num === "number") {
      return num
    }
  }
  return null
}

function extractReturnFlowId(detail: JsonValue): number | null {
  if (!detail || typeof detail !== "object") return null
  const flows = (detail as any).flows
  if (!Array.isArray(flows) || flows.length === 0) return null
  const first = flows.find((f: any) => f?.type === "return") ?? flows[0]
  const id = asNumber(first?.id)
  return id ?? null
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function safeJson(text: string): JsonValue {
  if (!text) return null
  try {
    return JSON.parse(text) as JsonValue
  } catch {
    return { raw: text }
  }
}
