import "dotenv/config"
import crypto from "crypto"
import { prisma } from "../db/prisma.js"
import { createObjectStorage, resolveStorageProvider } from "../storage/index.js"
import { EnvGraphTokenProvider } from "../config/graphTokenProvider.js"
import { MicrosoftGraphEmailProvider } from "./microsoftGraphProvider.js"
import { EmailIngestionService } from "./emailIngestionService.js"
import { consoleLogger } from "./logger.js"
import { StaticAssignmentStrategy } from "../assignment/staticAssignmentStrategy.js"
import { createAiClient } from "../ai/clientFactory.js"
import { EmailProvider } from "./types.js"
import { EncryptedFileGmailTokenStore } from "../auth/gmailTokenStore.js"
import { GmailClient } from "../providers/gmail/gmailClient.js"
import { GmailEmailProvider } from "../providers/gmail/gmailEmailProvider.js"

function generatePollCycleId(): string {
  return crypto.randomUUID()
}

export type PollOptions = {
  providerFilter?: string
  limit?: number
}

export async function runPoll(options: PollOptions = {}): Promise<void> {
  const pollCycleId = generatePollCycleId()
  const storage = createObjectStorage({ provider: resolveStorageProvider() })
  const graphTokenProvider = new EnvGraphTokenProvider()
  const providerResolver = createProviderResolver(graphTokenProvider)
  const aiClient = await createAiClient()
  const ingestion = new EmailIngestionService({
    db: prisma,
    storage,
    providerResolver,
    logger: consoleLogger,
    aiClient,
    options: {
      maxMessagesPerPoll: options.limit ?? 50,
    },
  })

  const assignment = StaticAssignmentStrategy.parseFromEnv()
  await assignment.validateAssignedAccounts()
  let accountIds = await assignment.resolveAssignedAccounts({ pollCycleId })
  if (options.providerFilter) {
    const provider = options.providerFilter.toLowerCase()
    const rows = await prisma.mailAccount.findMany({
      where: { id: { in: accountIds }, provider },
      select: { id: true },
    })
    accountIds = rows.map((row) => row.id)
  }

  let totalNew = 0
  let totalExisting = 0
  let totalErrors = 0
  const startedAt = Date.now()

  for (const accountId of accountIds) {
    try {
      const stats = await ingestion.ingestAccount(accountId, { pollCycleId })
      totalNew += stats.newEmails
      totalExisting += stats.existingEmails
      totalErrors += stats.errors
    } catch (error) {
      totalErrors += 1
      consoleLogger.error("account ingestion failed", {
        mail_account_id: accountId,
        provider: "unknown",
        poll_cycle_id: pollCycleId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const durationMs = Date.now() - startedAt
  consoleLogger.info("poll summary", {
    poll_cycle_id: pollCycleId,
    account_count: accountIds.length,
    new_emails: totalNew,
    existing_emails: totalExisting,
    errors: totalErrors,
    duration_ms: durationMs,
  })

  await runRetentionCheck()
}

function createProviderResolver(graphTokenProvider: EnvGraphTokenProvider) {
  const cache = new Map<string, EmailProvider>()
  const factories = new Map<string, () => EmailProvider>([
    ["microsoft", () => new MicrosoftGraphEmailProvider(graphTokenProvider)],
    ["gmail", () => new GmailEmailProvider(createGmailClient())],
  ])

  return (name: string): EmailProvider | null => {
    const key = name.toLowerCase()
    const factory = factories.get(key)
    if (!factory) {
      return null
    }
    if (!cache.has(key)) {
      cache.set(key, factory())
    }
    return cache.get(key) ?? null
  }
}

function createGmailClient(): GmailClient {
  const clientId = requireEnv("GOOGLE_CLIENT_ID")
  const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET")
  const redirectUri = requireEnv("GOOGLE_REDIRECT_URI")
  const tokenStore = new EncryptedFileGmailTokenStore()
  return new GmailClient({ clientId, clientSecret, redirectUri, tokenStore })
}

function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`${key} is required for Gmail provider`)
  }
  return value
}

async function runRetentionCheck(): Promise<void> {
  const retentionDays = Number(process.env.RETENTION_DAYS ?? "")
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    return
  }

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
  const oldEmails = await prisma.emailRaw.count({
    where: { receivedAt: { lt: cutoff } },
  })

  consoleLogger.info("retention_check", {
    retention_days: retentionDays,
    email_rows_older_than_cutoff: oldEmails,
    cutoff_iso: cutoff.toISOString(),
  })
}
