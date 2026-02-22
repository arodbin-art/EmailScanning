import { MANULIFE_EVENT_TYPES } from "../events/signalEvents.js"

export type ManulifeClaimEmailInput = {
  provider: string
  fromAddress: string
  subject?: string
  receivedAt?: Date
  normalizedBody: string
}

export type ManulifeClaimEventType =
  (typeof MANULIFE_EVENT_TYPES)[keyof typeof MANULIFE_EVENT_TYPES]

export type ManulifeClaimParseResult = {
  eventType: ManulifeClaimEventType
  claimId?: string
  statusText: string
  amounts: {
    amountClaimed?: number
    amountEligible?: number
    amountPaid?: number
  }
  dates: {
    processedAt?: string
    paidAt?: string
  }
}

export type ManulifeClaimNearMissInfo = {
  parseReason:
    | "not_manulife_sender"
    | "missing_claim_id"
    | "ambiguous_claim_id"
    | "no_claim_signal"
  claimCandidates: string[]
  statusText?: string
  amounts?: {
    amount_claimed?: number
    amount_eligible?: number
    amount_paid?: number
  }
}

const MANULIFE_SENDER_HINT = /manulife/i
const CLAIM_ID_PATTERNS: RegExp[] = [
  /claim(?:\s*(?:number|no\.?|#))?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{5,})/gi,
  /reference(?:\s*(?:number|no\.?|#))?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{5,})/gi,
]

const STATUS_PATTERNS: Array<{ type: ManulifeClaimEventType; pattern: RegExp }> = [
  {
    type: MANULIFE_EVENT_TYPES.CLAIM_DENIED,
    pattern: /\b(denied|declined|not covered|not eligible|rejected)\b/i,
  },
  {
    type: MANULIFE_EVENT_TYPES.CLAIM_INFO_REQUIRED,
    pattern:
      /\b(info(?:rmation)? required|missing information|action required|additional information|documents required|please provide)\b/i,
  },
  {
    type: MANULIFE_EVENT_TYPES.CLAIM_PAID,
    pattern: /\b(paid|payment (?:issued|sent|deposited)|deposited|reimbursed)\b/i,
  },
  {
    type: MANULIFE_EVENT_TYPES.CLAIM_PROCESSED,
    pattern: /\b(processed|assessment completed|adjudicated|completed processing)\b/i,
  },
  {
    type: MANULIFE_EVENT_TYPES.CLAIM_RECEIVED,
    pattern:
      /\b(claim received|received your claim|claim submitted|claim has been received|submission confirmed)\b/i,
  },
]

const CLAIM_SIGNAL_PATTERN =
  /\b(claim|reference|assessment|reimbursement|benefit)\b/i

const AMOUNT_PATTERNS = {
  amountClaimed: [
    /(?:amount\s*claimed|claim(?:ed)?\s*amount|submitted\s*amount)\s*[:\-]?\s*(?:CAD|C\$|\$)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i,
  ],
  amountEligible: [
    /(?:eligible\s*amount|approved\s*amount|covered\s*amount|assessment\s*amount)\s*[:\-]?\s*(?:CAD|C\$|\$)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i,
  ],
  amountPaid: [
    /(?:amount\s*paid|payment\s*amount|deposit(?:ed)?\s*amount|reimbursement\s*amount)\s*[:\-]?\s*(?:CAD|C\$|\$)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i,
  ],
}

const GENERIC_CURRENCY_PATTERN =
  /(?:CAD|C\$|\$)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/gi

const PROCESSED_DATE_PATTERN =
  /(?:processed(?:\s*on|\s*date)?|assessment completed(?:\s*on)?)\s*[:\-]?\s*([A-Za-z]{3,9}\.?\s+\d{1,2}(?:,\s*\d{4})?|\d{4}-\d{2}-\d{2})/i
const PAID_DATE_PATTERN =
  /(?:paid(?:\s*on|\s*date)?|payment date|deposited(?:\s*on)?|issued(?:\s*on)?)\s*[:\-]?\s*([A-Za-z]{3,9}\.?\s+\d{1,2}(?:,\s*\d{4})?|\d{4}-\d{2}-\d{2})/i

export function parseManulifeClaimEmail(
  input: ManulifeClaimEmailInput
): ManulifeClaimParseResult | null {
  if (!isStrongManulifeSender(input.fromAddress)) {
    return null
  }

  const text = normalizeContent(input.normalizedBody)
  const subject = input.subject ?? ""
  const combined = `${subject}\n${text}`

  if (!CLAIM_SIGNAL_PATTERN.test(combined)) {
    return null
  }

  const candidates = extractClaimCandidates(combined)
  const claimId = candidates.length === 1 ? candidates[0] : undefined
  const classification = classifyStatus(combined)
  const statusText = classification.statusText

  const amountClaimed = extractLabeledAmount(combined, AMOUNT_PATTERNS.amountClaimed)
  const amountEligible = extractLabeledAmount(combined, AMOUNT_PATTERNS.amountEligible)
  let amountPaid = extractLabeledAmount(combined, AMOUNT_PATTERNS.amountPaid)

  if (classification.eventType === MANULIFE_EVENT_TYPES.CLAIM_PAID && amountPaid === undefined) {
    amountPaid = extractGenericAmount(combined)
  }

  const processedAt = extractDateIso(PROCESSED_DATE_PATTERN, combined, input.receivedAt)
  const paidAt = extractDateIso(PAID_DATE_PATTERN, combined, input.receivedAt)

  if (!claimId) {
    return {
      eventType: MANULIFE_EVENT_TYPES.CLAIM_STATUS_UPDATE,
      statusText,
      amounts: {
        amountClaimed,
        amountEligible,
        amountPaid,
      },
      dates: {
        processedAt: processedAt ?? undefined,
        paidAt: paidAt ?? undefined,
      },
    }
  }

  return {
    eventType: classification.eventType,
    claimId,
    statusText,
    amounts: {
      amountClaimed,
      amountEligible,
      amountPaid,
    },
    dates: {
      processedAt: processedAt ?? undefined,
      paidAt: paidAt ?? undefined,
    },
  }
}

export function detectManulifeClaimNearMiss(
  input: ManulifeClaimEmailInput
): ManulifeClaimNearMissInfo | null {
  if (!isStrongManulifeSender(input.fromAddress)) {
    return null
  }

  const text = normalizeContent(input.normalizedBody)
  const subject = input.subject ?? ""
  const combined = `${subject}\n${text}`

  if (!CLAIM_SIGNAL_PATTERN.test(combined)) {
    return {
      parseReason: "no_claim_signal",
      claimCandidates: [],
    }
  }

  const candidates = extractClaimCandidates(combined)
  const classification = classifyStatus(combined)

  if (candidates.length === 1) {
    return null
  }

  const amounts = {
    amount_claimed: extractLabeledAmount(combined, AMOUNT_PATTERNS.amountClaimed),
    amount_eligible: extractLabeledAmount(combined, AMOUNT_PATTERNS.amountEligible),
    amount_paid: extractLabeledAmount(combined, AMOUNT_PATTERNS.amountPaid) ?? extractGenericAmount(combined),
  }

  if (candidates.length === 0) {
    return {
      parseReason: "missing_claim_id",
      claimCandidates: [],
      statusText: classification.statusText,
      amounts,
    }
  }

  return {
    parseReason: "ambiguous_claim_id",
    claimCandidates: candidates,
    statusText: classification.statusText,
    amounts,
  }
}

export function isStrongManulifeSender(fromAddress: string): boolean {
  return MANULIFE_SENDER_HINT.test(fromAddress)
}

function normalizeContent(content: string): string {
  const withoutScripts = content.replace(/<script[\s\S]*?<\/script>/gi, " ")
  const withoutStyles = withoutScripts.replace(/<style[\s\S]*?<\/style>/gi, " ")
  const withoutTags = withoutStyles.replace(/<[^>]+>/g, " ")
  return withoutTags
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function extractClaimCandidates(text: string): string[] {
  const values: string[] = []
  for (const pattern of CLAIM_ID_PATTERNS) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      const candidate = sanitizeClaimId(match[1] ?? "")
      if (candidate) {
        values.push(candidate)
      }
    }
  }
  return Array.from(new Set(values))
}

function sanitizeClaimId(value: string): string | null {
  const trimmed = value.trim().replace(/[^\w-]/g, "")
  if (!trimmed || trimmed.length < 6 || !/\d/.test(trimmed)) {
    return null
  }
  return trimmed.toUpperCase()
}

function classifyStatus(text: string): { eventType: ManulifeClaimEventType; statusText: string } {
  for (const entry of STATUS_PATTERNS) {
    const match = text.match(entry.pattern)
    if (match) {
      return {
        eventType: entry.type,
        statusText: match[1] ?? match[0],
      }
    }
  }
  return {
    eventType: MANULIFE_EVENT_TYPES.CLAIM_STATUS_UPDATE,
    statusText: "status update",
  }
}

function extractLabeledAmount(text: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    const value = parseAmount(match?.[1])
    if (value !== undefined) return value
  }
  return undefined
}

function extractGenericAmount(text: string): number | undefined {
  const candidates: number[] = []
  GENERIC_CURRENCY_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = GENERIC_CURRENCY_PATTERN.exec(text)) !== null) {
    const value = parseAmount(match[1])
    if (value !== undefined) {
      candidates.push(value)
    }
  }
  return candidates.length > 0 ? candidates[candidates.length - 1] : undefined
}

