import crypto from "crypto"

export type AmazonReturnEmailInput = {
  provider: string
  fromAddress: string
  subject?: string
  receivedAt?: Date
  normalizedBody: string
}

export type AmazonReturnRequested = {
  eventType: "amazon.return_requested"
  orderId: string
  amount: number
  dropOffBy: string
  itemTitle: string
}

export type AmazonRefundIssued = {
  eventType: "amazon.refund_issued"
  orderId: string
  refundAmount: number
  itemTitle: string
}

export type AmazonReturnDroppedOff = {
  eventType: "amazon.return_dropped_off"
  orderId: string
  estimatedRefund: number
  refundBy?: string
  itemTitle: string
}

export type AmazonReturnParseResult =
  | AmazonReturnRequested
  | AmazonRefundIssued
  | AmazonReturnDroppedOff

export type AmazonReturnNearMissInfo = {
  orderId?: string
  expectedEventType?: AmazonReturnParseResult["eventType"]
  missingFields?: string[]
  reason: "missing_fields" | "missing_order_id" | "unknown_template"
}

const AMAZON_FROM = /\breturn@amazon\.ca\b/i
const ORDER_ID_PATTERN = /\b\d{3}-\d{7}-\d{7}\b/
const RETURN_REQUEST_SUBJECT = /your return request is confirmed/i
const REFUND_ISSUED_SUBJECT = /your refund (was issued|is on the way)/i
const RETURN_DROPOFF_SUBJECT = /your return drop-off confirmation/i
const ITEM_COUNT_PATTERN = /^item(?:\s+to\s+be\s+returned|\s+returned)?\s*:\s*\d+/i

const AMOUNT_PATTERN = /(?:CAD|CDN)\s*\$?\s*(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})|\$\s*(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})/i
const DROP_OFF_BY_PATTERN = /drop\s*off\s*by/i

const ITEM_LABEL_PATTERN = /\bitem(?:\s+title)?\b\s*[:\-]/i
const ITEM_SECTION_HEADERS = new Set(["item", "item title", "item(s)", "item details"])
const SUBJECT_ITEM_PREFIXES = [
  /^your refund for\s+/i,
  /^your return of\s+/i,
  /^your return drop-off confirmation for\s+/i,
]
const REFUND_BY_PATTERN = /refund will be issued by\s*(.+)$/i

export function parseAmazonReturnEmail(input: AmazonReturnEmailInput): AmazonReturnParseResult | null {
  if (!isAmazonReturnSender(input.provider, input.fromAddress)) {
    return null
  }

  const text = normalizeContent(input.normalizedBody)
  const subject = input.subject ?? ""
  const combined = `${subject}\n${text}`

  const orderId = extractOrderId(combined)
  if (!orderId) {
    return null
  }

  if (RETURN_REQUEST_SUBJECT.test(subject) || RETURN_REQUEST_SUBJECT.test(text)) {
    const amount = extractAmountByLabels(text, ["refund amount", "estimated refund", "refund total"]) ??
      extractAnyAmount(text)
    const dropOffBy = extractDropOffBy(text, input.receivedAt)
    const itemTitle = extractItemTitle(text, subject)

    if (!amount || !dropOffBy || !itemTitle) {
      return null
    }

    return {
      eventType: "amazon.return_requested",
      orderId,
      amount,
      dropOffBy,
      itemTitle,
    }
  }

  if (REFUND_ISSUED_SUBJECT.test(subject) || REFUND_ISSUED_SUBJECT.test(text)) {
    const refundAmount = extractAmountByLabels(text, ["refund amount", "refund total", "total refund", "refunded"]) ??
      extractAnyAmount(text)
    const itemTitle = extractItemTitle(text, subject)

    if (!refundAmount || !itemTitle) {
      return null
    }

    return {
      eventType: "amazon.refund_issued",
      orderId,
      refundAmount,
      itemTitle,
    }
  }

  if (RETURN_DROPOFF_SUBJECT.test(subject) || RETURN_DROPOFF_SUBJECT.test(text)) {
    const estimatedRefund =
      extractAmountByLabels(text, ["total estimated refund", "refund subtotal", "estimated refund"]) ??
      extractAnyAmount(text)
    const itemTitle = extractItemTitle(text, subject)
    const refundBy = extractRefundBy(text, input.receivedAt)

    if (!estimatedRefund || !itemTitle) {
      return null
    }

    return {
      eventType: "amazon.return_dropped_off",
      orderId,
      estimatedRefund,
      refundBy: refundBy ?? undefined,
      itemTitle,
    }
  }

  return null
}

