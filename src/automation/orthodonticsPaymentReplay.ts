import "dotenv/config"
import { prisma } from "../db/prisma.js"
import { createObjectStorage, resolveStorageProvider } from "../storage/index.js"
import { buildSignalEventDedupeKey, ORTHODONTICS_EVENT_TYPES } from "../events/signalEvents.js"
import {
  extractOrthodonticsAttachmentRefs,
  parseOrthodonticsPaymentEmail,
} from "./orthodonticsPaymentParser.js"
import { parseOrthodonticsAppointmentEmail } from "./orthodonticsAppointmentParser.js"

const DEFAULT_SINCE_DAYS = 120
const DEFAULT_LIMIT = 500
const DEFAULT_PROVIDER = "gmail"
const DEFAULT_FROM = "elavon.com"

type ReplayOptions = {
  sinceDays: number
  limit: number
  provider: string
  fromContains?: string
  emit: boolean
}

type EmailRow = {
  id: number
  provider: string
  mailAccountId: number
  mailAccount: {
    moneyRecoveryPersonCode: string | null
  }
  fromAddress: string
  subject: string | null
  receivedAt: Date
  messageId: string
  threadId: string | null
  bodyObjectKey: string
  attachmentMetadata: unknown
}

function parseArgs(): ReplayOptions {
  const args = process.argv.slice(2)
  const options: ReplayOptions = {
    sinceDays: DEFAULT_SINCE_DAYS,
    limit: DEFAULT_LIMIT,
    provider: DEFAULT_PROVIDER,
    fromContains: DEFAULT_FROM,
    emit: false,
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === "--emit") {
      options.emit = true
      continue
    }
    if (arg === "--since-days") {
      const value = Number(args[i + 1])
      if (Number.isFinite(value)) options.sinceDays = value
      i += 1
      continue
    }
    if (arg === "--limit") {
      const value = Number(args[i + 1])
      if (Number.isFinite(value)) options.limit = value
      i += 1
      continue
    }
    if (arg === "--provider") {
      options.provider = args[i + 1] ?? options.provider
      i += 1
      continue
    }
    if (arg === "--from-contains") {
      options.fromContains = args[i + 1] ?? options.fromContains
      i += 1
      continue
    }
    if (arg === "--no-from-filter") {
      options.fromContains = undefined
      continue
    }
  }

  return options
}

function buildPaymentPayload(email: EmailRow, parsed: NonNullable<ReturnType<typeof parseOrthodonticsPaymentEmail>>) {
  const personCodeHint =
    typeof email.mailAccount.moneyRecoveryPersonCode === "string" &&
    email.mailAccount.moneyRecoveryPersonCode.trim().length > 0
      ? email.mailAccount.moneyRecoveryPersonCode.trim().toUpperCase()
      : "CHA"
  const attachments = extractOrthodonticsAttachmentRefs(email.attachmentMetadata)

  return {
    provider: email.provider,
    mail_account_id: email.mailAccountId,
    received_at: email.receivedAt.toISOString(),
    from_address: email.fromAddress,
    subject: email.subject ?? null,
    provider_message_id: email.messageId,
    thread_id: email.threadId,
    source_email_id: email.id,
    confidence: 0.98,
    merchant: parsed.merchant,
    provider_name: parsed.merchant,
    person_code_hint: personCodeHint,
    amount_total: parsed.amount,
    currency: parsed.currency,
    transaction_id: parsed.transactionId ?? null,
    payment_reference: parsed.paymentReference ?? null,
    status_text: parsed.statusText,
    attachments,
    orthodontics: {
      provider: parsed.merchant,
      amount_total: parsed.amount,
      currency: parsed.currency,
      transaction_id: parsed.transactionId ?? null,
      payment_reference: parsed.paymentReference ?? null,
      status_text: parsed.statusText,
      attachments,
    },
    email: {
      email_id: email.id,
      mail_account_id: email.mailAccountId,
      message_id: email.messageId,
      from: email.fromAddress,
      subject: email.subject ?? null,
      received_at: email.receivedAt.toISOString(),
    },
  }
}

function buildAppointmentPayload(
  email: EmailRow,
  parsed: NonNullable<ReturnType<typeof parseOrthodonticsAppointmentEmail>>
) {
  return {
    provider: email.provider,
    mail_account_id: email.mailAccountId,
    received_at: email.receivedAt.toISOString(),
    from_address: email.fromAddress,
    subject: email.subject ?? null,
    provider_message_id: email.messageId,
    thread_id: email.threadId,
    source_email_id: email.id,
    confidence: 0.95,
    merchant: "Durham Orthodontics",
    provider_name: "Durham Orthodontics",
    person_code_hint:
      typeof email.mailAccount.moneyRecoveryPersonCode === "string" &&
      email.mailAccount.moneyRecoveryPersonCode.trim().length > 0
        ? email.mailAccount.moneyRecoveryPersonCode.trim().toUpperCase()
        : "CHA",
    status_text: parsed.statusText,
    reminder_window: parsed.reminderWindow ?? null,
    orthodontics: {
      clinic: parsed.clinic,
      status_text: parsed.statusText,
      reminder_window: parsed.reminderWindow ?? null,
    },
    email: {
      email_id: email.id,
      mail_account_id: email.mailAccountId,
      message_id: email.messageId,
      from: email.fromAddress,
      subject: email.subject ?? null,
      received_at: email.receivedAt.toISOString(),
    },
  }
}

