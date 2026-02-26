import "dotenv/config"
import { Prisma } from "@prisma/client"
import { prisma } from "../db/prisma.js"

type ComparisonRow = {
  email_id: string
  event_type: string
  primary_ref: string | null
}

type EmailSet = {
  deterministic: Set<string>
  ai: Set<string>
}

async function main(): Promise<void> {
  const sinceDays = parseSinceDays(process.argv.slice(2))
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000)

  const deterministicRows = await prisma.$queryRaw<ComparisonRow[]>(Prisma.sql`
    SELECT
      eo.source_email_id::text AS email_id,
      eo.event_type,
      COALESCE(
        eo.payload_json->>'order_id',
        eo.payload_json->>'claim_id',
        eo.payload_json->>'return_id',
        eo.payload_json->>'return_code',
        eo.payload_json #>> '{amazon,order_id}',
        eo.payload_json #>> '{manulife,claim_id}'
      ) AS primary_ref
    FROM email_scanning.events_outbox eo
    JOIN email_scanning.emails_raw er ON er.id = eo.source_email_id
    WHERE er.received_at >= ${since}
  `)

  const aiRows = await prisma.$queryRaw<ComparisonRow[]>(Prisma.sql`
    SELECT
      ace.email_id,
      ace.event_type,
      ace.primary_ref
    FROM email_scanning.ai_candidate_events ace
    WHERE ace.created_at >= ${since}
  `)

  const perEmail = new Map<string, EmailSet>()
  for (const row of deterministicRows) {
    const bucket = getOrCreateBucket(perEmail, row.email_id)
    bucket.deterministic.add(eventKey(row.event_type, row.primary_ref))
  }
  for (const row of aiRows) {
    const bucket = getOrCreateBucket(perEmail, row.email_id)
    bucket.ai.add(eventKey(row.event_type, row.primary_ref))
  }

  let deterministicOnly = 0
  let aiOnly = 0
  let matchCount = 0
  let mismatchCount = 0

  for (const bucket of perEmail.values()) {
    const hasDeterministic = bucket.deterministic.size > 0
    const hasAi = bucket.ai.size > 0

    if (hasDeterministic && !hasAi) {
      deterministicOnly += 1
      continue
    }

    if (!hasDeterministic && hasAi) {
      aiOnly += 1
      continue
    }

    if (!hasDeterministic && !hasAi) {
      continue
    }

    if (setsEqual(bucket.deterministic, bucket.ai)) {
      matchCount += 1
    } else {
      mismatchCount += 1
    }
  }

  const summary = {
    since_days: sinceDays,
    since_iso: since.toISOString(),
    total_emails: perEmail.size,
    deterministic_only: deterministicOnly,
    ai_only: aiOnly,
    match_count: matchCount,
    mismatch_count: mismatchCount,
    deterministic_event_rows: deterministicRows.length,
    ai_event_rows: aiRows.length,
  }

  console.log(JSON.stringify(summary, null, 2))
}

function parseSinceDays(args: string[]): number {
  const index = args.indexOf("--since-days")
  if (index === -1) {
    return 14
  }
  const value = Number(args[index + 1] ?? "")
  if (!Number.isFinite(value) || value <= 0) {
    return 14
  }
  return Math.floor(value)
}

function getOrCreateBucket(map: Map<string, EmailSet>, emailId: string): EmailSet {
  const existing = map.get(emailId)
  if (existing) {
    return existing
  }
  const created: EmailSet = {
    deterministic: new Set<string>(),
    ai: new Set<string>(),
  }
  map.set(emailId, created)
  return created
}

function eventKey(eventType: string, primaryRef: string | null): string {
  return `${eventType}::${(primaryRef ?? "").trim().toLowerCase()}`
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) {
    return false
  }
  for (const item of a) {
    if (!b.has(item)) {
      return false
    }
  }
  return true
}

main()
  .catch((error) => {
    console.error("compare_intelligence_failed", error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
