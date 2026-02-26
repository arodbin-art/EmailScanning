import { Prisma } from "@prisma/client"
import { Logger } from "../ingestion/types.js"
import { EmailIntelligenceProvider, IntelligenceEmailInput, StructuredSignal } from "./types.js"

export async function safeAnalyzeSignals(params: {
  provider: EmailIntelligenceProvider
  email: IntelligenceEmailInput
  providerName: string
  logger?: Logger
}): Promise<StructuredSignal[]> {
  try {
    return await params.provider.analyzeEmail(params.email)
  } catch (error) {
    params.logger?.warn("intelligence_provider_failed", {
      stage: "igpt_shadow",
      provider: params.providerName,
      emailId: params.email.emailId,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

export async function persistAiCandidateSignals(params: {
  writer: { createMany: (...args: any[]) => Promise<unknown> }
  email: IntelligenceEmailInput
  signals: StructuredSignal[]
}): Promise<void> {
  if (params.signals.length === 0) {
    return
  }

  const rows = params.signals.map((signal) => {
    const amount =
      typeof signal.amount === "number" && Number.isFinite(signal.amount)
        ? new Prisma.Decimal(signal.amount.toFixed(2))
        : null

    const occurredAt = parseIsoDateOrNull(signal.occurredAt)
    const confidence =
      typeof signal.confidence === "number" && Number.isFinite(signal.confidence)
        ? signal.confidence
        : null

    return {
      emailId: params.email.emailId,
      provider: params.email.provider,
      eventType: signal.eventType,
      primaryRef: signal.primaryRef ?? null,
      amount,
      occurredAt,
      payloadJson: sanitizeJson(signal.payload),
      confidence,
    }
  })

  await params.writer.createMany({ data: rows })
}

function parseIsoDateOrNull(value: string | undefined): Date | null {
  if (!value) {
    return null
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }
  return parsed
}

function sanitizeJson(value: unknown): Prisma.InputJsonValue {
  if (value === undefined) {
    return {}
  }
  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
  } catch {
    return {
      raw: String(value),
    } as Prisma.InputJsonValue
  }
}
