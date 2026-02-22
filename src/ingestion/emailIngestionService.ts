import { Prisma, PrismaClient } from "@prisma/client"
import { ObjectStorage } from "../storage/objectStorage.js"
import { buildAttachmentKey, buildEmailBaseKey } from "./objectKeys.js"
import { normalizeBody, sha256 } from "./normalization.js"
import { EmailProvider, Logger, PollContext, ProviderMessage } from "./types.js"
import { MonitorRepository } from "../monitors/monitorRepository.js"
import { MonitorEvaluator } from "../monitors/monitorEvaluator.js"
import { AiClient } from "../ai/types.js"
import crypto from "crypto"
import { detectAmazonRefundDiscrepancy } from "../automation/amazonRefundDetector.js"
import {
  detectAmazonReturnNearMiss,
  parseAmazonReturnEmail,
} from "../automation/amazonReturnParser.js"
import { amazonAiEnabled, classifyAmazonEmailWithAi } from "../automation/amazonReturnAi.js"
import {
  detectManulifeClaimNearMiss,
  isStrongManulifeSender,
  parseManulifeClaimEmail,
} from "../automation/manulifeClaimParser.js"
import {
  AMAZON_EVENT_TYPES,
  MANULIFE_EVENT_TYPES,
  buildSignalEventDedupeKey,
} from "../events/signalEvents.js"

export type IngestionOptions = {
  maxMessagesPerPoll: number
}

export type ProviderResolver = (provider: string) => EmailProvider | null

export type IngestionStats = {
  newEmails: number
  existingEmails: number
  errors: number
}

export class EmailIngestionService {
  private readonly db: PrismaClient
  private readonly storage: ObjectStorage
  private readonly providerResolver: ProviderResolver
  private readonly logger: Logger
  private readonly monitorRepository: MonitorRepository
  private readonly monitorEvaluator: MonitorEvaluator
  private readonly aiClient?: AiClient
  private readonly options: IngestionOptions

  constructor(params: {
    db: PrismaClient
    storage: ObjectStorage
    providerResolver: ProviderResolver
    logger: Logger
    aiClient?: AiClient
    options?: Partial<IngestionOptions>
  }) {
    this.db = params.db
    this.storage = params.storage
    this.providerResolver = params.providerResolver
    this.logger = params.logger
    this.monitorRepository = new MonitorRepository(params.db)
    this.monitorEvaluator = new MonitorEvaluator()
    this.aiClient = params.aiClient
    this.options = {
      maxMessagesPerPoll: params.options?.maxMessagesPerPoll ?? 50,
    }
  }

