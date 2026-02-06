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
  buildAmazonReturnDedupeKey,
  detectAmazonReturnNearMiss,
  parseAmazonReturnEmail,
} from "../automation/amazonReturnParser.js"
import { amazonAiEnabled, classifyAmazonEmailWithAi } from "../automation/amazonReturnAi.js"

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

    await this.emitAmazonReturnEvent({
      emailId: createdEmail.id,
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

  private async emitAmazonReturnEvent(params: {
    emailId: number
    provider: string
    message: ProviderMessage
    normalizedBody: string
  }): Promise<void> {
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
      return
    }

    await this.db.amazonReturnNearMiss
      .delete({ where: { emailId: params.emailId } })
      .catch(() => undefined)

    const dedupeKey = buildAmazonReturnDedupeKey(
      params.provider,
      parsed.orderId,
      parsed.eventType
    )

    const payload: Record<string, unknown> = {
      order_id: parsed.orderId,
      item_title: parsed.itemTitle,
      email: {
        email_id: params.emailId,
        message_id: params.message.messageId,
        from: params.message.fromAddress,
        subject: params.message.subject,
        received_at: params.message.receivedAt.toISOString(),
      },
    }

    if (parsed.eventType === "amazon.return_requested") {
      payload.amount = parsed.amount
      payload.drop_off_by = parsed.dropOffBy
    } else if (parsed.eventType === "amazon.refund_issued") {
      payload.refund_amount = parsed.refundAmount
    } else if (parsed.eventType === "amazon.return_dropped_off") {
      payload.estimated_refund = parsed.estimatedRefund
      if (parsed.refundBy) {
        payload.refund_by = parsed.refundBy
      }
    }

    await this.db.eventsOutbox.upsert({
      where: { dedupeKey },
      update: {},
      create: {
        dedupeKey,
        eventType: parsed.eventType,
        payloadJson: payload as any,
        sourceEmailId: params.emailId,
        confidence: 1.0,
        status: "pending",
        createdAt: new Date(),
      },
    })
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
}

function summarizeAttachments(message: ProviderMessage): string {
  if (!message.attachments || message.attachments.length === 0) {
    return "None"
  }
  return message.attachments
    .map((attachment) => {
      const size = attachment.size ? ` (${attachment.size} bytes)` : ""
      const type = attachment.contentType ? ` [${attachment.contentType}]` : ""
      return `${attachment.name}${type}${size}`
    })
    .join(", ")
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