async function main(): Promise<void> {
  const options = parseArgs()
  const since = new Date(Date.now() - options.sinceDays * 24 * 60 * 60 * 1000)
  const storage = createObjectStorage({ provider: resolveStorageProvider() })

  const emails = await prisma.emailRaw.findMany({
    where: {
      provider: options.provider,
      receivedAt: { gte: since },
      ...(options.fromContains
        ? { fromAddress: { contains: options.fromContains, mode: "insensitive" } }
        : {}),
    },
    orderBy: { receivedAt: "desc" },
    take: options.limit,
    select: {
      id: true,
      provider: true,
      mailAccountId: true,
      mailAccount: {
        select: {
          moneyRecoveryPersonCode: true,
        },
      },
      fromAddress: true,
      subject: true,
      receivedAt: true,
      messageId: true,
      threadId: true,
      bodyObjectKey: true,
      attachmentMetadata: true,
    },
  })

  let parsedCount = 0
  let emittedCount = 0

  for (const email of emails as EmailRow[]) {
    const normalized = await storage.getObject(`${email.bodyObjectKey}normalized_text.txt`)
    const normalizedBody = normalized.body.toString("utf8")
    const payment = parseOrthodonticsPaymentEmail({
      provider: email.provider,
      fromAddress: email.fromAddress,
      subject: email.subject ?? undefined,
      receivedAt: email.receivedAt,
      normalizedBody,
    })
    const appointment = payment
      ? null
      : parseOrthodonticsAppointmentEmail({
          provider: email.provider,
          fromAddress: email.fromAddress,
          subject: email.subject ?? undefined,
          receivedAt: email.receivedAt,
          normalizedBody,
        })

    if (!payment && !appointment) {
      continue
    }

    parsedCount += 1
    if (!options.emit) {
      console.log("dry-run", {
        email_id: email.id,
        event_type: payment?.eventType ?? appointment?.eventType,
        amount: payment?.amount ?? null,
        transaction_id: payment?.transactionId ?? null,
        reminder_window: appointment?.reminderWindow ?? null,
      })
      continue
    }

    if (payment) {
      const fallbackRef = `${(email.subject ?? "").trim().toLowerCase()}|${payment.amount ?? ""}|${email.receivedAt
        .toISOString()
        .slice(0, 10)}`
      const primaryRef = payment.transactionId ?? fallbackRef
      const dedupeKey = buildSignalEventDedupeKey({
        provider: email.provider,
        mailAccountId: email.mailAccountId,
        eventType: ORTHODONTICS_EVENT_TYPES.PAYMENT_APPROVED,
        primaryRef,
        primaryAmount: payment.amount,
        primaryDate: email.receivedAt.toISOString().slice(0, 10),
      })

      await prisma.eventsOutbox.upsert({
        where: { dedupeKey },
        update: {},
        create: {
          dedupeKey,
          eventType: ORTHODONTICS_EVENT_TYPES.PAYMENT_APPROVED,
          payloadJson: buildPaymentPayload(email, payment) as any,
          sourceEmailId: email.id,
          confidence: 0.98,
          status: "pending",
          createdAt: new Date(),
        },
      })
    } else if (appointment) {
      const dedupeKey = buildSignalEventDedupeKey({
        provider: email.provider,
        mailAccountId: email.mailAccountId,
        eventType: appointment.eventType,
        primaryRef: email.messageId,
        primaryDate: email.receivedAt.toISOString().slice(0, 10),
      })
      await prisma.eventsOutbox.upsert({
        where: { dedupeKey },
        update: {},
        create: {
          dedupeKey,
          eventType: appointment.eventType,
          payloadJson: buildAppointmentPayload(email, appointment) as any,
          sourceEmailId: email.id,
          confidence: 0.95,
          status: "pending",
          createdAt: new Date(),
        },
      })
    }
    emittedCount += 1
  }

  console.log("orthodontics_payment_replay_summary", {
    scanned: emails.length,
    parsed: parsedCount,
    emitted: emittedCount,
    dry_run: !options.emit,
  })
}

main()
  .catch((error) => {
    console.error("orthodontics_payment_replay_failed", error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
