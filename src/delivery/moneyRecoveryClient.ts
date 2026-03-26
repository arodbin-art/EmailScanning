import { DeliveryClient, DeliveryResult, OutboxDeliveryInput } from "./types.js"
import { MANULIFE_EVENT_TYPES, ORTHODONTICS_EVENT_TYPES } from "../events/signalEvents.js"
import { createObjectStorage, resolveStorageProvider } from "../storage/index.js"
import { ObjectStorage } from "../storage/objectStorage.js"
import {
  buildCaptureLabel,
  buildDisplayDescription,
  stripGeneratedMemoFragments,
} from "./descriptionFormatter.js"

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
type TokenProvider = () => Promise<string | undefined>

type AmazonEventContext = {
  orderId: string
  amountTotal: number | null
  refundDetectedAmount: number | null
  itemTitle: string | null
  itemTitles: string[]
  deadlineDate: string | null
  refundDestinationText: string | null
  statusText: string | null
  paymentMethodLast4: string | null
  emailSubject: string | null
  emailReceivedAt: string | null
}

type ManulifeEventContext = {
  claimId: string | null
  statusText: string | null
  amountClaimed: number | null
  amountEligible: number | null
  amountPaid: number | null
  processedAt: string | null
  paidAt: string | null
  emailReceivedAt: string | null
  aiReview: {
    label: "high" | "medium" | "low"
    score: number
    baselineScore: number
    igptScore: number | null
    rationale: string
    flags: string[]
  } | null
}

type OrthodonticsAttachmentRef = {
  filename: string
  mimeType: string | null
  sizeBytes: number | null
  objectKey: string
}

type OrthodonticsEventContext = {
  personCodeHint: string | null
  providerLabel: string
  captureKey: string | null
  amountTotal: number | null
  transactionId: string | null
  statusText: string | null
  emailSubject: string | null
  emailReceivedAt: string | null
  attachments: OrthodonticsAttachmentRef[]
}

export class MoneyRecoveryClient implements DeliveryClient {
  private readonly baseUrl: string
  private readonly bearerToken?: string
  private readonly tokenProvider?: TokenProvider
  private readonly timeoutMs: number
  private attachmentStorage: ObjectStorage | null
  private attachmentStorageInitialized: boolean

  constructor(params: {
    baseUrl: string
    bearerToken?: string
    timeoutMs?: number
    tokenProvider?: TokenProvider
    attachmentStorage?: ObjectStorage | null
  }) {
    this.baseUrl = params.baseUrl.replace(/\/$/, "")
    this.bearerToken = params.bearerToken
    this.tokenProvider = params.tokenProvider
    this.timeoutMs = params.timeoutMs ?? 10000
    this.attachmentStorage = params.attachmentStorage ?? null
    this.attachmentStorageInitialized = params.attachmentStorage !== undefined
  }

  async deliverOutboxEvent(input: OutboxDeliveryInput): Promise<DeliveryResult> {
    if (input.eventType.startsWith("amazon.")) {
      return this.deliverAmazonEvent(input)
    }
    if (input.eventType.startsWith("manulife.")) {
      return this.deliverManulifeEvent(input)
    }
    if (input.eventType.startsWith("orthodontics.")) {
      return this.deliverOrthodonticsEvent(input)
    }
    return {
      status: "needs_review",
      raw: { reason: "unsupported_event_type", event_type: input.eventType },
    }
  }

  private async deliverAmazonEvent(input: OutboxDeliveryInput): Promise<DeliveryResult> {
    const payload = input.payload ?? {}
    const amazon = this.toAmazonContext(payload)
    if (!amazon.orderId) {
      return { status: "needs_review", raw: { reason: "missing_order_id", payload } }
    }

    const resolved = await this.resolveRviForAmazonEvent(input, amazon)
    if (resolved.kind === "error") {
      return resolved.result
    }

    for (const rviId of resolved.rviIds) {
      const applied = await this.applyAmazonEvent({
        input,
        payload,
        amazon,
        rviId,
      })
      if (applied.kind === "error") {
        return applied.result
      }
    }

    return {
      status: "accepted",
      raw: {
        source_event_id: input.eventId,
        rvi_ids: resolved.rviIds,
        rvi_id: resolved.rviIds[0] ?? null,
        linked: true,
        event_type: input.eventType,
        order_id: amazon.orderId,
        created: resolved.createdRviId !== null,
        created_rvi_id: resolved.createdRviId,
      },
    }
  }

  private async deliverManulifeEvent(input: OutboxDeliveryInput): Promise<DeliveryResult> {
    const payload = input.payload ?? {}
    const manulife = this.toManulifeContext(payload)
    const resolved = await this.resolveRviForManulifeEvent(input, manulife)
    if (resolved.kind === "error") {
      return resolved.result
    }

    const applied = await this.applyManulifeEvent({
      input,
      payload,
      manulife,
      rviId: resolved.rviId,
    })
    if (applied.kind === "error") {
      if (applied.result.status === "needs_review") {
        await this.tryAppendManulifeAiReviewMemo(resolved.rviId, input.eventId, manulife)
      }
      return applied.result
    }

    await this.tryAppendManulifeAiReviewMemo(resolved.rviId, input.eventId, manulife)

    return {
      status: "accepted",
      raw: {
        source_event_id: input.eventId,
        rvi_id: resolved.rviId,
        linked: true,
        event_type: input.eventType,
        claim_id: manulife.claimId,
        created: resolved.created,
      },
    }
  }