  async ingestAccount(accountId: number, context: PollContext): Promise<IngestionStats> {
    const stats: IngestionStats = { newEmails: 0, existingEmails: 0, errors: 0 }
    const account = await this.db.mailAccount.findUnique({ where: { id: accountId } })
    if (!account) {
      this.logger.warn("mail account not found", {
        mail_account_id: accountId,
        provider: "unknown",
        poll_cycle_id: context.pollCycleId,
      })
      return stats
    }
    if (!account.enabled) {
      this.logger.info("mail account disabled", {
        mail_account_id: account.id,
        provider: account.provider,
        poll_cycle_id: context.pollCycleId,
      })
      return stats
    }

    const provider = this.providerResolver(account.provider)
    if (!provider) {
      this.logger.error("unsupported mail provider", {
        mail_account_id: account.id,
        provider: account.provider,
        poll_cycle_id: context.pollCycleId,
      })
      return stats
    }

    const refs = await provider.listMessages(account, this.options.maxMessagesPerPoll)
    for (const ref of refs) {
      try {
        const result = await this.ingestMessage(account, provider, context, ref.id)
        if (result === "new") {
          stats.newEmails += 1
        } else if (result === "existing") {
          stats.existingEmails += 1
        }
      } catch (error) {
        stats.errors += 1
        this.logger.error("message ingestion failed", {
          mail_account_id: account.id,
          provider: provider.provider,
          poll_cycle_id: context.pollCycleId,
          provider_message_id: ref.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return stats
  }

  private async ingestMessage(
    account: { id: number; provider: string; enabled: boolean },
    provider: EmailProvider,
    context: PollContext,
    providerMessageId: string
  ): Promise<"new" | "existing" | "skipped"> {
    const message = await provider.getMessage(account as any, providerMessageId)
    if (!message) {
      this.logger.warn("message missing from provider", {
        mail_account_id: account.id,
        provider: provider.provider,
        poll_cycle_id: context.pollCycleId,
        provider_message_id: providerMessageId,
      })
      return "skipped"
    }

    if (!message.messageId) {
      this.logger.warn("message missing internetMessageId", {
        mail_account_id: account.id,
        provider: provider.provider,
        poll_cycle_id: context.pollCycleId,
        provider_message_id: providerMessageId,
      })
      return "skipped"
    }

    const now = new Date()
    const normalized = normalizeBody(message.body.contentType, message.body.content)
    const bodyHash = sha256(normalized)

    const existing = await this.db.emailRaw.findUnique({
      where: {
        mailAccountId_messageId: {
          mailAccountId: account.id,
          messageId: message.messageId,
        },
      },
    })

    if (existing) {
      if (existing.bodyHash !== bodyHash) {
        this.logger.warn("body hash mismatch for existing email", {
          mail_account_id: account.id,
          provider: provider.provider,
          poll_cycle_id: context.pollCycleId,
          email_id: existing.id,
        })
      }
      await this.db.emailRaw.update({
        where: { id: existing.id },
        data: { lastSeenAt: now },
      })
      return "existing"
    }

    const baseKey = buildEmailBaseKey(provider.provider, message.receivedAt, message.messageId)
    await this.storeBody(baseKey, message, normalized)
    const attachmentMetadata = await this.storeAttachments(baseKey, message)

    const createdEmail = await this.db.emailRaw.create({
      data: {
        mailAccountId: account.id,
        provider: provider.provider,
        messageId: message.messageId,
        threadId: message.threadId,
        fromAddress: message.fromAddress,
        subject: message.subject,
        receivedAt: message.receivedAt,
        bodyHash,
        bodyObjectKey: baseKey,
        attachmentMetadata: attachmentMetadata as any,
        firstSeenAt: now,
        lastSeenAt: now,
      },
    })

    const discrepancy = await detectAmazonRefundDiscrepancy({
      db: this.db,
      emailId: createdEmail.id,
      provider: provider.provider,
      messageId: message.messageId,
      subject: message.subject ?? undefined,
      receivedAt: message.receivedAt,
      fromAddress: message.fromAddress,
      normalizedBody: normalized,
    })
    if (discrepancy) {
      this.logger.warn("amazon_refund_discrepancy", {
        mail_account_id: account.id,
        provider: provider.provider,
        poll_cycle_id: context.pollCycleId,
        order_id: discrepancy.orderId,
        charged_amount: discrepancy.chargedAmount,
        refunded_amount: discrepancy.refundedAmount,
        difference: discrepancy.difference,
        subject: discrepancy.subject,
        received_at: discrepancy.receivedAt.toISOString(),
        gmail_link: discrepancy.gmailLink,
      })
    }

    await this.emitDeterministicSignalEvent({
      emailId: createdEmail.id,
      mailAccountId: account.id,
      provider: provider.provider,
      message,
      normalizedBody: normalized,
    })

    await this.evaluateMonitors(account.id, createdEmail.id, provider.provider, message, normalized)

    this.logger.info("email stored", {
      mail_account_id: account.id,
      provider: provider.provider,
      poll_cycle_id: context.pollCycleId,
      email_message_id: message.messageId,
    })

    return "new"
  }

  private async storeBody(baseKey: string, message: ProviderMessage, normalized: string): Promise<void> {
    await this.storage.putObject({
      key: `${baseKey}raw_body_text.txt`,
      body: message.body.contentType === "text" ? message.body.content : normalized,
      contentType: "text/plain",
    })

    if (message.body.contentType === "html") {
      await this.storage.putObject({
        key: `${baseKey}raw_body_html.html`,
        body: message.body.content,
        contentType: "text/html",
      })
    }

    await this.storage.putObject({
      key: `${baseKey}normalized_text.txt`,
      body: normalized,
      contentType: "text/plain",
    })
  }

  private async storeAttachments(baseKey: string, message: ProviderMessage): Promise<Record<string, unknown>> {
    const stored: Array<Record<string, unknown>> = []
    for (const attachment of message.attachments) {
      const record: Record<string, unknown> = {
        id: attachment.id,
        name: attachment.name,
        contentType: attachment.contentType,
        size: attachment.size,
        isInline: attachment.isInline,
      }

      if (attachment.contentBytes) {
        const key = buildAttachmentKey(baseKey, attachment.id, attachment.name)
        const body = Buffer.from(attachment.contentBytes, "base64")
        await this.storage.putObject({
          key,
          body,
          contentType: attachment.contentType,
        })
        record.objectKey = key
      }

      stored.push(record)
    }
    return { attachments: stored }
  }

  private async evaluateMonitors(
    accountId: number,
    emailId: number,
    providerName: string,
    message: ProviderMessage,
    normalized: string
  ): Promise<void> {
    const monitors = await this.monitorRepository.listEnabled(providerName)
    const evaluator = this.monitorEvaluator.evaluate(
      monitors,
      {
        fromAddress: message.fromAddress,
        subject: message.subject,
        normalizedBody: normalized,
        hasAttachments: message.attachments.length > 0,
        labels: message.labels,
      },
      accountId
    )

    if (evaluator.length === 0) {
      return
    }

    for (const result of evaluator) {
      if (!result.matches) {
        await this.upsertMonitorStatus(emailId, result.monitor.id, "ignored")
        continue
      }

      await this.upsertMonitorMatch(emailId, result.monitor.id, result.matchedFields)
      await this.upsertMonitorStatus(emailId, result.monitor.id, "processed")
    }
  }

  private async upsertMonitorStatus(
    emailId: number,
    monitorId: string,
    status: "ignored" | "processed" | "errored"
  ): Promise<void> {
    await this.db.emailMonitorStatus.upsert({
      where: {
        emailId_monitorId: {
          emailId,
          monitorId,
        },
      },
      update: {
        status,
        evaluatedAt: new Date(),
      },
      create: {
        emailId,
        monitorId,
        status,
        evaluatedAt: new Date(),
      },
    })
  }

  private async upsertMonitorMatch(
    emailId: number,
    monitorId: string,
    matchedFields: Record<string, unknown>
  ): Promise<void> {
    await this.db.monitorMatch.upsert({
      where: {
        emailId_monitorId: {
          emailId,
          monitorId,
        },
      },
      update: {
        matchedFields: matchedFields as any,
        matchedAt: new Date(),
      },
      create: {
        emailId,
        monitorId,
        matchedFields: matchedFields as any,
        matchedAt: new Date(),
      },
    })
  }

  private async emitEventOutbox(params: EmitEventParams): Promise<void> {
    const eventType = params.aiResult.event_type
    const isAllowed = params.allowedEventTypes.includes(eventType)
    if (!isAllowed) {
      this.logger.info("event type not allowed by monitor", {
        monitor_id: params.monitorId,
        event_type: eventType,
      })
      return
    }

    if (params.aiResult.confidence < params.confidenceThreshold) {
      this.logger.info("event confidence below threshold", {
        monitor_id: params.monitorId,
        event_type: eventType,
        confidence: params.aiResult.confidence,
        threshold: params.confidenceThreshold,
      })
      return
    }

    const payload = this.buildEventPayload(params)
    const dedupeKey = computeDedupeKey(params.emailId, params.monitorId, eventType)

    await this.db.eventsOutbox.upsert({
      where: { dedupeKey },
      update: {},
      create: {
        dedupeKey,
        eventType,
        payloadJson: payload as any,
        sourceEmailId: params.emailId,
        confidence: params.aiResult.confidence,
        status: "pending",
        createdAt: new Date(),
      },
    })
  }

  private buildEventPayload(params: EmitEventParams): Record<string, unknown> {
    return {
      email_id: params.emailId,
      monitor_id: params.monitorId,
      monitor_name: params.monitorName,
      ai_inference_run_id: params.aiRunId,
      event_type: params.aiResult.event_type,
      ai: params.aiResult,
      source: {
        from_address: params.message.fromAddress,
        subject: params.message.subject,
        received_at: params.message.receivedAt.toISOString(),
      },
    }
  }

  private async emitDeterministicSignalEvent(params: {
    emailId: number
    mailAccountId: number
    provider: string
    message: ProviderMessage
    normalizedBody: string
  }): Promise<void> {
    const amazonEmitted = await this.emitAmazonReturnEvent(params)
    if (amazonEmitted) {
      return
    }
    await this.emitManulifeClaimEvent(params)
  }

  private async emitAmazonReturnEvent(params: {
    emailId: number
    mailAccountId: number
    provider: string
    message: ProviderMessage
    normalizedBody: string
  }): Promise<boolean> {
    const parsed = parseAmazonReturnEmail({
      provider: params.provider,
      fromAddress: params.message.fromAddress,
      subject: params.message.subject ?? undefined,
      receivedAt: params.message.receivedAt,
      normalizedBody: params.normalizedBody,
    })

    if (!parsed) {
      await this.recordAmazonReturnNearMiss({
        emailId: params.emailId,
        provider: params.provider,
        message: params.message,
        normalizedBody: params.normalizedBody,
      })
      return false
    }

    await this.db.amazonReturnNearMiss
      .delete({ where: { emailId: params.emailId } })
      .catch(() => undefined)

    const returnRef = extractAmazonReturnReference(params.normalizedBody)
    const amountTotal =
      parsed.eventType === AMAZON_EVENT_TYPES.RETURN_REQUESTED
        ? parsed.amountTotal
        : parsed.eventType === AMAZON_EVENT_TYPES.REFUND_ISSUED
        ? parsed.refundAmount
        : parsed.estimatedRefund
    const deadlineDate =
      parsed.eventType === AMAZON_EVENT_TYPES.RETURN_REQUESTED ? parsed.dropOffBy : undefined

    const payload = this.buildCommonSignalPayload({
      provider: params.provider,
      mailAccountId: params.mailAccountId,
      sourceEmailId: params.emailId,
      message: params.message,
      confidence: 1,
      base: {
        order_id: parsed.orderId,
        return_id: returnRef.returnId ?? null,
        return_code: returnRef.returnCode ?? null,
        amount_total: amountTotal,
        currency: "CAD",
        deadline_date: deadlineDate ?? null,
        label_link_present: detectAmazonLabelLink(params.normalizedBody),
        status_text: summarizeAmazonStatusText(parsed.eventType, params.message.subject),
        item_title: parsed.itemTitle,
      },
    })

    if (parsed.eventType === AMAZON_EVENT_TYPES.RETURN_REQUESTED) {
      payload.amount_total = parsed.amountTotal
      payload.amount = parsed.amountTotal
      payload.drop_off_by = parsed.dropOffBy
      if (parsed.paymentMethodLast4) {
        payload.payment_method_last4 = parsed.paymentMethodLast4
      }
    } else if (parsed.eventType === AMAZON_EVENT_TYPES.REFUND_ISSUED) {
      payload.refund_amount = parsed.refundAmount
    } else if (parsed.eventType === AMAZON_EVENT_TYPES.RETURN_DROPPED_OFF) {
      payload.estimated_refund = parsed.estimatedRefund
      if (parsed.refundBy) {
        payload.refund_by = parsed.refundBy
      }
    }

    const dedupeKey = buildSignalEventDedupeKey({
      provider: params.provider,
      mailAccountId: params.mailAccountId,
      eventType: parsed.eventType,
      primaryRef: parsed.orderId,
      primaryAmount: amountTotal,
      primaryDate: deadlineDate ?? params.message.receivedAt.toISOString().slice(0, 10),
    })

    await this.createOutboxEvent({
      dedupeKey,
      eventType: parsed.eventType,
      payload,
      sourceEmailId: params.emailId,
      confidence: 1,
    })
    return true
  }

  private async emitManulifeClaimEvent(params: {
    emailId: number
    mailAccountId: number
    provider: string
    message: ProviderMessage
    normalizedBody: string
  }): Promise<boolean> {
    const parsed = parseManulifeClaimEmail({
      provider: params.provider,
      fromAddress: params.message.fromAddress,
      subject: params.message.subject ?? undefined,
      receivedAt: params.message.receivedAt,
      normalizedBody: params.normalizedBody,
    })

    if (!parsed) {
      await this.recordManulifeClaimNearMiss({
        emailId: params.emailId,
        provider: params.provider,
        message: params.message,
        normalizedBody: params.normalizedBody,
      })
      return false
    }

    await this.db.manulifeClaimNearMiss
      .delete({ where: { emailId: params.emailId } })
      .catch(() => undefined)

    const payload = this.buildCommonSignalPayload({
      provider: params.provider,
      mailAccountId: params.mailAccountId,
      sourceEmailId: params.emailId,
      message: params.message,
      confidence: parsed.claimId ? 0.99 : 0.9,
      base: {
        insurer: "Manulife",
        claim_id: parsed.claimId ?? null,
        status_text: parsed.statusText,
        amounts: {
          amount_claimed: parsed.amounts.amountClaimed ?? null,
          amount_eligible: parsed.amounts.amountEligible ?? null,
          amount_paid: parsed.amounts.amountPaid ?? null,
        },
        dates: {
          processed_at: parsed.dates.processedAt ?? null,
          paid_at: parsed.dates.paidAt ?? null,
        },
      },
    })

    const fallbackNearMiss = detectManulifeClaimNearMiss({
      provider: params.provider,
      fromAddress: params.message.fromAddress,
      subject: params.message.subject ?? undefined,
      receivedAt: params.message.receivedAt,
      normalizedBody: params.normalizedBody,
    })
    if (
      parsed.eventType === MANULIFE_EVENT_TYPES.CLAIM_STATUS_UPDATE &&
      !parsed.claimId &&
      fallbackNearMiss
    ) {
      await this.db.manulifeClaimNearMiss.upsert({
        where: { emailId: params.emailId },
        update: {
          claimId: null,
          statusText: fallbackNearMiss.statusText ?? parsed.statusText,
          parseReason: fallbackNearMiss.parseReason,
          extractedCandidates: {
            claim_candidates: fallbackNearMiss.claimCandidates,
            amounts: fallbackNearMiss.amounts ?? null,
          } as any,
          aiSuggestionJson: Prisma.JsonNull,
          snippet: params.normalizedBody.slice(0, 1200),
          createdAt: new Date(),
        },
        create: {
          emailId: params.emailId,
          provider: params.provider,
          fromAddress: params.message.fromAddress,
          subject: params.message.subject ?? null,
          receivedAt: params.message.receivedAt,
          claimId: null,
          statusText: fallbackNearMiss.statusText ?? parsed.statusText,
          parseReason: fallbackNearMiss.parseReason,
          extractedCandidates: {
            claim_candidates: fallbackNearMiss.claimCandidates,
            amounts: fallbackNearMiss.amounts ?? null,
          } as any,
          aiSuggestionJson: Prisma.JsonNull,
          snippet: params.normalizedBody.slice(0, 1200),
          createdAt: new Date(),
        },
      })
    }

    const primaryRef =
      parsed.claimId ??
      `${params.provider}:${params.mailAccountId}:${params.message.messageId}`
    const primaryAmount =
      parsed.amounts.amountPaid ??
      parsed.amounts.amountEligible ??
      parsed.amounts.amountClaimed
    const primaryDate =
      parsed.dates.paidAt ??
      parsed.dates.processedAt ??
      params.message.receivedAt.toISOString().slice(0, 10)
    const dedupeKey = buildSignalEventDedupeKey({
      provider: params.provider,
      mailAccountId: params.mailAccountId,
      eventType: parsed.eventType,
      primaryRef,
      primaryAmount,
      primaryDate,
    })

    await this.createOutboxEvent({
      dedupeKey,
      eventType: parsed.eventType,
      payload,
      sourceEmailId: params.emailId,
      confidence: parsed.claimId ? 0.99 : 0.9,
    })
    return true
  }

  private async recordAmazonReturnNearMiss(params: {
    emailId: number
    provider: string
    message: ProviderMessage
    normalizedBody: string
  }): Promise<void> {
    const nearMiss = detectAmazonReturnNearMiss({
      provider: params.provider,
      fromAddress: params.message.fromAddress,
      subject: params.message.subject ?? undefined,
      receivedAt: params.message.receivedAt,
      normalizedBody: params.normalizedBody,
    })

    if (!nearMiss) {
      return
    }

    let aiSuggestion: Prisma.InputJsonValue | undefined
    if (amazonAiEnabled()) {
      try {
        const result = await classifyAmazonEmailWithAi({
          subject: params.message.subject ?? undefined,
          normalizedBody: params.normalizedBody,
        })
        if (result) {
          aiSuggestion = result as unknown as Prisma.InputJsonValue
        }
      } catch (err) {
        this.logger.warn("amazon_return_ai_failed", {
          email_id: params.emailId,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }

    const snippet = params.normalizedBody.slice(0, 1200)

    await this.db.amazonReturnNearMiss.upsert({
      where: { emailId: params.emailId },
      update: {
        orderId: nearMiss.orderId ?? null,
        expectedEventType: nearMiss.expectedEventType ?? null,
        missingFields: nearMiss.missingFields ?? undefined,
        reason: nearMiss.reason,
        snippet,
        aiSuggestion,
        createdAt: new Date(),
      },
      create: {
        emailId: params.emailId,
        provider: params.provider,
        fromAddress: params.message.fromAddress,
        subject: params.message.subject ?? null,
        receivedAt: params.message.receivedAt,
        orderId: nearMiss.orderId ?? null,
        expectedEventType: nearMiss.expectedEventType ?? null,
        missingFields: nearMiss.missingFields ?? undefined,
        reason: nearMiss.reason,
        snippet,
        aiSuggestion,
        createdAt: new Date(),
      },
    })

    this.logger.warn("amazon_return_near_miss", {
      email_id: params.emailId,
      provider: params.provider,
      order_id: nearMiss.orderId,
      reason: nearMiss.reason,
      expected_event_type: nearMiss.expectedEventType,
      missing_fields: nearMiss.missingFields,
    })
  }

  private async recordManulifeClaimNearMiss(params: {
    emailId: number
    provider: string
    message: ProviderMessage
    normalizedBody: string
  }): Promise<void> {
    if (!isStrongManulifeSender(params.message.fromAddress)) {
      return
    }

    const nearMiss = detectManulifeClaimNearMiss({
      provider: params.provider,
      fromAddress: params.message.fromAddress,
      subject: params.message.subject ?? undefined,
      receivedAt: params.message.receivedAt,
      normalizedBody: params.normalizedBody,
    })
    if (!nearMiss) {
      return
    }

    await this.db.manulifeClaimNearMiss.upsert({
      where: { emailId: params.emailId },
      update: {
        claimId: nearMiss.claimCandidates.length === 1 ? nearMiss.claimCandidates[0] : null,
        statusText: nearMiss.statusText ?? null,
        parseReason: nearMiss.parseReason,
        extractedCandidates: {
          claim_candidates: nearMiss.claimCandidates,
          amounts: nearMiss.amounts ?? null,
        } as any,
        aiSuggestionJson: Prisma.JsonNull,
        snippet: params.normalizedBody.slice(0, 1200),
        createdAt: new Date(),
      },
      create: {
        emailId: params.emailId,
        provider: params.provider,
        fromAddress: params.message.fromAddress,
        subject: params.message.subject ?? null,
        receivedAt: params.message.receivedAt,
        claimId: nearMiss.claimCandidates.length === 1 ? nearMiss.claimCandidates[0] : null,
        statusText: nearMiss.statusText ?? null,
        parseReason: nearMiss.parseReason,
        extractedCandidates: {
          claim_candidates: nearMiss.claimCandidates,
          amounts: nearMiss.amounts ?? null,
        } as any,
        aiSuggestionJson: Prisma.JsonNull,
        snippet: params.normalizedBody.slice(0, 1200),
        createdAt: new Date(),
      },
    })

    this.logger.warn("manulife_claim_near_miss", {
      email_id: params.emailId,
      parse_reason: nearMiss.parseReason,
      claim_candidates: nearMiss.claimCandidates,
      status_text: nearMiss.statusText,
    })
  }

  private buildCommonSignalPayload(params: {
    provider: string
    mailAccountId: number
    sourceEmailId: number
    message: ProviderMessage
    confidence: number
    base: Record<string, unknown>
  }): Record<string, unknown> {
    return {
      provider: params.provider,
      mail_account_id: params.mailAccountId,
      received_at: params.message.receivedAt.toISOString(),
      from_address: params.message.fromAddress,
      subject: params.message.subject ?? null,
      provider_message_id: params.message.messageId,
      thread_id: params.message.threadId ?? null,
      source_email_id: params.sourceEmailId,
      confidence: params.confidence,
      email: {
        email_id: params.sourceEmailId,
        mail_account_id: params.mailAccountId,
        message_id: params.message.messageId,
        from: params.message.fromAddress,
        subject: params.message.subject,
        received_at: params.message.receivedAt.toISOString(),
      },
      ...params.base,
    }
  }

  private async createOutboxEvent(params: {
    dedupeKey: string
    eventType: string
    payload: Record<string, unknown>
    sourceEmailId: number
    confidence: number
  }): Promise<void> {
    await this.db.eventsOutbox.upsert({
      where: { dedupeKey: params.dedupeKey },
      update: {},
      create: {
        dedupeKey: params.dedupeKey,
        eventType: params.eventType,
        payloadJson: params.payload as any,
        sourceEmailId: params.sourceEmailId,
        confidence: params.confidence,
        status: "pending",
        createdAt: new Date(),
      },
    })
  }
}

type EmitEventParams = {
  emailId: number
  monitorId: string
  monitorName: string
  confidenceThreshold: number
  allowedEventTypes: string[]
  aiResult: {
    event_type: string
    confidence: number
  } & Record<string, unknown>
  aiRunId: number
  message: ProviderMessage
}

function computeDedupeKey(emailId: number, monitorId: string, eventType: string): string {
  return crypto
    .createHash("md5")
    .update(`${emailId}:${monitorId}:${eventType}`)
    .digest("hex")
}

function extractAmazonReturnReference(normalizedBody: string): {
  returnId?: string
  returnCode?: string
} {
  const returnId =
    normalizedBody.match(
      /\breturn(?:\s*(?:id|number|authorization))\s*[:#-]?\s*([A-Z0-9-]{6,})/i
    )?.[1] ?? undefined
  const returnCode =
    normalizedBody.match(
      /\b(?:drop[-\s]*off|return)\s*(?:code|qr code)\s*[:#-]?\s*([A-Z0-9-]{4,})/i
    )?.[1] ?? undefined
  return { returnId, returnCode }
}

function detectAmazonLabelLink(normalizedBody: string): boolean {
  return /\b(return label|print label|qr code|drop[-\s]*off code|label)\b/i.test(
    normalizedBody
  )
}

function summarizeAmazonStatusText(eventType: string, subject?: string | null): string {
  if (subject && subject.trim().length > 0) {
    return subject.trim()
  }
  if (eventType === AMAZON_EVENT_TYPES.RETURN_REQUESTED) {
    return "return request confirmed"
  }
  if (eventType === AMAZON_EVENT_TYPES.RETURN_DROPPED_OFF) {
    return "return dropped off"
  }
  if (eventType === AMAZON_EVENT_TYPES.REFUND_ISSUED) {
    return "refund issued"
  }
  return "status update"
}
