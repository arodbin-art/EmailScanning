import { ORTHODONTICS_EVENT_TYPES } from "../events/signalEvents.js"

export type OrthodonticsPaymentEmailInput = {
  provider: string
  fromAddress: string
  subject?: string
  receivedAt?: Date
  normalizedBody: string
}

export type OrthodonticsPaymentApproved = {
  eventType: typeof ORTHODONTICS_EVENT_TYPES.PAYMENT_APPROVED
  merchant: string
  amount: number | null
  currency: "CAD"
  transactionId?: string
  paymentReference?: string
  statusText: string
}

const ELAVON_SENDER = /\bnoreply@elavon\.com\b/i
const SUBJECT_APPROVED = /^approved payment$/i
const MERCHANT_HINT = /durham orthodontics ajax/i

const REFERENCE_PATTERNS: RegExp[] = [
  /\b(?:reference(?:\s*(?:number|no\.?|#))?|transaction(?:\s*(?:id|number|no\.?|#))?|invoice(?:\s*(?:id|number|no\.?|#))?)\s*[:#-]?\s*([A-Z0-9-]{6,})/i,
  /\bauth(?:orization)?\s*(?:code|id)?\s*[:#-]?\s*([A-Z0-9-]{4,})/i,
]

const AMOUNT_PATTERNS: RegExp[] = [
  /\b(?:approved\s*payment|payment\s*amount|amount(?:\s*paid)?)\s*[:\-]?\s*(?:CAD|C\$|\$)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i,
  /(?:CAD|C\$|\$)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i,
]

export function parseOrthodonticsPaymentEmail(
  input: OrthodonticsPaymentEmailInput
): OrthodonticsPaymentApproved | null {
  void input.provider
  if (!ELAVON_SENDER.test(input.fromAddress)) {
    return null
  }
  const subject = (input.subject ?? "").trim()
  if (!SUBJECT_APPROVED.test(subject)) {
    return null
  }

  const normalizedBody = normalizeText(input.normalizedBody)
  if (!MERCHANT_HINT.test(normalizedBody)) {
    return null
  }

  const transactionId = extractReference(normalizedBody) ?? undefined
  return {
    eventType: ORTHODONTICS_EVENT_TYPES.PAYMENT_APPROVED,
    merchant: "Durham Orthodontics Ajax",
    amount: extractAmount(normalizedBody),
    currency: "CAD",
    transactionId,
    paymentReference: transactionId,
    statusText: "Approved Payment",
  }
}

export type OrthodonticsAttachmentRef = {
  filename: string
  mime_type: string | null
  size_bytes: number | null
  object_key: string
}

export function extractOrthodonticsAttachmentRefs(
  metadata: unknown
): OrthodonticsAttachmentRef[] {
  const attachments = (metadata as { attachments?: unknown[] } | null)?.attachments
  if (!Array.isArray(attachments)) {
    return []
  }

  return attachments
    .map((item) => toOrthodonticsAttachmentRef(item))
    .filter((item): item is OrthodonticsAttachmentRef => item !== null)
}

function normalizeText(content: string): string {
  const withoutTags = content.replace(/<[^>]+>/g, " ")
  return withoutTags.replace(/[ \t]+/g, " ").replace(/\s+\n/g, "\n").trim()
}

function extractAmount(text: string): number | null {
  for (const pattern of AMOUNT_PATTERNS) {
    const match = text.match(pattern)
    if (!match?.[1]) continue
    const parsed = Number(match[1].replace(/,/g, ""))
    if (Number.isFinite(parsed)) {
      return Number(parsed.toFixed(2))
    }
  }
  return null
}

function extractReference(text: string): string | null {
  for (const pattern of REFERENCE_PATTERNS) {
    const match = text.match(pattern)
    const value = match?.[1]?.trim()
    if (value) return value
  }
  return null
}

function toOrthodonticsAttachmentRef(item: unknown): OrthodonticsAttachmentRef | null {
  if (!item || typeof item !== "object") {
    return null
  }
  const row = item as Record<string, unknown>
  const objectKey = asNonEmptyString(row.objectKey)
  if (!objectKey) {
    return null
  }

  const filename = asNonEmptyString(row.name) ?? fileNameFromKey(objectKey)
  const mimeType = asNonEmptyString(row.contentType)
  const sizeBytes = asFiniteNumber(row.size)

  return {
    filename,
    mime_type: mimeType,
    size_bytes: sizeBytes,
    object_key: objectKey,
  }
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function fileNameFromKey(objectKey: string): string {
  const parts = objectKey.split("/")
  const leaf = parts[parts.length - 1] ?? objectKey
  const normalized = leaf.trim()
  return normalized.length > 0 ? normalized : "attachment"
}