  private async deliverOrthodonticsEvent(input: OutboxDeliveryInput): Promise<DeliveryResult> {
    if (
      input.eventType === ORTHODONTICS_EVENT_TYPES.APPOINTMENT_SCHEDULED ||
      input.eventType === ORTHODONTICS_EVENT_TYPES.APPOINTMENT_REMINDER
    ) {
      return {
        status: "accepted",
        raw: {
          reason: "non_financial_signal",
          event_type: input.eventType,
          source_event_id: input.eventId,
        },
      }
    }

    if (input.eventType !== ORTHODONTICS_EVENT_TYPES.PAYMENT_APPROVED) {
      return {
        status: "needs_review",
        raw: { reason: "unsupported_event_type", event_type: input.eventType },
      }
    }

    const orthodontics = this.toOrthodonticsContext(input.payload ?? {})
    const personCode =
      normalizePersonCode(input.mailAccountPersonCode) ??
      normalizePersonCode(orthodontics.personCodeHint)
    if (!personCode) {
      return {
        status: "needs_review",
        raw: {
          reason: "missing_person_code_mapping_for_mail_account",
          event_type: input.eventType,
          mail_account_id: input.mailAccountId,
          source_email_id: input.sourceEmailId,
        },
      }
    }

    const resolved = await this.resolveRviForOrthodonticsEvent({
      input,
      orthodontics,
      personCode,
    })
    if (resolved.kind === "error") {
      return resolved.result
    }

    const warnings: string[] = []
    const presentation = buildOrthodonticsPresentation(orthodontics.providerLabel, personCode, orthodontics.captureKey)
    if (orthodontics.attachments.length > 0) {
      const uploadWarnings = await this.tryUploadOrthodonticsArtifacts({
        rviId: resolved.rviId,
        personCode,
        attachments: orthodontics.attachments,
      })
      warnings.push(...uploadWarnings)
    }

    const presentationApplied = await this.tryApplyOrthodonticsPresentation({
      rviId: resolved.rviId,
      sourceEventId: input.eventId,
      displayDescription: presentation.displayDescription,
    })
    if (!presentationApplied.ok && presentationApplied.warning) {
      warnings.push(presentationApplied.warning)
    }

    return {
      status: "accepted",
      raw: {
        source_event_id: input.eventId,
        event_type: input.eventType,
        rvi_id: resolved.rviId,
        linked: true,
        created: resolved.created,
        transaction_id: orthodontics.transactionId,
        provider_name: orthodontics.providerLabel,
        human_title: presentation.humanTitle,
        capture_label: presentation.captureLabel,
        display_description: presentation.displayDescription,
        amount_total: orthodontics.amountTotal,
        attachments_count: orthodontics.attachments.length,
        delivery_warnings: warnings,
      },
    }
  }

  private async resolveRviForAmazonEvent(
    input: OutboxDeliveryInput,
    amazon: AmazonEventContext
  ): Promise<
    | { kind: "ok"; rviIds: number[]; createdRviId: number | null }
    | { kind: "error"; result: DeliveryResult }
  > {
    const lookup = await this.lookupExternalReference(amazon.orderId, "amazon_order_id")
    if (lookup.kind === "error") return lookup
    if (lookup.rviIds.length > 0) {
      for (const rviId of lookup.rviIds) {
        const ensured = await this.ensureExternalReference(rviId, "amazon_order_id", amazon.orderId)
        if (ensured.kind === "error") return ensured
      }
      return { kind: "ok", rviIds: lookup.rviIds, createdRviId: null }
    }

    if (amazon.amountTotal !== null) {
      const candidates = await this.listReturnCandidates({
        merchant: "Amazon",
        amountTotal: amazon.amountTotal,
        limit: 10,
      })
      if (candidates.kind === "error") return candidates
      if (candidates.data.length === 1) {
        const rviId = candidates.data[0].id
        const ensured = await this.ensureExternalReference(rviId, "amazon_order_id", amazon.orderId)
        if (ensured.kind === "error") return ensured
        return { kind: "ok", rviIds: [rviId], createdRviId: null }
      }
      if (candidates.data.length > 1) {
        return {
          kind: "error",
          result: {
            status: "needs_review",
            raw: {
              reason: "ambiguous_match",
              order_id: amazon.orderId,
              amount_total: amazon.amountTotal,
              candidates: candidates.data,
            },
          },
        }
      }
    }

    const personCode = normalizePersonCode(input.mailAccountPersonCode)
    if (!personCode) {
      return {
        kind: "error",
        result: {
          status: "needs_review",
          raw: {
            reason: "missing_person_code_mapping_for_mail_account",
            mail_account_id: input.mailAccountId,
            source_email_id: input.sourceEmailId,
            order_id: amazon.orderId,
          },
        },
      }
    }

    const created = await this.createAmazonRviFromEvent(input.eventType, amazon, personCode)
    if (created.kind === "error") return created
    const ensured = await this.ensureExternalReference(
      created.rviId,
      "amazon_order_id",
      amazon.orderId
    )
    if (ensured.kind === "error") return ensured
    return { kind: "ok", rviIds: [created.rviId], createdRviId: created.rviId }
  }

  private async resolveRviForManulifeEvent(
    input: OutboxDeliveryInput,
    manulife: ManulifeEventContext
  ): Promise<{ kind: "ok"; rviId: number; created: boolean } | { kind: "error"; result: DeliveryResult }> {
    if (!manulife.claimId) {
      return {
        kind: "error",
        result: {
          status: "needs_review",
          raw: {
            reason: "missing_claim_id",
            event_type: input.eventType,
            mail_account_id: input.mailAccountId,
            source_email_id: input.sourceEmailId,
            status_text: manulife.statusText,
          },
        },
      }
    }

    const lookup = await this.lookupExternalReference(manulife.claimId, "manulife_claim_id")
    if (lookup.kind === "error") return lookup
    if (lookup.rviIds.length > 0) {
      const rviId = lookup.rviIds[0]
      const ensured = await this.ensureExternalReference(rviId, "manulife_claim_id", manulife.claimId)
      if (ensured.kind === "error") return ensured
      return { kind: "ok", rviId, created: false }
    }

    const personCode = normalizePersonCode(input.mailAccountPersonCode)
    if (personCode) {
      const candidateAmount = this.pickManulifeAmount(manulife)
      const candidateDate = manulife.emailReceivedAt ?? manulife.processedAt ?? manulife.paidAt
      const candidates = await this.findInsuranceCandidatesFromUrgent({
        personCode,
        amountTotal: candidateAmount,
        eventDateIso: candidateDate ?? undefined,
      })
      if (candidates.kind === "error") return candidates
      if (candidates.ids.length === 1) {
        const matchedId = candidates.ids[0]
        const ensured = await this.ensureExternalReference(
          matchedId,
          "manulife_claim_id",
          manulife.claimId
        )
        if (ensured.kind === "error") return ensured
        return { kind: "ok", rviId: matchedId, created: false }
      }
      if (candidates.ids.length > 1) {
        return {
          kind: "error",
          result: {
            status: "needs_review",
            raw: {
              reason: "multiple_candidate_rvis",
              claim_id: manulife.claimId,
              person_code: personCode,
              candidate_ids: candidates.ids,
            },
          },
        }
      }

      const created = await this.createInsuranceRviFromEvent(manulife, personCode)
      if (created.kind === "error") return created
      const ensured = await this.ensureExternalReference(
        created.rviId,
        "manulife_claim_id",
        manulife.claimId
      )
      if (ensured.kind === "error") return ensured
      return { kind: "ok", rviId: created.rviId, created: true }
    }

    return {
      kind: "error",
      result: {
        status: "needs_review",
        raw: {
          reason: "missing_person_code_mapping_for_mail_account",
          event_type: input.eventType,
          claim_id: manulife.claimId,
          mail_account_id: input.mailAccountId,
          source_email_id: input.sourceEmailId,
        },
      },
    }
  }