function parseAmount(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value.replace(/,/g, ""))
  if (!Number.isFinite(parsed)) return undefined
  return Number(parsed.toFixed(2))
}

function extractDateIso(pattern: RegExp, text: string, receivedAt?: Date): string | null {
  const match = text.match(pattern)
  if (!match?.[1]) return null
  return parseFlexibleDate(match[1], receivedAt)
}

function parseFlexibleDate(input: string, receivedAt?: Date): string | null {
  const trimmed = input.trim().replace(/\.$/, "")
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed
  }

  const monthMatch = trimmed.match(
    /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,\s*(\d{4}))?$/
  )
  if (!monthMatch) return null

  const month = monthIndex(monthMatch[1])
  if (month === null) return null
  const day = Number(monthMatch[2])
  if (!Number.isInteger(day) || day < 1 || day > 31) return null

  const inferredYear =
    monthMatch[3] !== undefined
      ? Number(monthMatch[3])
      : inferYear(month, day, receivedAt)
  if (!Number.isInteger(inferredYear)) return null

  const iso = new Date(Date.UTC(inferredYear, month, day))
  if (
    iso.getUTCFullYear() !== inferredYear ||
    iso.getUTCMonth() !== month ||
    iso.getUTCDate() !== day
  ) {
    return null
  }
  return iso.toISOString().slice(0, 10)
}

function monthIndex(monthText: string): number | null {
  const key = monthText.toLowerCase().slice(0, 3)
  const map: Record<string, number> = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  }
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null
}

function inferYear(month: number, day: number, receivedAt?: Date): number {
  if (!receivedAt) return new Date().getUTCFullYear()
  const receivedYear = receivedAt.getUTCFullYear()
  const receivedMonth = receivedAt.getUTCMonth()
  if (receivedMonth === 11 && month === 0 && day <= 7) {
    return receivedYear + 1
  }
  if (receivedMonth === 0 && month === 11 && day >= 24) {
    return receivedYear - 1
  }
  return receivedYear
}