export function detectAmazonReturnNearMiss(
  input: AmazonReturnEmailInput
): AmazonReturnNearMissInfo | null {
  if (!isAmazonReturnSender(input.provider, input.fromAddress)) {
    return null
  }

  const text = normalizeContent(input.normalizedBody)
  const subject = input.subject ?? ""
  const combined = `${subject}\n${text}`
  const orderId = extractOrderId(combined) ?? undefined

  const matchesReturnRequest = RETURN_REQUEST_SUBJECT.test(subject) || RETURN_REQUEST_SUBJECT.test(text)
  const matchesRefundIssued = REFUND_ISSUED_SUBJECT.test(subject) || REFUND_ISSUED_SUBJECT.test(text)
  const matchesDropOff = RETURN_DROPOFF_SUBJECT.test(subject) || RETURN_DROPOFF_SUBJECT.test(text)

  if (!matchesReturnRequest && !matchesRefundIssued && !matchesDropOff) {
    if (!orderId) {
      return {
        reason: "unknown_template",
      }
    }
    return {
      reason: "unknown_template",
      orderId,
    }
  }

  if (!orderId) {
    return {
      reason: "missing_order_id",
      expectedEventType: matchesReturnRequest
        ? "amazon.return_requested"
        : matchesRefundIssued
        ? "amazon.refund_issued"
        : "amazon.return_dropped_off",
      missingFields: ["order_id"],
    }
  }

  if (matchesReturnRequest) {
    const missing: string[] = []
    const amount =
      extractAmountByLabels(text, ["refund amount", "estimated refund", "refund total"]) ??
      extractAnyAmount(text)
    const dropOffBy = extractDropOffBy(text, input.receivedAt)
    const itemTitle = extractItemTitle(text, subject)

    if (!amount) missing.push("amount")
    if (!dropOffBy) missing.push("drop_off_by")
    if (!itemTitle) missing.push("item_title")

    if (missing.length === 0) {
      return null
    }
    return {
      reason: "missing_fields",
      orderId,
      expectedEventType: "amazon.return_requested",
      missingFields: missing,
    }
  }

  if (matchesRefundIssued) {
    const missing: string[] = []
    const refundAmount =
      extractAmountByLabels(text, ["refund amount", "refund total", "total refund", "refunded"]) ??
      extractAnyAmount(text)
    const itemTitle = extractItemTitle(text, subject)
    if (!refundAmount) missing.push("refund_amount")
    if (!itemTitle) missing.push("item_title")
    if (missing.length === 0) {
      return null
    }
    return {
      reason: "missing_fields",
      orderId,
      expectedEventType: "amazon.refund_issued",
      missingFields: missing,
    }
  }

  if (matchesDropOff) {
    const missing: string[] = []
    const estimatedRefund =
      extractAmountByLabels(text, ["total estimated refund", "refund subtotal", "estimated refund"]) ??
      extractAnyAmount(text)
    const itemTitle = extractItemTitle(text, subject)
    if (!estimatedRefund) missing.push("estimated_refund")
    if (!itemTitle) missing.push("item_title")
    if (missing.length === 0) {
      return null
    }
    return {
      reason: "missing_fields",
      orderId,
      expectedEventType: "amazon.return_dropped_off",
      missingFields: missing,
    }
  }

  return null
}

export function buildAmazonReturnDedupeKey(provider: string, orderId: string, eventType: string): string {
  return crypto.createHash("md5").update(`${provider}:${orderId}:${eventType}`).digest("hex")
}

function isAmazonReturnSender(provider: string, fromAddress: string): boolean {
  return provider.toLowerCase() === "gmail" && AMAZON_FROM.test(fromAddress)
}

function normalizeContent(content: string): string {
  const withoutScripts = content.replace(/<script[\s\S]*?<\/script>/gi, " ")
  const withoutStyles = withoutScripts.replace(/<style[\s\S]*?<\/style>/gi, " ")
  const withoutTags = withoutStyles.replace(/<[^>]+>/g, " ")
  const decoded = withoutTags
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
  return decoded.replace(/\r/g, "")
}

function extractOrderId(text: string): string | null {
  const match = text.match(ORDER_ID_PATTERN)
  return match ? match[0] : null
}

function extractAmountByLabels(text: string, labels: string[]): number | null {
  const lines = toLines(text)
  for (const line of lines) {
    const lower = line.toLowerCase()
    if (labels.some((label) => lower.includes(label))) {
      const amount = extractAmountFromLine(line)
      if (amount) {
        return amount
      }
    }
  }
  return null
}

function extractAnyAmount(text: string): number | null {
  const lines = toLines(text)
  for (const line of lines) {
    const amount = extractAmountFromLine(line)
    if (amount) {
      return amount
    }
  }
  const compact = text.replace(/\s+/g, " ")
  return extractAmountFromLine(compact)
}

