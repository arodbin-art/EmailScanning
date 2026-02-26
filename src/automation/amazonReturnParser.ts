export type AmazonReturnEmailInput = {
  provider: string
  fromAddress: string
  subject?: string
  receivedAt?: Date
  normalizedBody: string
}

export type AmazonReturnItem = {
  title: string
  qty?: number
}

export type AmazonReturnRequested = {
  eventType: "amazon.return_requested"
  orderId: string
  refundTotalEstimated: number
  dropOffBy: string | null
  returnMethodOrLocation?: string
  refundDestinationText?: string
  items: AmazonReturnItem[]
  statusText: string
  paymentMethodLast4?: string
}

export type AmazonRefundIssued = {
  eventType: "amazon.refund_issued"
  orderId: string
  refundAmountIssued: number
  refundDestinationText?: string
  items: AmazonReturnItem[]
  statusText: string
}

export type AmazonReturnDroppedOff = {
  eventType: "amazon.return_dropped_off"
  orderId: string
  refundTotalEstimated: number
  refundDestinationText?: string
  items: AmazonReturnItem[]
  statusText: string
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
const RETURN_REQUEST_PATTERN = /\byour return request is confirmed\b/i
const RETURN_DROPPED_OFF_PATTERN =
  /\b(your return was dropped off|your return is in transit|return drop[-\s]*off confirmation)\b/i
const REFUND_ISSUED_PATTERN =
  /\b(your refund has been issued|your refund was issued|refund issued|refund processed|refund completed|your refund is on the way)\b/i
const DROP_OFF_BY_PATTERN = /drop\s*off\s*by/i

const MONEY_PATTERN = /(?:CAD|CDN)?\s*\$+\s*(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})/i
const MONEY_CURRENCY_PATTERN = /(?:CAD|CDN)\s*(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})/i
const ITEM_LABEL_PATTERN = /\bitem(?:\s+title)?\b\s*[:\-]\s*(.+)$/i
const ITEM_SECTION_MARKERS = [
  /^item\(s\)\s+in\s+your\s+return\s+request\b/i,
  /^item(?:\s+returned|\s+to\s+be\s+returned)?\s*:\s*\d+\b/i,
  /^item\s+details\b/i,
  /^item\(s\)\b/i,
] as const
const ITEM_SECTION_STOP =
  /\b(return summary|refund summary|feedback|order summary|track your return|learn more|need help)\b/i
const SUBJECT_ITEM_PREFIXES = [
  /^your refund for\s+/i,
  /^your return of\s+/i,
  /^your return drop-off confirmation for\s+/i,
] as const
const REFUND_DESTINATION_PATTERNS = [
  /\b(?:will be|is|was)\s+refunded\s+to\s+(.+)$/i,
  /\brefund(?:ed)?\s+(?:to|on)\s+(.+)$/i,
  /\bto\s+(amazon account balance|[a-z ]+ ending in \d{4})\b/i,
] as const
const PAYMENT_LAST4_PATTERN = /(?:ending in|last\s*4|card)\s*[:#-]?\s*(\d{4})\b/i

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

  const classifier = classifyAmazonTemplate(subject, text)
  if (!classifier) {
    return null
  }

  const items = extractItems(text, subject)
  const refundDestinationText = extractRefundDestination(text) ?? undefined

  if (classifier === "amazon.return_requested") {
    const refundTotalEstimated =
      extractAmountByLabels(text, [
        "total estimated refund",
        "refund subtotal",
        "estimated refund",
        "refund total",
        "refund amount",
      ]) ?? extractAnyRefundAmount(text)
    if (refundTotalEstimated === null) {
      return null
    }

    return {
      eventType: "amazon.return_requested",
      orderId,
      refundTotalEstimated,
      dropOffBy: extractDropOffBy(text, input.receivedAt),
      returnMethodOrLocation: extractReturnMethodOrLocation(text) ?? undefined,
      refundDestinationText,
      items,
      statusText: "Your return request is confirmed",
      paymentMethodLast4: extractPaymentMethodLast4(text) ?? undefined,
    }
  }

  if (classifier === "amazon.refund_issued") {
    const refundAmountIssued =
      extractAmountByLabels(text, ["refund amount", "refund total", "total refund", "refund subtotal"]) ??
      extractAnyRefundAmount(text)
    if (refundAmountIssued === null) {
      return null
    }

    return {
      eventType: "amazon.refund_issued",
      orderId,
      refundAmountIssued,
      refundDestinationText,
      items,
      statusText: "Refund issued",
    }
  }

  const refundTotalEstimated =
    extractAmountByLabels(text, ["total estimated refund", "refund subtotal", "estimated refund", "refund total"]) ??
    extractAnyRefundAmount(text)
  if (refundTotalEstimated === null) {
    return null
  }

  return {
    eventType: "amazon.return_dropped_off",
    orderId,
    refundTotalEstimated,
    refundDestinationText,
    items,
    statusText: text.match(/\byour return is in transit\b/i)
      ? "Your return is in transit"
      : "Your return was dropped off",
  }
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
  const classifier = classifyAmazonTemplate(subject, text)

  if (!classifier) {
    return {
      reason: "unknown_template",
      orderId,
    }
  }

  if (!orderId) {
    return {
      reason: "missing_order_id",
      expectedEventType: classifier,
      missingFields: ["order_id"],
    }
  }

  if (classifier === "amazon.return_requested") {
    const amount =
      extractAmountByLabels(text, [
        "total estimated refund",
        "refund subtotal",
        "estimated refund",
        "refund total",
        "refund amount",
      ]) ?? extractAnyRefundAmount(text)
    if (amount !== null) {
      return null
    }
    return {
      reason: "missing_fields",
      orderId,
      expectedEventType: classifier,
      missingFields: ["refund_total_estimated"],
    }
  }

  const amount =
    classifier === "amazon.refund_issued"
      ? extractAmountByLabels(text, ["refund amount", "refund total", "total refund", "refund subtotal"]) ??
        extractAnyRefundAmount(text)
      : extractAmountByLabels(text, ["total estimated refund", "refund subtotal", "estimated refund", "refund total"]) ??
        extractAnyRefundAmount(text)
  if (amount !== null) {
    return null
  }

  return {
    reason: "missing_fields",
    orderId,
    expectedEventType: classifier,
    missingFields: [
      classifier === "amazon.refund_issued" ? "refund_amount_issued" : "refund_total_estimated",
    ],
  }
}

