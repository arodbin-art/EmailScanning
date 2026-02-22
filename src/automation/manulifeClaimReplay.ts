import "dotenv/config"
import { prisma } from "../db/prisma.js"
import { createObjectStorage, resolveStorageProvider } from "../storage/index.js"
import { parseManulifeClaimEmail } from "./manulifeClaimParser.js"
import { buildSignalEventDedupeKey } from "../events/signalEvents.js"

const DEFAULT_SINCE_DAYS = 30
const DEFAULT_LIMIT = 100

type ReplayOptions = {
  sinceDays: number
  limit: number
  provider: string
  fromContains: string
  emit: boolean
}

type EmailRow = {
  id: number
  provider: string
  mailAccountId: number
  fromAddress: string
  subject: string | null
  receivedAt: Date
  messageId: string
  threadId: string | null
  bodyObjectKey: string
}

function parseArgs(): ReplayOptions {
  const args = process.argv.slice(2)
  const options: ReplayOptions = {
    sinceDays: DEFAULT_SINCE_DAYS,
    limit: DEFAULT_LIMIT,
    provider: "gmail",
    fromContains: "manulife",
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
    }
  }

  return options
}

function buildPayload(email: EmailRow, parsed: ReturnType<typeof parseManulifeClaimEmail>) {
  return {
    provider: email.provider,
    mail_account_id: email.mailAccountId,
    received_at: email.receivedAt.toISOString(),
    from_address: email.fromAddress,
    subject: email.subject ?? null,
    provider_message_id: email.messageId,
    thread_id: email.threadId,
    source_email_id: email.id,
    confidence: parsed?.claimId ? 0.99 : 0.9,
    insurer: "Manulife",
    claim_id: parsed?.claimId ?? null,
    status_text: parsed?.statusText ?? "status update",
    amounts: {
      amount_claimed: parsed?.amounts.amountClaimed ?? null,
      amount_eligible: parsed?.amounts.amountEligible ?? null,
      amount_paid: parsed?.amounts.amountPaid ?? null,
    },
    dates: {
      processed_at: parsed?.dates.processedAt ?? null,
      paid_at: parsed?.dates.paidAt ?? null,
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

async function main() {
  const options = parseArgs()
  const since = new Date(Date.now() - options.sinceDays * 24 * 60 * 60 * 1000)
  const storage = createObjectStorage({ provider: resolveStorageProvider() })

  const emails = await prisma.emailRaw.findMany({
    where: {
      provider: options.provider,
      receivedAt: { gte: since },
      fromAddress: { contains: options.fromContains, mode: "insensitive" },
    },
    orderBy: { receivedAt: "desc" },
    take: options.limit,
    select: {
      id: true,
      provider: true,
      mailAccountId: true,
      fromAddress: true,
      subject: true,
      receivedAt: true,
      messageId: true,
      threadId: true,
      bodyObjectKey: true,
    },
  })

  let parsedCount = 0
  let emittedCount = 0

  for (const email of emails as EmailRow[]) {
    const normalized = await storage.getObject(`${email.bodyObjectKey}normalized_text.txt`)
    const normalizedBody = normalized.body.toString("utf8")
    const parsed = parseManulifeClaimEmail({
      provider: email.provider,
      fromAddress: email.fromAddress,
      subject: email.subject ?? undefined,
      receivedAt: email.receivedAt,
      normalizedBody,
    })
    if (!parsed) {
      continue
    }
    parsedCount += 1
    if (!options.emit) {
      console.log("dry-run", {
        email_id: email.id,
        event_type: parsed.eventType,
        claim_id: parsed.claimId ?? null,
        status_text: parsed.statusText,
      })
      continue
    }

    const primaryRef =
      parsed.claimId ?? `${email.provider}:${email.mailAccountId}:${email.messageId}`
    const primaryAmount =
      parsed.amounts.amountPaid ??
      parsed.amounts.amountEligible ??
      parsed.amounts.amountClaimed
    const primaryDate =
      parsed.dates.paidAt ??
      parsed.dates.processedAt ??
      email.receivedAt.toISOString().slice(0, 10)

    const dedupeKey = buildSignalEventDedupeKey({
      provider: email.provider,
      mailAccountId: email.mailAccountId,
      eventType: parsed.eventType,
      primaryRef,
      primaryAmount,
      primaryDate,
    })

    await prisma.eventsOutbox.upsert({
      where: { dedupeKey },
      update: {},
      create: {
        dedupeKey,
        eventType: parsed.eventType,
        payloadJson: buildPayload(email, parsed) as any,
        sourceEmailId: email.id,
        confidence: parsed.claimId ? 0.99 : 0.9,
        status: "pending",
        createdAt: new Date(),
      },
    })
    emittedCount += 1
  }

  console.log("manulife_claim_replay_summary", {
    scanned: emails.length,
    parsed: parsedCount,
    emitted: emittedCount,
    dry_run: !options.emit,
  })
}

main()
  .catch((error) => {
    console.error("manulife_claim_replay_failed", error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
