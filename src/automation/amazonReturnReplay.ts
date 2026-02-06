import "dotenv/config"
import { prisma } from "../db/prisma.js"
import { createObjectStorage, resolveStorageProvider } from "../storage/index.js"
import {
  AmazonReturnParseResult,
  buildAmazonReturnDedupeKey,
  parseAmazonReturnEmail,
} from "./amazonReturnParser.js"

const DEFAULT_SINCE_DAYS = 14
const DEFAULT_LIMIT = 50
const DEFAULT_PROVIDER = "gmail"
const DEFAULT_FROM = "return@amazon.ca"

type ReplayOptions = {
  sinceDays: number
  limit: number
  provider: string
  fromAddress?: string
  emit: boolean
}

type EmailRow = {
  id: number
  provider: string
  fromAddress: string
  subject: string | null
  receivedAt: Date
  messageId: string
  bodyObjectKey: string
}

function parseArgs(): ReplayOptions {
  const args = process.argv.slice(2)
  const options: ReplayOptions = {
    sinceDays: DEFAULT_SINCE_DAYS,
    limit: DEFAULT_LIMIT,
    provider: DEFAULT_PROVIDER,
    fromAddress: DEFAULT_FROM,
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
      if (Number.isFinite(value)) {
        options.sinceDays = value
      }
      i += 1
      continue
    }
    if (arg === "--limit") {
      const value = Number(args[i + 1])
      if (Number.isFinite(value)) {
        options.limit = value
      }
      i += 1
      continue
    }
    if (arg === "--provider") {
      options.provider = args[i + 1] ?? options.provider
      i += 1
      continue
    }
    if (arg === "--from-address") {
      options.fromAddress = args[i + 1] ?? options.fromAddress
      i += 1
      continue
    }
    if (arg === "--no-from-filter") {
      options.fromAddress = undefined
      continue
    }
  }

  return options
}

function buildPayload(email: EmailRow, parsed: AmazonReturnParseResult): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    order_id: parsed.orderId,
    item_title: parsed.itemTitle,
    email: {
      email_id: email.id,
      message_id: email.messageId,
      from: email.fromAddress,
      subject: email.subject,
      received_at: email.receivedAt.toISOString(),
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

  return payload
}

async function main(): Promise<void> {
  const options = parseArgs()
  const since = new Date(Date.now() - options.sinceDays * 24 * 60 * 60 * 1000)

  const storage = createObjectStorage({ provider: resolveStorageProvider() })

  const emails = await prisma.emailRaw.findMany({
    where: {
      provider: options.provider,
      receivedAt: { gte: since },
      ...(options.fromAddress
        ? { fromAddress: { contains: options.fromAddress, mode: "insensitive" } }
        : {}),
    },
    orderBy: { receivedAt: "desc" },
    take: options.limit,
    select: {
      id: true,
      provider: true,
      fromAddress: true,
      subject: true,
      receivedAt: true,
      messageId: true,
      bodyObjectKey: true,
    },
  })

  let parsedCount = 0
  let emittedCount = 0
  let skippedCount = 0

  for (const email of emails) {
    try {
      const normalizedKey = `${email.bodyObjectKey}normalized_text.txt`
      const object = await storage.getObject(normalizedKey)
      const normalizedBody = object.body.toString("utf8")

      const parsed = parseAmazonReturnEmail({
        provider: email.provider,
        fromAddress: email.fromAddress,
        subject: email.subject ?? undefined,
        receivedAt: email.receivedAt,
        normalizedBody,
      })

      if (!parsed) {
        skippedCount += 1
        continue
      }

      parsedCount += 1

      if (!options.emit) {
        console.log("dry-run", {
          email_id: email.id,
          event_type: parsed.eventType,
          order_id: parsed.orderId,
          item_title: parsed.itemTitle,
        })
        continue
      }

      const dedupeKey = buildAmazonReturnDedupeKey(
        email.provider,
        parsed.orderId,
        parsed.eventType
      )

      await prisma.eventsOutbox.upsert({
        where: { dedupeKey },
        update: {},
        create: {
          dedupeKey,
          eventType: parsed.eventType,
          payloadJson: buildPayload(email, parsed) as any,
          sourceEmailId: email.id,
          confidence: 1.0,
          status: "pending",
          createdAt: new Date(),
        },
      })

      emittedCount += 1
    } catch (err) {
      console.warn("replay_failed", {
        email_id: email.id,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  console.log("amazon_return_replay_summary", {
    scanned: emails.length,
    parsed: parsedCount,
    emitted: emittedCount,
    skipped: skippedCount,
    dry_run: !options.emit,
  })
}

main()
  .catch((err) => {
    console.error("amazon_return_replay_failed", err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