function isAmazonReturnSender(provider: string, fromAddress: string): boolean {
  void provider
  return AMAZON_FROM.test(fromAddress)
}

function classifyAmazonTemplate(
  subject: string,
  text: string
): AmazonReturnParseResult["eventType"] | null {
  if (RETURN_REQUEST_PATTERN.test(subject) || RETURN_REQUEST_PATTERN.test(text)) {
    return "amazon.return_requested"
  }
  if (REFUND_ISSUED_PATTERN.test(subject) || REFUND_ISSUED_PATTERN.test(text)) {
    return "amazon.refund_issued"
  }
  if (RETURN_DROPPED_OFF_PATTERN.test(subject) || RETURN_DROPPED_OFF_PATTERN.test(text)) {
    return "amazon.return_dropped_off"
  }
  return null
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
    if (!labels.some((label) => lower.includes(label))) {
      continue
    }
    const amount = extractAmountFromLine(line)
    if (amount !== null) {
      return amount
    }
  }
  return null
}

function extractAnyRefundAmount(text: string): number | null {
  const lines = toLines(text)
  for (const line of lines) {
    if (!/\b(refund|subtotal|total)\b/i.test(line)) {
      continue
    }
    const amount = extractAmountFromLine(line)
    if (amount !== null) {
      return amount
    }
  }
  return null
}

function extractAmountFromLine(line: string): number | null {
  const compact = line.replace(/\*/g, "").replace(/\^/g, "")
  const match = compact.match(MONEY_PATTERN) ?? compact.match(MONEY_CURRENCY_PATTERN)
  if (!match) {
    return null
  }
  const whole = match[1]
  const fraction = match[2]
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
    const next = lines[i + 1]?.trim()
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
  const match = cleaned.match(
    /^(?:[A-Za-z]{3,9}\.?,?\s+)?(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:,\s*(\d{4}))?$/i
  )
  if (!match) {
    return null
  }
  const monthName = match[1].toLowerCase()
  const day = Number(match[2])
  const explicitYear = match[3] ? Number(match[3]) : null
  const baseYear = referenceDate?.getUTCFullYear() ?? new Date().getUTCFullYear()
  const year = explicitYear ?? inferBestYear(baseYear, monthName, day, referenceDate)
  const month = monthNameToNumber(monthName)
  if (!month || !Number.isFinite(day) || !Number.isFinite(year)) {
    return null
  }
  const mm = String(month).padStart(2, "0")
  const dd = String(day).padStart(2, "0")
  return `${year}-${mm}-${dd}`
}

