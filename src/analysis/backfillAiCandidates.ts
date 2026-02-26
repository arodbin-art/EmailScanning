import "dotenv/config"
import { prisma } from "../db/prisma.js"
import { createObjectStorage, resolveStorageProvider } from "../storage/index.js"
import { IGPTProvider } from "../intelligence/igptProvider.js"
import { IntelligenceEmailInput } from "../intelligence/types.js"
import {
  persistAiCandidateSignals,
  safeAnalyzeSignals,
} from "../intelligence/shadowRuntime.js"
import { consoleLogger } from "../ingestion/logger.js"

const DEFAULT_SINCE_DAYS = 14
const DEFAULT_LIMIT = 200
const DEFAULT_OBJECT_TIMEOUT_MS = 20000

type BackfillOptions = {
  sinceDays: number
  limit: number
  provider?: string
  mailAccountId?: number
  dryRun: boolean
  force: boolean
  objectTimeoutMs: number
  amazonManulifeOnly: boolean
}

type EmailRow = {
  id: number
  provider: string
  mailAccountId: number
  fromAddress: string
  subject: string | null
  receivedAt: Date
  messageId: string
  bodyObjectKey: string
}

function parseArgs(): BackfillOptions {
  const args = process.argv.slice(2)
  const options: BackfillOptions = {
    sinceDays: DEFAULT_SINCE_DAYS,
    limit: DEFAULT_LIMIT,
    dryRun: false,
    force: false,
    objectTimeoutMs: DEFAULT_OBJECT_TIMEOUT_MS,
    amazonManulifeOnly: false,
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === "--since-days") {
      const parsed = Number(args[i + 1] ?? "")
      if (Number.isFinite(parsed) && parsed > 0) {
        options.sinceDays = Math.floor(parsed)
      }
      i += 1
      continue
    }
    if (arg === "--limit") {
      const parsed = Number(args[i + 1] ?? "")
      if (Number.isFinite(parsed) && parsed > 0) {
        options.limit = Math.floor(parsed)
      }
      i += 1
      continue
    }
    if (arg === "--provider") {
      const value = (args[i + 1] ?? "").trim()
      if (value) {
        options.provider = value
      }
      i += 1
      continue
    }
    if (arg === "--mail-account-id") {
      const parsed = Number(args[i + 1] ?? "")
      if (Number.isFinite(parsed) && parsed > 0) {
        options.mailAccountId = Math.floor(parsed)
      }
      i += 1
      continue
    }
    if (arg === "--dry-run") {
      options.dryRun = true
      continue
    }
    if (arg === "--force") {
      options.force = true
      continue
    }
    if (arg === "--object-timeout-ms") {
      const parsed = Number(args[i + 1] ?? "")
      if (Number.isFinite(parsed) && parsed >= 1000) {
        options.objectTimeoutMs = Math.floor(parsed)
      }
      i += 1
      continue
    }
    if (arg === "--amazon-manulife-only") {
      options.amazonManulifeOnly = true
      continue
    }
  }

  return options
}

async function main(): Promise<void> {
  const options = parseArgs()
  const since = new Date(Date.now() - options.sinceDays * 24 * 60 * 60 * 1000)
  const storage = createObjectStorage({ provider: resolveStorageProvider() })
  const provider = new IGPTProvider()

  const emails = (await prisma.emailRaw.findMany({
    where: {
      receivedAt: { gte: since },
      ...(options.provider ? { provider: options.provider } : {}),
      ...(options.mailAccountId ? { mailAccountId: options.mailAccountId } : {}),
      ...(options.amazonManulifeOnly
        ? {
            OR: [
              { fromAddress: { contains: "amazon", mode: "insensitive" } },
              { fromAddress: { contains: "manulife", mode: "insensitive" } },
              { subject: { contains: "amazon", mode: "insensitive" } },
              { subject: { contains: "manulife", mode: "insensitive" } },
            ],
          }
        : {}),
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
      bodyObjectKey: true,
    },
  })) as EmailRow[]

  const existingSet = await loadExistingEmailIds(emails, options.force)

  let skippedAlreadyProcessed = 0
  let processed = 0
  let failed = 0
  let candidateSignals = 0
  let persistedSignals = 0

  for (const email of emails) {
    const emailId = String(email.id)
    if (existingSet.has(emailId)) {
      skippedAlreadyProcessed += 1
      continue
    }

    try {
      const normalizedKey = `${email.bodyObjectKey}normalized_text.txt`
      const normalized = await withTimeout(
        storage.getObject(normalizedKey),
        options.objectTimeoutMs,
        `object_read_timeout:${normalizedKey}`
      )
      const normalizedText = normalized.body.toString("utf8")

      const input: IntelligenceEmailInput = {
        emailId,
        subject: email.subject ?? "",
        normalizedText,
        receivedAt: email.receivedAt,
        provider: email.provider,
        mailAccountId: email.mailAccountId,
        fromAddress: email.fromAddress,
      }

      const signals = await safeAnalyzeSignals({
        provider,
        email: input,
        providerName: "igpt_backfill",
        logger: consoleLogger,
      })
      candidateSignals += signals.length
      processed += 1

      if (options.dryRun) {
        console.log("intelligence_backfill_dry_run", {
          email_id: email.id,
          provider: email.provider,
          received_at: email.receivedAt.toISOString(),
          candidate_count: signals.length,
        })
        continue
      }

      await persistAiCandidateSignals({
        writer: prisma.aiCandidateEvent,
        email: input,
        signals,
      })
      persistedSignals += signals.length
    } catch (error) {
      failed += 1
      console.warn("intelligence_backfill_email_failed", {
        email_id: email.id,
        provider: email.provider,
        message_id: email.messageId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  console.log("intelligence_backfill_summary", {
    since_days: options.sinceDays,
    limit: options.limit,
    provider: options.provider ?? "all",
    mail_account_id: options.mailAccountId ?? null,
    dry_run: options.dryRun,
    force: options.force,
    object_timeout_ms: options.objectTimeoutMs,
    amazon_manulife_only: options.amazonManulifeOnly,
    scanned: emails.length,
    skipped_already_processed: skippedAlreadyProcessed,
    processed,
    failed,
    candidate_signals: candidateSignals,
    persisted_signals: persistedSignals,
  })
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timer: NodeJS.Timeout | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

async function loadExistingEmailIds(
  emails: EmailRow[],
  force: boolean
): Promise<Set<string>> {
  if (force || emails.length === 0) {
    return new Set<string>()
  }

  const emailIds = emails.map((email) => String(email.id))
  const existingRows = await prisma.aiCandidateEvent.findMany({
    where: { emailId: { in: emailIds } },
    select: { emailId: true },
  })
  return new Set(existingRows.map((row) => row.emailId))
}

main()
  .catch((error) => {
    console.error("intelligence_backfill_failed", error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
