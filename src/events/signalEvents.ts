import crypto from "crypto"

export const AMAZON_EVENT_TYPES = {
  RETURN_REQUESTED: "amazon.return_requested",
  RETURN_DROPPED_OFF: "amazon.return_dropped_off",
  REFUND_ISSUED: "amazon.refund_issued",
} as const

export const MANULIFE_EVENT_TYPES = {
  CLAIM_RECEIVED: "manulife.claim_received",
  CLAIM_PROCESSED: "manulife.claim_processed",
  CLAIM_PAID: "manulife.claim_paid",
  CLAIM_DENIED: "manulife.claim_denied",
  CLAIM_INFO_REQUIRED: "manulife.claim_info_required",
  CLAIM_STATUS_UPDATE: "manulife.claim_status_update",
} as const

export type SignalEventType =
  | (typeof AMAZON_EVENT_TYPES)[keyof typeof AMAZON_EVENT_TYPES]
  | (typeof MANULIFE_EVENT_TYPES)[keyof typeof MANULIFE_EVENT_TYPES]

type DedupeInput = {
  provider: string
  mailAccountId: number
  eventType: string
  primaryRef: string
  primaryAmount?: number | null
  primaryDate?: string | null
}

export function buildSignalEventDedupeKey(input: DedupeInput): string {
  const normalized = [
    input.provider.trim().toLowerCase(),
    String(input.mailAccountId),
    input.eventType.trim().toLowerCase(),
    normalizeRef(input.primaryRef),
    normalizeAmount(input.primaryAmount),
    normalizeDate(input.primaryDate),
  ].join("|")
  return crypto.createHash("md5").update(normalized).digest("hex")
}

function normalizeRef(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeAmount(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return ""
  return value.toFixed(2)
}

function normalizeDate(value?: string | null): string {
  if (!value) return ""
  const trimmed = value.trim()
  if (!trimmed) return ""
  const dateOnly = trimmed.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
  return dateOnly ?? trimmed
}