function extractAmountFromLine(line: string): number | null {
  const match = line.match(AMOUNT_PATTERN)
  if (!match) {
    return null
  }
  const left = match[1]
  const right = match[2]
  const dollar = match[3]
  const cents = match[4]
  const whole = left ?? dollar
  const fraction = right ?? cents
  if (!whole || !fraction) {
    return null
  }
  const normalized = `${whole.replace(/,/g, "")}.${fraction}`
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

function extractDropOffBy(text: string, receivedAt?: Date): string | null {
  const lines = toLines(text)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!DROP_OFF_BY_PATTERN.test(line)) {
      continue
    }
    const inline = line.split(/drop\s*off\s*by\s*[:\-]*/i)[1]?.trim()
    if (inline) {
      const parsedInline = parseAmazonDate(inline, receivedAt)
      if (parsedInline) {
        return parsedInline
      }
    }
    const next = findNextMeaningfulLine(lines, i + 1)
    if (next) {
      const parsedNext = parseAmazonDate(next, receivedAt)
      if (parsedNext) {
        return parsedNext
      }
    }
  }
  return null
}

function parseAmazonDate(value: string, referenceDate?: Date): string | null {
  const cleaned = value.replace(/\s+/g, " ").trim().replace(/[.]+$/, "")
  const match = cleaned.match(/^(?:[A-Za-z]{3,9}\.?,?\s+)?(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:,\s*(\d{4}))?$/i)
  if (!match) {
    return null
  }
  const monthName = match[1].toLowerCase()
  const day = Number(match[2])
  const year = match[3] ? Number(match[3]) : (referenceDate?.getUTCFullYear() ?? new Date().getUTCFullYear())
  const month = monthNameToNumber(monthName)
  if (!month || !Number.isFinite(day) || !Number.isFinite(year)) {
    return null
  }
  const mm = String(month).padStart(2, "0")
  const dd = String(day).padStart(2, "0")
  return `${year}-${mm}-${dd}`
}

function monthNameToNumber(monthName: string): number | null {
  const map: Record<string, number> = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  }
  return map[monthName] ?? null
}

function extractItemTitle(text: string, subject?: string): string | null {
  const subjectTitle = subject ? extractItemTitleFromSubject(subject) : null
  if (subjectTitle) {
    return subjectTitle
  }

  const lines = toLines(text)
  for (const line of lines) {
    if (ITEM_LABEL_PATTERN.test(line)) {
      const candidate = line.replace(ITEM_LABEL_PATTERN, "").trim()
      const title = extractTitleFromLine(candidate)
      if (title) {
        return title
      }
    }
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (ITEM_COUNT_PATTERN.test(line)) {
      const next = findNextMeaningfulLine(lines, i + 1)
      if (next) {
        const title = extractTitleFromLine(next)
        if (title) {
          return title
        }
      }
    }
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].toLowerCase()
    if (ITEM_SECTION_HEADERS.has(line)) {
      const next = findNextMeaningfulLine(lines, i + 1)
      if (next) {
        const title = extractTitleFromLine(next)
        if (title) {
          return title
        }
      }
    }
  }

  return null
}

function extractRefundBy(text: string, receivedAt?: Date): string | null {
  const lines = toLines(text)
  for (const line of lines) {
    const match = line.match(REFUND_BY_PATTERN)
    if (match?.[1]) {
      const parsed = parseAmazonDate(match[1], receivedAt)
      if (parsed) {
        return parsed
      }
    }
  }
  return null
}

function extractItemTitleFromSubject(subject: string): string | null {
  const trimmed = subject.trim()
  for (const prefix of SUBJECT_ITEM_PREFIXES) {
    if (prefix.test(trimmed)) {
      const raw = trimmed.replace(prefix, "").trim()
      const cleaned = raw.replace(/\.*$/, "").trim()
      if (isMeaningfulTitle(cleaned)) {
        return cleaned
      }
    }
  }
  return null
}

function extractTitleFromLine(line: string): string | null {
  if (!line) {
    return null
  }
  const markdown = line.match(/^\[([^\]]{3,200})\]\((https?:\/\/[^)]+)\)$/)
  if (markdown) {
    const title = markdown[1].trim()
    return isMeaningfulTitle(title) ? title : null
  }
  const inline = line.match(/\[([^\]]{3,200})\]\((https?:\/\/[^)]+)\)/)
  if (inline) {
    const title = inline[1].trim()
    return isMeaningfulTitle(title) ? title : null
  }
  const cleaned = line.replace(/^[-:]+/, "").trim()
  return isMeaningfulTitle(cleaned) ? cleaned : null
}

function isMeaningfulTitle(value: string): boolean {
  if (!value) {
    return false
  }
  if (value.length < 3 || value.length > 200) {
    return false
  }
  if (ORDER_ID_PATTERN.test(value)) {
    return false
  }
  if (/^order id/i.test(value)) {
    return false
  }
  return true
}

function toLines(text: string): string[] {
  return text
    .split(/\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
}

function findNextMeaningfulLine(lines: string[], start: number): string | null {
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (!line) {
      continue
    }
    if (isLinkOnly(line)) {
      continue
    }
    return line
  }
  return null
}

function isLinkOnly(line: string): boolean {
  return /^https?:\/\/\S+$/i.test(line) || /^\(https?:\/\/\S+\)$/i.test(line)
}