  private async resolveRviForOrthodonticsEvent(params: {
    input: OutboxDeliveryInput
    orthodontics: OrthodonticsEventContext
    personCode: string
  }): Promise<{ kind: "ok"; rviId: number; created: boolean } | { kind: "error"; result: DeliveryResult }> {
    const { input, orthodontics, personCode } = params
    const transactionId = orthodontics.transactionId
    if (transactionId) {
      const lookup = await this.lookupExternalReference(transactionId, "orthodontics_txn_id")
      if (lookup.kind === "error") return lookup
      if (lookup.rviIds.length > 1) {
        return {
          kind: "error",
          result: {
            status: "needs_review",
            raw: {
              reason: "ambiguous_match",
              event_type: input.eventType,
              transaction_id: transactionId,
              rvi_ids: lookup.rviIds,
            },
          },
        }
      }
      if (lookup.rviIds.length === 1) {
        const rviId = lookup.rviIds[0]
        const ensured = await this.ensureExternalReference(rviId, "orthodontics_txn_id", transactionId)
        if (ensured.kind === "error") return ensured
        return { kind: "ok", rviId, created: false }
      }
    }

    const candidates = await this.findOrthodonticsInsuranceCandidates({
      personCode,
      amountTotal: orthodontics.amountTotal,
      providerLabel: orthodontics.providerLabel,
      eventDateIso: orthodontics.emailReceivedAt ?? undefined,
      maxAgeDays: 180,
    })
    if (candidates.kind === "error") return candidates
    if (candidates.ids.length > 1) {
      return {
        kind: "error",
        result: {
          status: "needs_review",
          raw: {
            reason: "ambiguous_match",
            event_type: input.eventType,
            person_code: personCode,
            amount_total: orthodontics.amountTotal,
            provider_name: orthodontics.providerLabel,
            candidate_ids: candidates.ids,
          },
        },
      }
    }
    if (candidates.ids.length === 1) {
      const rviId = candidates.ids[0]
      if (transactionId) {
        const ensured = await this.ensureExternalReference(rviId, "orthodontics_txn_id", transactionId)
        if (ensured.kind === "error") return ensured
      }
      return { kind: "ok", rviId, created: false }
    }

    const created = await this.createOrthodonticsInsuranceRvi({
      orthodontics,
      personCode,
      sourceEventId: input.eventId,
    })
    if (created.kind === "error") return created
    if (transactionId) {
      const ensured = await this.ensureExternalReference(
        created.rviId,
        "orthodontics_txn_id",
        transactionId
      )
      if (ensured.kind === "error") return ensured
    }
    return { kind: "ok", rviId: created.rviId, created: true }
  }

  private async createOrthodonticsInsuranceRvi(params: {
    orthodontics: OrthodonticsEventContext
    personCode: string
    sourceEventId: number
  }): Promise<{ kind: "ok"; rviId: number } | { kind: "error"; result: DeliveryResult }> {
    const amountTotal = params.orthodontics.amountTotal
    if (amountTotal === null || amountTotal <= 0) {
      return {
        kind: "error",
        result: {
          status: "needs_review",
          raw: {
            reason: "missing_amount_for_orthodontics_autocreate",
            provider_name: params.orthodontics.providerLabel,
            transaction_id: params.orthodontics.transactionId,
          },
        },
      }
    }
    const purchaseDate =
      dateOnlyFromIso(params.orthodontics.emailReceivedAt) ?? todayIsoDate()
    const deadlineDate = addDaysIso(purchaseDate, 365)
    const presentation = buildOrthodonticsPresentation(
      params.orthodontics.providerLabel,
      params.personCode,
      params.orthodontics.captureKey
    )

    const res = await this.requestJson("POST", "/rvi", {
      type: "insurance",
      person_code: params.personCode,
      amount_total: amountTotal,
      purchase_date: purchaseDate,
      deadline_date: deadlineDate,
      merchant: presentation.displayDescription,
      source_event_id: params.sourceEventId,
    })
    if (!res.ok) {
      return { kind: "error", result: { status: "rejected", raw: res } }
    }
    const rviId = asNumber((res.json as any)?.id)
    if (!rviId) {
      return {
        kind: "error",
        result: { status: "needs_review", raw: { reason: "bad_create_rvi_response", res } },
      }
    }
    return { kind: "ok", rviId }
  }

  private async findOrthodonticsInsuranceCandidates(params: {
    personCode: string
    amountTotal: number | null
    providerLabel: string
    eventDateIso?: string
    maxAgeDays: number
  }): Promise<{ kind: "ok"; ids: number[] } | { kind: "error"; result: DeliveryResult }> {
    const res = await this.requestJson("GET", "/rvi/urgent")
    if (!res.ok) {
      return { kind: "error", result: { status: "rejected", raw: res } }
    }
    if (!Array.isArray(res.json)) {
      return {
        kind: "error",
        result: { status: "needs_review", raw: { reason: "bad_urgent_response", res } },
      }
    }
    const eventDate = params.eventDateIso ? new Date(params.eventDateIso) : null
    const providerNeedle = params.providerLabel.trim().toLowerCase()
    const ids = (res.json as any[])
      .filter((row) => String(row?.type ?? "").toLowerCase() === "insurance")
      .filter(
        (row) =>
          String(row?.person_code ?? "").trim().toUpperCase() === params.personCode.toUpperCase()
      )
      .filter((row) => {
        const merchant = asString(row?.merchant)?.toLowerCase() ?? ""
        return merchant.includes("durham orthodontics") || merchant.includes(providerNeedle)
      })
      .filter((row) => {
        if (params.amountTotal === null) return true
        const amount = asNumber(row?.amount_total)
        return amount !== null && Math.abs(amount - params.amountTotal) <= 1
      })
      .filter((row) => {
        if (!eventDate) return true
        const purchase = asString(row?.purchase_date)
        if (!purchase) return true
        const purchaseDate = new Date(`${purchase}T00:00:00Z`)
        if (Number.isNaN(purchaseDate.getTime())) return true
        const diffDays = Math.abs(eventDate.getTime() - purchaseDate.getTime()) / (24 * 3600 * 1000)
        return diffDays <= params.maxAgeDays
      })
      .map((row) => asNumber(row?.id))
      .filter((id): id is number => id !== null)
    return { kind: "ok", ids: Array.from(new Set(ids)) }
  }

