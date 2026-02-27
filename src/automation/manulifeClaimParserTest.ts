import {
  detectManulifeClaimNearMiss,
  parseManulifeClaimEmail,
} from "./manulifeClaimParser.js"
import { MANULIFE_EVENT_TYPES } from "../events/signalEvents.js"
import { computeManulifeBaselineScore } from "../intelligence/aiReview.js"

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message)
  }
}

function runTests() {
  const receivedBody = `
    Hello,
    We received your claim.
    Claim Number: CLM-998877
    Amount claimed: CAD 124.85
  `
  const received = parseManulifeClaimEmail({
    provider: "gmail",
    fromAddress: "claims@manulife.ca",
    subject: "Claim received confirmation",
    receivedAt: new Date("2026-02-22T10:00:00.000Z"),
    normalizedBody: receivedBody,
  })
  assert(received !== null, "claim received email should parse")
  assert(
    received?.eventType === MANULIFE_EVENT_TYPES.CLAIM_RECEIVED,
    "claim received event type"
  )
  assert(received?.claimId === "CLM-998877", "claim id should parse")
  assert(
    received?.amounts.amountClaimed === 124.85,
    "amount claimed should parse"
  )

  const processedBody = `
    Assessment completed.
    Claim # CLM-998877
    Eligible amount: $102.40
    Processed on Mar 03
  `
  const processed = parseManulifeClaimEmail({
    provider: "gmail",
    fromAddress: "notifications@manulife.ca",
    subject: "Your claim has been processed",
    receivedAt: new Date("2026-03-03T17:00:00.000Z"),
    normalizedBody: processedBody,
  })
  assert(processed !== null, "claim processed email should parse")
  assert(
    processed?.eventType === MANULIFE_EVENT_TYPES.CLAIM_PROCESSED,
    "claim processed event type"
  )
  assert(
    processed?.amounts.amountEligible === 102.4,
    "eligible amount should parse"
  )
  assert(
    processed?.dates.processedAt === "2026-03-03",
    "processed date should infer year"
  )

  const paidBody = `
    Payment issued for your claim.
    Claim Number: CLM-998877
    Amount paid: CAD $88.12
    Paid on Mar 05, 2026
  `
  const paid = parseManulifeClaimEmail({
    provider: "gmail",
    fromAddress: "eob@manulife.ca",
    subject: "Claim paid",
    receivedAt: new Date("2026-03-05T17:00:00.000Z"),
    normalizedBody: paidBody,
  })
  assert(paid !== null, "claim paid email should parse")
  assert(paid?.eventType === MANULIFE_EVENT_TYPES.CLAIM_PAID, "claim paid event type")
  assert(paid?.amounts.amountPaid === 88.12, "amount paid should parse")
  assert(paid?.dates.paidAt === "2026-03-05", "paid date should parse")

  const deniedBody = `
    Claim Number: CLM-998877
    Your claim has been denied because the expense is not covered.
  `
  const denied = parseManulifeClaimEmail({
    provider: "gmail",
    fromAddress: "claims@manulife.ca",
    subject: "Claim denied",
    receivedAt: new Date("2026-03-06T17:00:00.000Z"),
    normalizedBody: deniedBody,
  })
  assert(denied !== null, "claim denied email should parse")
  assert(
    denied?.eventType === MANULIFE_EVENT_TYPES.CLAIM_DENIED,
    "claim denied event type"
  )

  const infoRequiredBody = `
    Action required for your claim.
    Claim Number: CLM-998877
    Additional information is required before we can continue.
  `
  const infoRequired = parseManulifeClaimEmail({
    provider: "gmail",
    fromAddress: "claims@manulife.ca",
    subject: "Information required",
    receivedAt: new Date("2026-03-07T17:00:00.000Z"),
    normalizedBody: infoRequiredBody,
  })
  assert(infoRequired !== null, "info required email should parse")
  assert(
    infoRequired?.eventType === MANULIFE_EVENT_TYPES.CLAIM_INFO_REQUIRED,
    "info required event type"
  )

  const missingClaimBody = `
    We processed your claim.
    Eligible amount: $55.00
  `
  const missingClaim = parseManulifeClaimEmail({
    provider: "gmail",
    fromAddress: "claims@manulife.ca",
    subject: "Claim update",
    receivedAt: new Date("2026-03-08T17:00:00.000Z"),
    normalizedBody: missingClaimBody,
  })
  assert(missingClaim !== null, "missing-claim email should still parse")
  assert(
    missingClaim?.eventType === MANULIFE_EVENT_TYPES.CLAIM_STATUS_UPDATE,
    "missing claim id should become status_update"
  )
  assert(missingClaim?.claimId === undefined, "claim id should be empty when missing")

  const missingClaimNearMiss = detectManulifeClaimNearMiss({
    provider: "gmail",
    fromAddress: "claims@manulife.ca",
    subject: "Claim update",
    receivedAt: new Date("2026-03-08T17:00:00.000Z"),
    normalizedBody: missingClaimBody,
  })
  assert(
    missingClaimNearMiss?.parseReason === "missing_claim_id",
    "near-miss should report missing claim id"
  )

  const ambiguousClaimBody = `
    Claim Number: CLM-111111
    Reference: CLM-222222
    We processed your claim.
  `
  const ambiguous = detectManulifeClaimNearMiss({
    provider: "gmail",
    fromAddress: "claims@manulife.ca",
    subject: "Claim update",
    receivedAt: new Date("2026-03-08T17:00:00.000Z"),
    normalizedBody: ambiguousClaimBody,
  })
  assert(
    ambiguous?.parseReason === "ambiguous_claim_id",
    "near-miss should report ambiguous claim id"
  )
  assert(
    (ambiguous?.claimCandidates?.length ?? 0) === 2,
    "near-miss should include all claim candidates"
  )

  const unrelated = parseManulifeClaimEmail({
    provider: "gmail",
    fromAddress: "noreply@example.com",
    subject: "Hello",
    receivedAt: new Date("2026-03-08T17:00:00.000Z"),
    normalizedBody: "random update",
  })
  assert(unrelated === null, "non-manulife senders should not parse")

  const baselineComplete = computeManulifeBaselineScore({
    beneficiary: "Rod Allen",
    claimType: "Dental",
    serviceDate: "2026-03-01",
    submitted: 124.85,
    paidTotal: 110.5,
  })
  assert(
    baselineComplete >= 0.85,
    `complete baseline should be high confidence, got ${baselineComplete}`
  )

  const baselineMissingDate = computeManulifeBaselineScore({
    beneficiary: "Rod Allen",
    claimType: "Dental",
    serviceDate: null,
    submitted: 124.85,
    paidTotal: 110.5,
  })
  assert(
    baselineMissingDate < 0.85,
    `missing service date should reduce confidence, got ${baselineMissingDate}`
  )

  const baselineMissingAmount = computeManulifeBaselineScore({
    beneficiary: "Rod Allen",
    claimType: "Dental",
    serviceDate: "2026-03-01",
    submitted: null,
    paidTotal: 110.5,
  })
  assert(
    baselineMissingAmount <= 0.65,
    `missing submitted amount should be low confidence, got ${baselineMissingAmount}`
  )

  console.log("Manulife claim parser tests passed")
}

runTests()