function inferBestYear(baseYear: number, monthName: string, day: number, referenceDate?: Date): number {
  if (!referenceDate) {
    return baseYear
  }
  const month = monthNameToNumber(monthName)
  if (!month) {
    return baseYear
  }

  const candidates = [baseYear - 1, baseYear, baseYear + 1]
    .map((year) => {
      const date = Date.UTC(year, month - 1, day)
      const deltaDays = Math.abs(date - referenceDate.getTime()) / (24 * 60 * 60 * 1000)
      return { year, date, deltaDays }
    })
    .sort((a, b) => a.deltaDays - b.deltaDays)

  const best = candidates[0]
  const close = candidates.find(
    (candidate) =>
      Math.abs(candidate.deltaDays - best.deltaDays) < 1 &&
      candidate.date >= referenceDate.getTime()
  )
  return (close ?? best).year
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

function extractItems(text: string, subject?: string): AmazonReturnItem[] {
  const lines = toLines(text)
  const items: AmazonReturnItem[] = []
  let inItemSection = false
  let pendingQty: number | undefined

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const inlineTitle = line.match(ITEM_LABEL_PATTERN)?.[1]?.trim()
    if (inlineTitle) {
      pushItem(items, inlineTitle)
      continue
    }

    if (!inItemSection && ITEM_SECTION_MARKERS.some((pattern) => pattern.test(line))) {
      inItemSection = true
      pendingQty = extractQuantity(line) ?? undefined
      continue
    }

    if (!inItemSection) {
      continue
    }
    if (ITEM_SECTION_STOP.test(line)) {
      inItemSection = false
      pendingQty = undefined
      continue
    }
    if (/^order(?:\s*(?:id|#))?/i.test(line)) {
      inItemSection = false
      pendingQty = undefined
      continue
    }
    if (/^item(?:\s+returned|\s+to\s+be\s+returned)?\s*:\s*\d+/i.test(line)) {
      pendingQty = extractQuantity(line) ?? undefined
      continue
    }

    const title = extractTitleFromLine(line)
    if (!title) {
      continue
    }
    pushItem(items, title, pendingQty)
    pendingQty = undefined
  }

  if (items.length === 0 && subject) {
    const subjectTitle = extractItemTitleFromSubject(subject)
    if (subjectTitle) {
      items.push({ title: subjectTitle })
    }
  }

  return items
}

function pushItem(items: AmazonReturnItem[], rawTitle: string, qty?: number): void {
  const title = extractTitleFromLine(rawTitle)
  if (!title) {
    return
  }
  const key = title.trim().toLowerCase()
  const existing = items.find((item) => item.title.trim().toLowerCase() === key)
  if (existing) {
    if (qty && !existing.qty) {
      existing.qty = qty
    }
    return
  }
  items.push(qty && qty > 0 ? { title, qty } : { title })
}

function extractRefundDestination(text: string): string | null {
  const lines = toLines(text)
  for (const line of lines) {
    for (const pattern of REFUND_DESTINATION_PATTERNS) {
      const match = line.match(pattern)
      if (!match?.[1]) continue
      const candidate = normalizeDestination(match[1])
      if (candidate) {
        return candidate
      }
    }
  }
  return null
}

function normalizeDestination(value: string): string | null {
  const cleaned = value.replace(/[.]+$/, "").replace(/\s+/g, " ").trim()
  if (!cleaned) return null
  return cleaned.length > 120 ? cleaned.slice(0, 120) : cleaned
}

function extractReturnMethodOrLocation(text: string): string | null {
  const lines = toLines(text)
  for (const line of lines) {
    if (!/\b(drop[-\s]*off|return method|return location|bring your package to|take your package to)\b/i.test(line)) {
      continue
    }
    const cleaned = line.replace(/\s+/g, " ").trim()
    return cleaned.length > 160 ? cleaned.slice(0, 160) : cleaned
  }
  return null
}

function extractQuantity(line: string): number | null {
  const direct = line.match(/:\s*(\d+)\b/)
  if (direct?.[1]) {
    return Number(direct[1])
  }
  const leading = line.match(/^(\d+)\s*[xX]?\s+/)
  if (leading?.[1]) {
    return Number(leading[1])
  }
  return null
}

function extractPaymentMethodLast4(text: string): string | null {
  const lines = toLines(text)
  for (const line of lines) {
    const match = line.match(PAYMENT_LAST4_PATTERN)
    if (match?.[1]) {
      return match[1]
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
  if (/^(return|refund)\b/i.test(value) && value.length < 20) {
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