  private async tryUploadOrthodonticsArtifacts(params: {
    rviId: number
    personCode: string
    attachments: OrthodonticsAttachmentRef[]
  }): Promise<string[]> {
    const warnings: string[] = []
    const storage = this.getAttachmentStorage()
    if (!storage) {
      return params.attachments.map(
        (attachment) =>
          `artifact upload skipped (storage unavailable): ${attachment.filename}`
      )
    }

    const existingArtifacts = await this.listRviArtifacts(params.rviId)
    const existing = new Set(
      existingArtifacts
        .map((row) => artifactIdentity(row.filename, row.sizeBytes))
        .filter((row): row is string => row !== null)
    )

    for (const attachment of params.attachments) {
      const identity = artifactIdentity(attachment.filename, attachment.sizeBytes)
      if (identity && existing.has(identity)) {
        continue
      }
      try {
        const objectData = await storage.getObject(attachment.objectKey)
        const contentType =
          attachment.mimeType ??
          objectData.contentType ??
          "application/octet-stream"
        const form = new FormData()
        form.set("type", "receipt")
        form.set("uploaded_by_person_code", params.personCode)
        const bytes = new Uint8Array(objectData.body)
        form.set(
          "file",
          new Blob([bytes], { type: contentType }),
          attachment.filename
        )
        const res = await this.requestFormData("POST", `/rvi/${params.rviId}/artifacts`, form)
        if (!res.ok) {
          warnings.push(
            `artifact upload failed (${attachment.filename}): http ${res.httpStatus}`
          )
          continue
        }
        if (identity) {
          existing.add(identity)
        }
      } catch (error) {
        warnings.push(
          `artifact upload failed (${attachment.filename}): ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      }
    }

    return warnings
  }

  private async tryApplyOrthodonticsPresentation(params: {
    rviId: number
    sourceEventId: number
    displayDescription: string
  }): Promise<{ ok: boolean; warning?: string }> {
    const detail = await this.getRviDetail(params.rviId)
    if (detail.kind === "error") {
      return { ok: false, warning: `presentation update skipped: unable to load RVI ${params.rviId}` }
    }

    const existingMerchant = asString((detail.data as any)?.merchant)
    const existingMemo = asString((detail.data as any)?.memo)
    const cleanedMemo = stripGeneratedMemoFragments(existingMemo, [
      /^invoice from email$/i,
      /^transaction_id=/i,
      /^orthodontics: invoice received via email/i,
    ])

    const body: Record<string, unknown> = { source_event_id: params.sourceEventId }
    let hasChange = false
    if (existingMerchant !== params.displayDescription) {
      body.merchant = params.displayDescription
      hasChange = true
    }
    if ((existingMemo ?? null) !== cleanedMemo) {
      body.memo = cleanedMemo
      hasChange = true
    }
    if (!hasChange) {
      return { ok: true }
    }

    const res = await this.requestJson("PATCH", `/rvi/${params.rviId}`, {
      ...body,
    })
    if (!res.ok) {
      return {
        ok: false,
        warning: `presentation update failed for rvi ${params.rviId}: http ${res.httpStatus}`,
      }
    }
    return { ok: true }
  }

  private async listRviArtifacts(
    rviId: number
  ): Promise<Array<{ filename: string; sizeBytes: number | null }>> {
    const res = await this.requestJson("GET", `/rvi/${rviId}/artifacts`)
    if (!res.ok || !Array.isArray(res.json)) {
      return []
    }
    return (res.json as any[])
      .map((row) => ({
        filename: asString(row?.filename) ?? "",
        sizeBytes: asNumber(row?.size_bytes),
      }))
      .filter((row) => row.filename.length > 0)
  }

  private getAttachmentStorage(): ObjectStorage | null {
    if (this.attachmentStorageInitialized) {
      return this.attachmentStorage
    }
    this.attachmentStorageInitialized = true
    try {
      this.attachmentStorage = createObjectStorage({
        provider: resolveStorageProvider(),
      })
      return this.attachmentStorage
    } catch {
      this.attachmentStorage = null
      return null
    }
  }

  private async applyAmazonEvent(params: {
    input: OutboxDeliveryInput
    payload: Record<string, unknown>
    amazon: AmazonEventContext
    rviId: number
  }): Promise<{ kind: "ok" } | { kind: "error"; result: DeliveryResult }> {
    if (params.input.eventType === "amazon.return_requested") {
      return this.applyAmazonReturnRequested(params.rviId, params.amazon, params.input.eventId)
    }

    const detail = await this.getRviDetail(params.rviId)
    if (detail.kind === "error") return detail
    const returnFlow = extractReturnFlow(detail.data)
    if (!returnFlow) {
      return {
        kind: "error",
        result: {
          status: "needs_review",
          raw: { reason: "rvi_missing_return_flow", rvi_id: params.rviId, detail: detail.data },
        },
      }
    }

    if (params.input.eventType === "amazon.return_dropped_off") {
      if (
        returnFlow.status === "submitted" ||
        returnFlow.status === "complete" ||
        returnFlow.status === "refund_pending_verification"
      ) {
        return { kind: "ok" }
      }
      return this.markReturnFlowSubmitted(returnFlow.id, params.input.eventId)
    }

    if (params.input.eventType === "amazon.refund_issued") {
      if (returnFlow.status === "complete") {
        return { kind: "ok" }
      }
      const detectedAt = params.amazon.emailReceivedAt ?? asString((params.payload as any)?.received_at) ?? undefined
      const amount = params.amazon.refundDetectedAmount ?? params.amazon.amountTotal
      if (amount === null || amount <= 0) {
        return {
          kind: "error",
          result: {
            status: "needs_review",
            raw: {
              reason: "missing_refund_detected_amount",
              event_type: params.input.eventType,
              order_id: params.amazon.orderId,
              rvi_id: params.rviId,
            },
          },
        }
      }
      return this.markReturnFlowRefundDetected(
        returnFlow.id,
        params.input.eventId,
        amount,
        detectedAt,
        params.amazon.refundDestinationText ?? undefined
      )
    }

    return {
      kind: "error",
      result: {
        status: "needs_review",
        raw: { reason: "unsupported_event_type", event_type: params.input.eventType },
      },
    }
  }

  private async applyManulifeEvent(params: {
    input: OutboxDeliveryInput
    payload: Record<string, unknown>
    manulife: ManulifeEventContext
    rviId: number
  }): Promise<{ kind: "ok" } | { kind: "error"; result: DeliveryResult }> {
    const eventType = params.input.eventType
    if (
      eventType === MANULIFE_EVENT_TYPES.CLAIM_RECEIVED ||
      eventType === MANULIFE_EVENT_TYPES.CLAIM_DENIED ||
      eventType === MANULIFE_EVENT_TYPES.CLAIM_INFO_REQUIRED ||
      eventType === MANULIFE_EVENT_TYPES.CLAIM_STATUS_UPDATE
    ) {
      return {
        kind: "error",
        result: {
          status: "needs_review",
          raw: {
            reason: "claim_status_requires_manual_review",
            event_type: eventType,
            claim_id: params.manulife.claimId,
            status_text: params.manulife.statusText,
            amounts: {
              amount_claimed: params.manulife.amountClaimed,
              amount_eligible: params.manulife.amountEligible,
              amount_paid: params.manulife.amountPaid,
            },
          },
        },
      }
    }

    const detail = await this.getRviDetail(params.rviId)
    if (detail.kind === "error") return detail
    const claimFlow = extractClaimFlow(detail.data)
    if (!claimFlow) {
      return {
        kind: "error",
        result: {
          status: "needs_review",
          raw: { reason: "rvi_missing_claim_flow", rvi_id: params.rviId, detail: detail.data },
        },
      }
    }

    if (eventType === MANULIFE_EVENT_TYPES.CLAIM_PROCESSED) {
      const targetSubmitted =
        params.manulife.amountEligible ?? params.manulife.amountClaimed ?? null
      if (targetSubmitted === null || targetSubmitted <= 0) {
        return {
          kind: "error",
          result: {
            status: "needs_review",
            raw: {
              reason: "missing_amount_for_claim_processed",
              event_type: eventType,
              claim_id: params.manulife.claimId,
              status_text: params.manulife.statusText,
            },
          },
        }
      }
      if (roughlyEqual(claimFlow.amountSubmitted, targetSubmitted)) {
        return { kind: "ok" }
      }
      return this.patchClaimFlow(claimFlow.id, params.input.eventId, {
        amount_submitted: targetSubmitted,
      })
    }

    if (eventType === MANULIFE_EVENT_TYPES.CLAIM_PAID) {
      const targetPaid = params.manulife.amountPaid
      if (targetPaid === null || targetPaid <= 0) {
        return {
          kind: "error",
          result: {
            status: "needs_review",
            raw: {
              reason: "missing_amount_for_claim_paid",
              event_type: eventType,
              claim_id: params.manulife.claimId,
              status_text: params.manulife.statusText,
            },
          },
        }
      }

      const patch: Record<string, number> = {}
      if (!roughlyEqual(claimFlow.amountPaid, targetPaid)) {
        patch.amount_paid = targetPaid
      }
      const submittedTarget = Math.max(
        targetPaid,
        params.manulife.amountEligible ?? params.manulife.amountClaimed ?? targetPaid
      )
      if (!roughlyEqual(claimFlow.amountSubmitted, submittedTarget)) {
        patch.amount_submitted = submittedTarget
      }
      if (Object.keys(patch).length === 0) {
        return { kind: "ok" }
      }
      return this.patchClaimFlow(claimFlow.id, params.input.eventId, patch)
    }

    return {
      kind: "error",
      result: {
        status: "needs_review",
        raw: { reason: "unsupported_event_type", event_type: eventType },
      },
    }
  }

  private async tryAppendManulifeAiReviewMemo(
    rviId: number,
    sourceEventId: number,
    manulife: ManulifeEventContext
  ): Promise<void> {
    if (!manulife.aiReview) {
      return
    }

    const line = buildManulifeAiReviewLine(manulife.claimId, manulife.aiReview)
    const detail = await this.getRviDetail(rviId)
    if (detail.kind === "error") {
      return
    }

    const existingMemo = asString((detail.data as any)?.memo)
    const linePrefix = buildManulifeAiReviewPrefix(manulife.claimId)
    if (
      (existingMemo && existingMemo.includes(line)) ||
      (existingMemo && existingMemo.includes(linePrefix))
    ) {
      return
    }

    const nextMemo = appendMemoLine(existingMemo, line)
    if (!nextMemo || nextMemo === existingMemo) {
      return
    }

    const res = await this.requestJson("PATCH", `/rvi/${rviId}`, {
      memo: nextMemo,
      source_event_id: sourceEventId,
    })
    if (!res.ok) {
      return
    }
  }

  private async applyAmazonReturnRequested(
    rviId: number,
    amazon: AmazonEventContext,
    sourceEventId: number
  ): Promise<{ kind: "ok" } | { kind: "error"; result: DeliveryResult }> {
    const detail = await this.getRviDetail(rviId)
    if (detail.kind === "error") return detail

    const body: Record<string, unknown> = { source_event_id: sourceEventId }
    let hasChange = false

    const existingAmount = asNumber((detail.data as any)?.amount_total)
    if (amazon.amountTotal !== null && !roughlyEqual(existingAmount, amazon.amountTotal)) {
      body.amount_total = amazon.amountTotal
      hasChange = true
    }

    const existingDeadline = asString((detail.data as any)?.override_deadline_date)
    if (amazon.deadlineDate && existingDeadline !== amazon.deadlineDate) {
      body.override_deadline_date = amazon.deadlineDate
      hasChange = true
    }

    if (amazon.itemTitle) {
      const existingMemo = asString((detail.data as any)?.memo)
      const memoTag = `[Amazon] ${amazon.itemTitle}`
      if (!existingMemo || !existingMemo.includes(memoTag)) {
        body.memo = appendMemo(existingMemo, memoTag)
        hasChange = true
      }
    }

    if (amazon.refundDestinationText) {
      const existingMemo = asString((body.memo as string | undefined) ?? asString((detail.data as any)?.memo))
      const destinationTag = `[AmazonDestination] ${amazon.refundDestinationText}`
      if (!existingMemo || !existingMemo.includes(destinationTag)) {
        body.memo = appendMemo(existingMemo, destinationTag)
        hasChange = true
      }
    }

    if (!hasChange) {
      return { kind: "ok" }
    }
    const res = await this.requestJson("PATCH", `/rvi/${rviId}`, body)
    if (!res.ok) {
      return { kind: "error", result: { status: "rejected", raw: res } }
    }
    return { kind: "ok" }
  }

  private async createAmazonRviFromEvent(
    eventType: string,
    amazon: AmazonEventContext,
    personCode: string
  ): Promise<{ kind: "ok"; rviId: number } | { kind: "error"; result: DeliveryResult }> {
    const purchaseDate = dateOnlyFromIso(amazon.emailReceivedAt) ?? todayIsoDate()
    const amountTotal = amazon.amountTotal ?? amazon.refundDetectedAmount
    if (amountTotal === null || amountTotal <= 0) {
      return {
        kind: "error",
        result: {
          status: "needs_review",
          raw: { reason: "missing_amount_for_amazon_autocreate", order_id: amazon.orderId },
        },
      }
    }

    const memoParts = [
      `Auto-created from Amazon email (${eventType})`,
      `order_id=${amazon.orderId}`,
      amazon.itemTitle ? `item=${amazon.itemTitle}` : null,
      amazon.itemTitles.length > 1 ? `items=${amazon.itemTitles.join("; ")}` : null,
      amazon.emailSubject ? `subject=${amazon.emailSubject}` : null,
      amazon.paymentMethodLast4 ? `payment_last4=${amazon.paymentMethodLast4}` : null,
      amazon.refundDestinationText ? `refund_destination=${amazon.refundDestinationText}` : null,
    ].filter((part): part is string => Boolean(part))
    const memo = truncateMemo(memoParts.join(" | "))

    const res = await this.requestJson("POST", "/rvi", {
      type: "return",
      person_code: personCode,
      amount_total: amountTotal,
      purchase_date: purchaseDate,
      merchant: "Amazon",
      memo,
      source_event_id: eventType,
    })
    if (!res.ok) {
      return { kind: "error", result: { status: "rejected", raw: res } }
    }

    const rviId = asNumber((res.json as any)?.id)
    if (!rviId) {
      return {
        kind: "error",
        result: { status: "needs_review", raw: { reason: "bad_create_rvi_response", res } },
      }
    }
    return { kind: "ok", rviId }
  }

  private async createInsuranceRviFromEvent(
    manulife: ManulifeEventContext,
    personCode: string
  ): Promise<{ kind: "ok"; rviId: number } | { kind: "error"; result: DeliveryResult }> {
    const amountTotal = this.pickManulifeAmount(manulife)
    if (amountTotal === null || amountTotal <= 0) {
      return {
        kind: "error",
        result: {
          status: "needs_review",
          raw: { reason: "missing_amount_for_insurance_autocreate", claim_id: manulife.claimId },
        },
      }
    }
    const purchaseDate = dateOnlyFromIso(
      manulife.emailReceivedAt ?? manulife.processedAt ?? manulife.paidAt
    ) ?? todayIsoDate()
    const deadlineDate = addDaysIso(purchaseDate, 365)
    const memo = truncateMemo(`Manulife claim ${manulife.claimId}`)

    const res = await this.requestJson("POST", "/rvi", {
      type: "insurance",
      person_code: personCode,
      amount_total: amountTotal,
      purchase_date: purchaseDate,
      deadline_date: deadlineDate,
      memo,
      source_event_id: `manulife:${manulife.claimId ?? "unknown"}`,
    })
    if (!res.ok) {
      return { kind: "error", result: { status: "rejected", raw: res } }
    }
    const rviId = asNumber((res.json as any)?.id)
    if (!rviId) {
      return {
        kind: "error",
        result: { status: "needs_review", raw: { reason: "bad_create_rvi_response", res } },
      }
    }
    return { kind: "ok", rviId }
  }

  private async patchClaimFlow(
    claimFlowId: number,
    sourceEventId: number,
    payload: Record<string, number>
  ): Promise<{ kind: "ok" } | { kind: "error"; result: DeliveryResult }> {
    const res = await this.requestJson("PATCH", `/claim-flows/${claimFlowId}`, {
      ...payload,
      source_event_id: sourceEventId,
    })
    if (!res.ok) {
      return { kind: "error", result: { status: "rejected", raw: res } }
    }
    return { kind: "ok" }
  }

  private async lookupExternalReference(
    refValue: string,
    refType: string
  ): Promise<{ kind: "ok"; rviIds: number[] } | { kind: "error"; result: DeliveryResult }> {
    const byNewSource = await this.lookupExternalReferenceBySource(
      "email_scanning",
      refType,
      refValue
    )
    if (byNewSource.kind === "error") return byNewSource
    if (byNewSource.rviIds.length > 0) return byNewSource

    // Backward compatibility for references created before source normalization.
    return this.lookupExternalReferenceBySource("signal-engine", refType, refValue)
  }

  private async lookupExternalReferenceBySource(
    source: string,
    refType: string,
    refValue: string
  ): Promise<{ kind: "ok"; rviIds: number[] } | { kind: "error"; result: DeliveryResult }> {
    const qs = new URLSearchParams({
      source,
      ref_type: refType,
      ref_value: refValue,
    })
    const res = await this.requestJson("GET", `/rvi/external-references/lookup?${qs.toString()}`)
    if (res.httpStatus === 404) {
      return { kind: "ok", rviIds: [] }
    }
    if (!res.ok) {
      return { kind: "error", result: { status: "rejected", raw: res } }
    }
    const rawIds = (res.json as any)?.rvi_ids
    const rviIds = Array.isArray(rawIds)
      ? rawIds.map((row: unknown) => asNumber(row)).filter((id): id is number => id !== null)
      : []
    const fallbackId = asNumber((res.json as any)?.rvi_id)
    if (rviIds.length === 0 && fallbackId) {
      return { kind: "ok", rviIds: [fallbackId] }
    }
    if (rviIds.length === 0) {
      return {
        kind: "error",
        result: { status: "needs_review", raw: { reason: "bad_lookup_response", res } },
      }
    }
    return { kind: "ok", rviIds: Array.from(new Set(rviIds)) }
  }

  private async ensureExternalReference(
    rviId: number,
    refType: string,
    refValue: string
  ): Promise<{ kind: "ok" } | { kind: "error"; result: DeliveryResult }> {
    const res = await this.requestJson("PATCH", `/rvi/${rviId}/external-references`, {
      source: "email_scanning",
      ref_type: refType,
      ref_value: refValue,
    })
    if (!res.ok) {
      if (res.httpStatus === 409) {
        return { kind: "error", result: { status: "needs_review", raw: res } }
      }
      return { kind: "error", result: { status: "rejected", raw: res } }
    }
    return { kind: "ok" }
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
      return {
        kind: "error",
        result: { status: "needs_review", raw: { reason: "bad_candidates_response", res } },
      }
    }
    const data = raw
      .map((row: any) => ({
        id: asNumber(row?.id) ?? 0,
        return_flow_id: asNumber(row?.return_flow_id) ?? null,
      }))
      .filter((row: any) => Number.isInteger(row.id) && row.id > 0)
    return { kind: "ok", data }
  }

  private async findInsuranceCandidatesFromUrgent(params: {
    personCode: string
    amountTotal: number | null
    eventDateIso?: string
  }): Promise<{ kind: "ok"; ids: number[] } | { kind: "error"; result: DeliveryResult }> {
    const res = await this.requestJson("GET", "/rvi/urgent")
    if (!res.ok) {
      return { kind: "error", result: { status: "rejected", raw: res } }
    }
    if (!Array.isArray(res.json)) {
      return {
        kind: "error",
        result: { status: "needs_review", raw: { reason: "bad_urgent_response", res } },
      }
    }
    const eventDate = params.eventDateIso ? new Date(params.eventDateIso) : null
    const ids = (res.json as any[])
      .filter((row) => String(row?.type ?? "").toLowerCase() === "insurance")
      .filter(
        (row) =>
          String(row?.person_code ?? "").trim().toUpperCase() ===
          params.personCode.trim().toUpperCase()
      )
      .filter((row) => {
        if (params.amountTotal === null) return true
        const amount = asNumber(row?.amount_total)
        return amount !== null && Math.abs(amount - params.amountTotal) <= 1
      })
      .filter((row) => {
        if (!eventDate) return true
        const purchase = asString(row?.purchase_date)
        if (!purchase) return true
        const purchaseDate = new Date(`${purchase}T00:00:00Z`)
        if (Number.isNaN(purchaseDate.getTime())) return true
        const diffDays = Math.abs(eventDate.getTime() - purchaseDate.getTime()) / (24 * 3600 * 1000)
        return diffDays <= 365
      })
      .map((row) => asNumber(row?.id))
      .filter((id): id is number => id !== null)
    return { kind: "ok", ids: Array.from(new Set(ids)) }
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

  private async markReturnFlowSubmitted(
    returnFlowId: number,
    sourceEventId: number
  ): Promise<{ kind: "ok" } | { kind: "error"; result: DeliveryResult }> {
    const res = await this.requestJson("PATCH", `/return-flows/${returnFlowId}`, {
      submitted: true,
      source_event_id: sourceEventId,
    })
    if (!res.ok) {
      if (isReturnFlowManualReviewError(res)) {
        return { kind: "error", result: { status: "needs_review", raw: res } }
      }
      return { kind: "error", result: { status: "rejected", raw: res } }
    }
    return { kind: "ok" }
  }

  private async markReturnFlowRefundDetected(
    returnFlowId: number,
    sourceEventId: number,
    amount: number,
    detectedAt?: string,
    destinationText?: string
  ): Promise<{ kind: "ok" } | { kind: "error"; result: DeliveryResult }> {
    const body: Record<string, unknown> = {
      amount,
      source: "email_scanning",
      sourceEventId: String(sourceEventId),
    }
    if (detectedAt) body.detectedAt = detectedAt
    if (destinationText) body.destinationText = destinationText
    const res = await this.requestJson("PATCH", `/return-flows/${returnFlowId}/refund-detected`, body)
    if (!res.ok) {
      if (isReturnFlowManualReviewError(res)) {
        return { kind: "error", result: { status: "needs_review", raw: res } }
      }
      return { kind: "error", result: { status: "rejected", raw: res } }
    }
    return { kind: "ok" }
  }

  private pickManulifeAmount(manulife: ManulifeEventContext): number | null {
    return manulife.amountClaimed ?? manulife.amountEligible ?? manulife.amountPaid ?? null
  }

  private toAmazonContext(payload: Record<string, unknown>): AmazonEventContext {
    const amazon = (payload as any)?.amazon ?? {}
    const itemRows = Array.isArray(amazon?.items)
      ? amazon.items
      : Array.isArray((payload as any)?.items)
      ? (payload as any).items
      : []
    const itemTitles = itemRows
      .map((row: any) => asString(row?.title))
      .filter((title: string | null): title is string => Boolean(title))
    const itemTitle = asString(amazon?.item_title) ?? asString(payload.item_title) ?? itemTitles[0] ?? null
    const amountTotal = inferAmount([
      amazon?.refund_total_estimated,
      payload.amount_total,
      payload.amount,
      payload.estimated_refund,
    ])
    const refundDetectedAmount = inferAmount([
      amazon?.refund_amount_issued,
      payload.refund_amount,
      payload.amount_total,
      payload.estimated_refund,
    ])
    return {
      orderId: asString(amazon?.order_id) ?? asString(payload.order_id) ?? "",
      amountTotal,
      refundDetectedAmount,
      itemTitle,
      itemTitles,
      deadlineDate:
        asString(amazon?.dropoff_deadline_date) ??
        asString(payload.deadline_date) ??
        asString(payload.drop_off_by),
      refundDestinationText:
        asString(amazon?.refund_destination_text) ?? asString(payload.refund_destination_text),
      statusText: asString(amazon?.status_text) ?? asString(payload.status_text),
      paymentMethodLast4: asString(amazon?.payment_method_last4) ?? asString(payload.payment_method_last4),
      emailSubject: asString((payload as any)?.email?.subject),
      emailReceivedAt: asString(payload.received_at) ?? asString((payload as any)?.email?.received_at),
    }
  }

  private toManulifeContext(payload: Record<string, unknown>): ManulifeEventContext {
    const aiReview = parseAiReview((payload as any)?.ai_review)
    return {
      claimId: asString(payload.claim_id),
      statusText: asString(payload.status_text),
      amountClaimed: asNumber((payload as any)?.amounts?.amount_claimed ?? payload.amount_claimed),
      amountEligible: asNumber((payload as any)?.amounts?.amount_eligible ?? payload.amount_eligible),
      amountPaid: asNumber((payload as any)?.amounts?.amount_paid ?? payload.amount_paid),
      processedAt: asString((payload as any)?.dates?.processed_at ?? payload.processed_at),
      paidAt: asString((payload as any)?.dates?.paid_at ?? payload.paid_at),
      emailReceivedAt: asString((payload as any)?.email?.received_at),
      aiReview,
    }
  }

  private toOrthodonticsContext(payload: Record<string, unknown>): OrthodonticsEventContext {
    const orthodontics = (payload as any)?.orthodontics ?? {}
    return {
      personCodeHint:
        asString(payload.person_code_hint) ??
        asString(orthodontics.person_code_hint),
      providerLabel:
        asString(payload.provider_name) ??
        asString(orthodontics.provider) ??
        asString(payload.merchant) ??
        "Durham Orthodontics",
      captureKey:
        asString(payload.capture_key) ??
        asString(orthodontics.capture_key) ??
        "durham_orthodontics_approved_payment",
      amountTotal: inferAmount([
        payload.amount_total,
        orthodontics.amount_total,
        payload.amount,
      ]),
      transactionId:
        asString(payload.transaction_id) ??
        asString(orthodontics.transaction_id) ??
        asString(payload.payment_reference) ??
        asString(orthodontics.payment_reference),
      statusText:
        asString(payload.status_text) ?? asString(orthodontics.status_text),
      emailSubject: asString((payload as any)?.email?.subject),
      emailReceivedAt:
        asString(payload.received_at) ??
        asString((payload as any)?.email?.received_at),
      attachments: parseOrthodonticsAttachmentRefs(
        Array.isArray(payload.attachments)
          ? payload.attachments
          : Array.isArray(orthodontics.attachments)
          ? orthodontics.attachments
          : []
      ),
    }
  }

  private async requestJson(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    path: string,
    body?: unknown
  ): Promise<{ ok: boolean; httpStatus: number; json: JsonValue; rawText: string }> {
    const headers = await this.buildHeaders("json")
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
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

  private async requestFormData(
    method: "POST" | "PATCH",
    path: string,
    body: FormData
  ): Promise<{ ok: boolean; httpStatus: number; json: JsonValue; rawText: string }> {
    const headers = await this.buildHeaders("form")
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body,
        signal: controller.signal,
      })
      const rawText = await res.text()
      const json = safeJson(rawText)
      return { ok: res.ok, httpStatus: res.status, json, rawText }
    } finally {
      clearTimeout(timeout)
    }
  }

  private async buildHeaders(kind: "json" | "form"): Promise<Record<string, string>> {
    const headers: Record<string, string> =
      kind === "json" ? { "Content-Type": "application/json" } : {}
    const dynamicToken = this.tokenProvider ? await this.tokenProvider() : undefined
    const token = dynamicToken ?? this.bearerToken
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }
    return headers
  }
}

function extractReturnFlow(detail: JsonValue): { id: number; status: string | null } | null {
  if (!detail || typeof detail !== "object") return null
  const flows = (detail as any).flows
  if (!Array.isArray(flows)) return null
  const flow = flows.find((row: any) => row?.type === "return")
  if (!flow) return null
  const id = asNumber(flow?.id)
  if (!id) return null
  return {
    id,
    status: asString(flow?.status),
  }
}

function extractClaimFlow(
  detail: JsonValue
): { id: number; amountSubmitted: number | null; amountPaid: number | null } | null {
  if (!detail || typeof detail !== "object") return null
  const flows = (detail as any).flows
  if (!Array.isArray(flows)) return null
  const claimFlows = flows
    .filter((row: any) => row?.type === "claim")
    .sort((a: any, b: any) => (asNumber(a?.sequence_order) ?? 0) - (asNumber(b?.sequence_order) ?? 0))
  const first = claimFlows[0]
  if (!first) return null
  const id = asNumber(first?.id)
  if (!id) return null
  return {
    id,
    amountSubmitted: asNumber(first?.amount_submitted),
    amountPaid: asNumber(first?.amount_paid),
  }
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
    if (Number.isFinite(n)) return n
  }
  return null
}

function inferAmount(values: unknown[]): number | null {
  for (const value of values) {
    const parsed = asNumber(value)
    if (parsed !== null) return parsed
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

function dateOnlyFromIso(value: string | null | undefined): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    const m = value.match(/^\d{4}-\d{2}-\d{2}/)
    return m ? m[0] : null
  }
  return parsed.toISOString().slice(0, 10)
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDaysIso(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function roughlyEqual(a: number | null, b: number | null, epsilon = 0.01): boolean {
  if (a === null || b === null) return false
  return Math.abs(a - b) <= epsilon
}

function appendMemo(existing: string | null, addition: string): string {
  if (!existing || existing.trim().length === 0) return addition
  if (existing.includes(addition)) return existing
  return `${existing} | ${addition}`.slice(0, 200)
}

function appendMemoLine(existing: string | null, line: string): string {
  const nextLine = line.slice(0, 200)
  if (!existing || existing.trim().length === 0) {
    return nextLine
  }
  if (existing.includes(nextLine)) {
    return existing
  }
  const available = 200 - existing.length - 1
  if (available <= 0) {
    return existing
  }
  return `${existing}\n${nextLine.slice(0, available)}`
}

function buildOrthodonticsPresentation(
  providerLabel: string,
  personCode: string,
  captureKey: string | null
): { humanTitle: string; captureLabel: string | null; displayDescription: string } {
  const normalizedProviderLabel = normalizeOrthodonticsProviderLabel(providerLabel)
  const humanTitle = `${normalizedProviderLabel} (${personCode.trim().toUpperCase()})`
  const captureLabel = buildCaptureLabel(captureKey)
  return {
    humanTitle,
    captureLabel,
    displayDescription: buildDisplayDescription(humanTitle, captureKey),
  }
}

function normalizeOrthodonticsProviderLabel(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (/^durham orthodontics$/i.test(normalized)) {
    return "Durham Orthodontics Ajax"
  }
  return normalized
}

function buildManulifeAiReviewPrefix(claimId: string | null): string {
  return claimId ? `AI Review[${claimId}]:` : "AI Review:"
}

function buildManulifeAiReviewLine(
  claimId: string | null,
  review: {
    label: "high" | "medium" | "low"
    score: number
    rationale: string
  }
): string {
  const score = Number.isFinite(review.score) ? review.score : 0
  const prefix = buildManulifeAiReviewPrefix(claimId)
  const rationale = (review.rationale ?? "").replace(/\s+/g, " ").trim()
  return `${prefix} ${review.label} (${score.toFixed(2)}) - ${rationale}`.slice(0, 200)
}

function parseAiReview(value: unknown): {
  label: "high" | "medium" | "low"
  score: number
  baselineScore: number
  igptScore: number | null
  rationale: string
  flags: string[]
} | null {
  if (!value || typeof value !== "object") {
    return null
  }
  const row = value as Record<string, unknown>
  const label = asString(row.label)
  if (label !== "high" && label !== "medium" && label !== "low") {
    return null
  }
  const score = asNumber(row.score)
  const baselineScore = asNumber(row.baselineScore)
  const rationale = asString(row.rationale)
  if (score === null || baselineScore === null || !rationale) {
    return null
  }
  const igptScore = asNumber(row.igptScore)
  const flags = Array.isArray(row.flags)
    ? row.flags.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry))
    : []

  return {
    label,
    score: clamp01(score),
    baselineScore: clamp01(baselineScore),
    igptScore: igptScore === null ? null : clamp01(igptScore),
    rationale: rationale.slice(0, 140),
    flags,
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function truncateMemo(value: string, maxLength = 200): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength)
}

function parseOrthodonticsAttachmentRefs(value: unknown): OrthodonticsAttachmentRef[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null
      const row = entry as Record<string, unknown>
      const objectKey = asString(row.object_key) ?? asString(row.objectKey)
      if (!objectKey) return null
      const filename = asString(row.filename) ?? fileNameFromObjectKey(objectKey)
      const mimeType = asString(row.mime_type) ?? asString(row.mimeType)
      const sizeBytes = asNumber(row.size_bytes ?? row.sizeBytes)
      return {
        filename,
        mimeType,
        sizeBytes,
        objectKey,
      } satisfies OrthodonticsAttachmentRef
    })
    .filter((entry): entry is OrthodonticsAttachmentRef => entry !== null)
}

function artifactIdentity(filename: string | null, sizeBytes: number | null): string | null {
  if (!filename) return null
  const normalizedName = filename.trim().toLowerCase()
  if (!normalizedName) return null
  const normalizedSize = sizeBytes === null ? "na" : String(sizeBytes)
  return `${normalizedName}:${normalizedSize}`
}

function fileNameFromObjectKey(objectKey: string): string {
  const normalized = objectKey.trim()
  if (!normalized) return "attachment"
  const parts = normalized.split("/")
  return parts[parts.length - 1] || "attachment"
}

function isReturnFlowManualReviewError(res: {
  ok: boolean
  httpStatus: number
  json: JsonValue
  rawText: string
}): boolean {
  if (res.httpStatus !== 400) return false
  const message = asString((res.json as any)?.error)?.toLowerCase() ?? ""
  if (!message) return false
  return (
    message.includes("not ready") ||
    message.includes("requires") ||
    message.includes("missing")
  )
}
