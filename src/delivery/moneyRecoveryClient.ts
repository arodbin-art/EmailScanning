import { DeliveryClient, DeliveryResult, OutboxDeliveryInput } from "./types.js"

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

type AmazonEventContext = {
  orderId: string
  amountTotal: number | null
  itemTitle: string | null
  dropOffBy: string | null
  paymentMethodLast4: string | null
  emailSubject: string | null
  emailReceivedAt: string | null
}

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
    const amazon = this.toAmazonContext(payload)
    if (!amazon.orderId) {
      return { status: "needs_review", raw: { reason: "missing_order_id", payload } }
    }

    const resolve = await this.resolveRviForAmazonEvent({
      input,
      amazon,
    })
    if (resolve.kind === "error") {
      return resolve.result
    }

    const apply = await this.applyAmazonEvent({
      eventType: input.eventType,
      payload,
      amazon,
      rviId: resolve.rviId,
    })
    if (apply.kind === "error") {
      return apply.result
    }

    return {
      status: "accepted",
      raw: {
        rvi_id: resolve.rviId,
        linked: true,
        event_type: input.eventType,
        order_id: amazon.orderId,
        created: resolve.created,
      },
    }
  }

  private async resolveRviForAmazonEvent(params: {
    input: OutboxDeliveryInput
    amazon: AmazonEventContext
  }): Promise<{ kind: "ok"; rviId: number; created: boolean } | { kind: "error"; result: DeliveryResult }> {
    const lookup = await this.lookupExternalReference(params.amazon.orderId)
    if (lookup.kind === "error") {
      return lookup
    }
    if (lookup.rviId) {
      const ensured = await this.ensureExternalReferenceForOrder(lookup.rviId, params.amazon.orderId)
      if (ensured.kind === "error") {
        return ensured
      }
      return { kind: "ok", rviId: lookup.rviId, created: false }
    }

    if (params.amazon.amountTotal !== null) {
      const candidates = await this.listReturnCandidates({
        merchant: "Amazon",
        amountTotal: params.amazon.amountTotal,
        limit: 10,
      })
      if (candidates.kind === "error") {
        return candidates
      }
      if (candidates.data.length === 1) {
        const rviId = candidates.data[0].id
        const ensured = await this.ensureExternalReferenceForOrder(rviId, params.amazon.orderId)
        if (ensured.kind === "error") {
          return ensured
        }
        return { kind: "ok", rviId, created: false }
      }
      if (candidates.data.length > 1) {
        return {
          kind: "error",
          result: {
            status: "needs_review",
            raw: {
              reason: "multiple_candidate_rvis",
              order_id: params.amazon.orderId,
              amount_total: params.amazon.amountTotal,
              candidates: candidates.data,
            },
          },
        }
      }
    }

    const personCode = normalizePersonCode(params.input.mailAccountPersonCode)
    if (!personCode) {
      return {
        kind: "error",
        result: {
          status: "needs_review",
          raw: {
            reason: "missing_person_code_mapping_for_mail_account",
            mail_account_id: params.input.mailAccountId,
            source_email_id: params.input.sourceEmailId,
            order_id: params.amazon.orderId,
          },
        },
      }
    }

    const created = await this.createAmazonRviFromEvent(params.input.eventType, params.amazon, personCode)
    if (created.kind === "error") {
      return created
    }
    const ensured = await this.ensureExternalReferenceForOrder(created.rviId, params.amazon.orderId)
    if (ensured.kind === "error") {
      return ensured
    }
    return { kind: "ok", rviId: created.rviId, created: true }
  }

  private async applyAmazonEvent(params: {
    eventType: string
    payload: Record<string, unknown>
    amazon: AmazonEventContext
    rviId: number
  }): Promise<{ kind: "ok" } | { kind: "error"; result: DeliveryResult }> {
    if (params.eventType === "amazon.return_requested") {
      return this.markReturnRequested({
        rviId: params.rviId,
        dropOffBy: params.amazon.dropOffBy ?? undefined,
        amountTotal: params.amazon.amountTotal ?? undefined,
        itemTitle: params.amazon.itemTitle ?? undefined,
      })
    }

    if (params.eventType === "amazon.return_dropped_off" || params.eventType === "amazon.refund_issued") {
      const detail = await this.getRviDetail(params.rviId)
      if (detail.kind === "error") {
        return detail
      }
      const returnFlowId = extractReturnFlowId(detail.data)
      if (!returnFlowId) {
        return {
          kind: "error",
          result: {
            status: "needs_review",
            raw: { reason: "rvi_missing_return_flow", rvi_id: params.rviId, detail: detail.data },
          },
        }
      }

      if (params.eventType === "amazon.return_dropped_off") {
        const droppedOffAt = asString((params.payload as any)?.email?.received_at) ?? undefined
        return this.markReturnFlowSubmitted(returnFlowId, droppedOffAt)
      }

      const refundedAt = asString((params.payload as any)?.email?.received_at) ?? undefined
      return this.markReturnFlowRefunded(returnFlowId, refundedAt, params.amazon.amountTotal ?? undefined)
    }

    return {
      kind: "error",
      result: {
        status: "needs_review",
        raw: { reason: "unsupported_event_type", event_type: params.eventType },
      },
    }
  }

  private async createAmazonRviFromEvent(
    eventType: string,
    amazon: AmazonEventContext,
    personCode: string
  ): Promise<{ kind: "ok"; rviId: number } | { kind: "error"; result: DeliveryResult }> {
    const memoParts = [
      `Auto-created from Amazon email (${eventType})`,
      `order_id=${amazon.orderId}`,
      amazon.emailSubject ? `subject=${amazon.emailSubject}` : null,
      amazon.emailReceivedAt ? `email_received_at=${amazon.emailReceivedAt}` : null,
      amazon.paymentMethodLast4 ? `payment_last4=${amazon.paymentMethodLast4}` : null,
    ].filter((part): part is string => Boolean(part))

    const body: Record<string, unknown> = {
      merchant: "Amazon",
      person_code: personCode,
      amount_total: amazon.amountTotal,
      title: amazon.itemTitle ?? `Amazon return ${amazon.orderId}`,
      memo: memoParts.join(" | "),
      category: "return",
      status: "return_requested",
      created_at: new Date().toISOString(),
    }
    if (amazon.dropOffBy) {
      body.deadline = amazon.dropOffBy
    }
    if (amazon.emailSubject || amazon.emailReceivedAt) {
      body.audit = {
        source: "signal-engine",
        email_subject: amazon.emailSubject,
        email_received_at: amazon.emailReceivedAt,
      }
    }

    const res = await this.requestJson("POST", "/rvi", body)
    if (!res.ok) {
      return { kind: "error", result: { status: "rejected", raw: res } }
    }

    const rviId = asNumber((res.json as any)?.id) ?? asNumber((res.json as any)?.rvi_id)
    if (!rviId) {
      return {
        kind: "error",
        result: { status: "needs_review", raw: { reason: "bad_create_rvi_response", res } },
      }
    }
    return { kind: "ok", rviId }
  }

  private async lookupExternalReference(
    orderId: string
  ): Promise<{ kind: "ok"; rviId: number | null } | { kind: "error"; result: DeliveryResult }> {
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

  private async ensureExternalReferenceForOrder(
    rviId: number,
    orderId: string
  ): Promise<{ kind: "ok"; data: JsonValue } | { kind: "error"; result: DeliveryResult }> {
    const res = await this.requestJson("PATCH", `/rvi/${rviId}/external-references`, {
      source: "signal-engine",
      ref_type: "amazon_order_id",
      ref_value: orderId,
    })

    if (!res.ok) {
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

  private async getRviDetail(
    rviId: number
  ): Promise<{ kind: "ok"; data: JsonValue } | { kind: "error"; result: DeliveryResult }> {
    const res = await this.requestJson("GET", `/rvi/${rviId}`)
    if (!res.ok) {
      return { kind: "error", result: { status: "rejected", raw: res } }
    }
    return { kind: "ok", data: res.json }
  }

  private async markReturnRequested(params: {
    rviId: number
    dropOffBy?: string
    amountTotal?: number
    itemTitle?: string
  }): Promise<{ kind: "ok" } | { kind: "error"; result: DeliveryResult }> {
    const detail = await this.getRviDetail(params.rviId)
    if (detail.kind === "error") {
      return detail
    }
    const returnFlowId = extractReturnFlowId(detail.data)

    if (returnFlowId) {
      const body: Record<string, unknown> = {
        requested: true,
      }
      if (params.dropOffBy) body.drop_off_by = params.dropOffBy
      if (params.amountTotal !== undefined) body.amount_total = params.amountTotal
      if (params.itemTitle) body.item_title = params.itemTitle

      const flow = await this.requestJson("PATCH", `/return-flows/${returnFlowId}`, body)
      if (flow.ok) {
        return { kind: "ok" }
      }
      if (flow.httpStatus !== 404) {
        return { kind: "error", result: { status: "rejected", raw: flow } }
      }
    }

    const fallbackBody: Record<string, unknown> = { status: "return_requested" }
    if (params.dropOffBy) fallbackBody.deadline = params.dropOffBy
    if (params.amountTotal !== undefined) fallbackBody.amount_total = params.amountTotal
    if (params.itemTitle) fallbackBody.title = params.itemTitle

    const fallback = await this.requestJson("PATCH", `/rvi/${params.rviId}`, fallbackBody)
    if (!fallback.ok) {
      return { kind: "error", result: { status: "rejected", raw: fallback } }
    }
    return { kind: "ok" }
  }

  private async markReturnFlowSubmitted(
    returnFlowId: number,
    droppedOffAt?: string
  ): Promise<{ kind: "ok" } | { kind: "error"; result: DeliveryResult }> {
    const body: Record<string, unknown> = { submitted: true }
    if (droppedOffAt) {
      body.submitted_at = droppedOffAt
    }
    const res = await this.requestJson("PATCH", `/return-flows/${returnFlowId}`, body)
    if (!res.ok) {
      return { kind: "error", result: { status: "rejected", raw: res } }
    }
    return { kind: "ok" }
  }

  private async markReturnFlowRefunded(
    returnFlowId: number,
    refundedAt?: string,
    refundAmount?: number
  ): Promise<{ kind: "ok" } | { kind: "error"; result: DeliveryResult }> {
    const body: Record<string, unknown> = { refunded: true }
    if (refundedAt) {
      body.refunded_at = refundedAt
    }
    if (refundAmount !== undefined) {
      body.refund_amount = refundAmount
    }
    const res = await this.requestJson("PATCH", `/return-flows/${returnFlowId}/refund`, body)
    if (!res.ok) {
      return { kind: "error", result: { status: "rejected", raw: res } }
    }
    return { kind: "ok" }
  }

  private toAmazonContext(payload: Record<string, unknown>): AmazonEventContext {
    const orderId = asString(payload.order_id) ?? ""
    return {
      orderId,
      amountTotal: inferAmazonAmount(payload),
      itemTitle: asString(payload.item_title),
      dropOffBy: asString(payload.drop_off_by),
      paymentMethodLast4: asString(payload.payment_method_last4),
      emailSubject: asString((payload as any)?.email?.subject),
      emailReceivedAt: asString((payload as any)?.email?.received_at),
    }
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
  const candidates = [payload.amount_total, payload.amount, payload.refund_amount, payload.estimated_refund]
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

function normalizePersonCode(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
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
