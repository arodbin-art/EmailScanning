import { Prisma, PrismaClient } from "@prisma/client"

type AmazonRefundContext = {
  db: PrismaClient
  emailId: number
  provider: string
  messageId: string
  subject?: string
  receivedAt: Date
  fromAddress: string
  normalizedBody: string
}

type DiscrepancyResult = {
  orderId: string
  chargedAmount: number
  refundedAmount: number
  difference: number
  subject?: string
  receivedAt: Date
  gmailLink?: string
  reason: string
}

// Sample output:
// {
//   orderId: "123-1234567-1234567",
//   chargedAmount: 59.99,
//   refundedAmount: 49.99,
//   difference: 10.0,
//   subject: "Your refund has been issued",
//   receivedAt: new Date("2026-02-04T12:00:00Z"),
//   gmailLink: "https://mail.google.com/mail/u/0/#inbox/19c285018bd6e8d0",
//   reason: "refund_lower_than_charge"
// }

const AMAZON_FROM_PATTERN = /@amazon\./i
const AMAZON_SUBJECT_PATTERN = /(refund|return|replacement|return completed|refund issued|refund processed)/i
const ORDER_ID_PATTERN = /(\d{3}-\d{7}-\d{7})/
// Edge cases handled:
// - Explicit partial refunds are ignored (partial refund/partially refunded/partial credit).
// - Gift card credits are ignored unless a cash refund is also present.
const PARTIAL_REFUND_PATTERN = /(partial refund|partially refunded|partial credit)/i
const GIFT_CARD_PATTERN = /(gift card|giftcard|amazon gift card|promotional credit)/i
const CASH_REFUND_PATTERN = /(original payment|credit card|debit|visa|mastercard|amex|american express|discover|bank)/i

const AMOUNT_REGEX = /\$?\s?(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})/g

export async function detectAmazonRefundDiscrepancy(
  context: AmazonRefundContext
): Promise<DiscrepancyResult | null> {
  if (!isAmazonRefundEmail(context.fromAddress, context.subject, context.normalizedBody)) {
    return null
  }

  const orderId = extractOrderId(context.normalizedBody, context.subject)
  if (!orderId) {
    return null
  }

  const alreadyProcessed = await context.db.amazonRefundProcessed.findUnique({
    where: { orderId },
    select: { orderId: true },
  })
  if (alreadyProcessed) {
    return null
  }

  const normalizedText = `${context.subject ?? ""}\n${context.normalizedBody}`
  if (PARTIAL_REFUND_PATTERN.test(normalizedText)) {
    await markProcessed(context.db, orderId, context.emailId)
    return null
  }

  const extracted = extractAmounts(context.normalizedBody)
  if (!extracted.chargedAmount || !extracted.refundAmount) {
    await markProcessed(context.db, orderId, context.emailId)
    return null
  }

  if (extracted.giftCardRefundOnly) {
    await markProcessed(context.db, orderId, context.emailId)
    return null
  }

  const charged = extracted.chargedAmount
  const refunded = extracted.refundAmount
  const difference = roundToCents(charged - refunded)

  await markProcessed(context.db, orderId, context.emailId)

  if (difference <= 0) {
    return null
  }

  const gmailLink = context.provider === "gmail" ? buildGmailLink(context.messageId) : undefined

  const record = await context.db.amazonRefundDiscrepancy.upsert({
    where: { orderId },
    update: {},
    create: {
      orderId,
      emailId: context.emailId,
      chargedAmount: new Prisma.Decimal(charged.toFixed(2)),
      refundedAmount: new Prisma.Decimal(refunded.toFixed(2)),
      difference: new Prisma.Decimal(difference.toFixed(2)),
      subject: context.subject ?? null,
      receivedAt: context.receivedAt,
      gmailLink: gmailLink ?? null,
      createdAt: new Date(),
    },
  })

  return {
    orderId: record.orderId,
    chargedAmount: charged,
    refundedAmount: refunded,
    difference,
    subject: record.subject ?? undefined,
    receivedAt: record.receivedAt,
    gmailLink,
    reason: "refund_lower_than_charge",
  }
}

function isAmazonRefundEmail(fromAddress: string, subject?: string, body?: string): boolean {
  const fromMatch = AMAZON_FROM_PATTERN.test(fromAddress)
  const subjectMatch = AMAZON_SUBJECT_PATTERN.test(subject ?? "")
  if (fromMatch && subjectMatch) {
    return true
  }
  const bodyMatch = AMAZON_SUBJECT_PATTERN.test(body ?? "")
  return fromMatch && bodyMatch
}

function extractOrderId(body: string, subject?: string): string | null {
  const subjectMatch = subject ? subject.match(ORDER_ID_PATTERN) : null
  if (subjectMatch) {
    return subjectMatch[1]
  }
  const bodyMatch = body.match(ORDER_ID_PATTERN)
  return bodyMatch ? bodyMatch[1] : null
}

function extractAmounts(body: string): {
  chargedAmount?: number
  refundAmount?: number
  giftCardRefundOnly: boolean
} {
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const chargedCandidates: number[] = []
  const refundCandidates: number[] = []
  let hasGiftCardRefund = false
  let hasCashRefund = false

  for (const line of lines) {
    const amounts = extractLineAmounts(line)
    if (amounts.length === 0) {
      continue
    }

    const lower = line.toLowerCase()
    const isGiftCard = GIFT_CARD_PATTERN.test(lower)
    const isRefundLine = lower.includes("refund")
    const isChargeLine = /(charged|order total|total|amount charged|original amount)/i.test(line)

    if (isRefundLine) {
      refundCandidates.push(...amounts)
      if (isGiftCard) {
        hasGiftCardRefund = true
      } else if (CASH_REFUND_PATTERN.test(lower)) {
        hasCashRefund = true
      }
    }

    if (isChargeLine) {
      chargedCandidates.push(...amounts)
    }
  }

  const chargedAmount = pickBestCharged(chargedCandidates)
  const refundAmount = pickBestRefund(refundCandidates)

  return {
    chargedAmount,
    refundAmount,
    giftCardRefundOnly: hasGiftCardRefund && !hasCashRefund,
  }
}

function extractLineAmounts(line: string): number[] {
  const amounts: number[] = []
  let match: RegExpExecArray | null
  while ((match = AMOUNT_REGEX.exec(line)) !== null) {
    const normalized = `${match[1].replace(/,/g, "")}.${match[2]}`
    const value = Number(normalized)
    if (Number.isFinite(value)) {
      amounts.push(value)
    }
  }
  return amounts
}

function pickBestCharged(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined
  }
  return values.sort((a, b) => b - a)[0]
}

function pickBestRefund(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined
  }
  return values.sort((a, b) => b - a)[0]
}

async function markProcessed(db: PrismaClient, orderId: string, emailId: number): Promise<void> {
  await db.amazonRefundProcessed.upsert({
    where: { orderId },
    update: { processedAt: new Date(), emailId },
    create: { orderId, emailId, processedAt: new Date() },
  })
}

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100
}

function buildGmailLink(messageId: string): string {
  return `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(messageId)}`
}
