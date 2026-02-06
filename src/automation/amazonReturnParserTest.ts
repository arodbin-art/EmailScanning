import { parseAmazonReturnEmail } from "./amazonReturnParser.js"

const returnRequestedBody = `
Hello,

Your return request is confirmed.
Order ID: 112-1234567-1234567
Item: Logitech MX Master 3 Mouse
Refund Amount: CAD $129.99
Drop off by March 15, 2026

Thank you.
`

const refundIssuedBody = `
Hello,

Your refund was issued.
Order ID: 112-9876543-9876543
Item title: Bose QuietComfort Headphones
Refund amount: $249.00

Thanks,
Amazon.ca
`

const returnRequestedNoYearBody = `
Hello,

Your return request is confirmed.
Order #702-3272715-0390601
Refund subtotal $31.12
Drop off by:

Mon., Feb. 2

Item returned: 1
[ELEGOO PLA Filament 1.75mm Silk True Red...](https://www.amazon.ca/gp/product/B0FMK84C7H)
`

const refundSubjectBody = `
Hello,

Your refund was issued.
Order #701-7333604-7372223
Refund subtotal $45.19
Total refund $45.19

Item returned: 1
[Wireless Earbuds, Sports Bluetooth...](https://www.amazon.ca/gp/product/B0G2L2KMLY)
`

const dropOffBody = `
Hello,

Your return was dropped off.
Refund will be issued by Jan 24.

Return Summary
Order #702-3272715-0390601
Refund subtotal $26.44
Total estimated refund: $26.44^

Item returned: 1
[ELEGOO Silk PLA Filament 1.75mm Purple...](https://www.amazon.ca/gp/product/B0DFPK4VRS)
`

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message)
  }
}

function runTests() {
  const returnParsed = parseAmazonReturnEmail({
    provider: "gmail",
    fromAddress: "return@amazon.ca",
    subject: "Your return request is confirmed",
    receivedAt: new Date("2026-03-01T00:00:00Z"),
    normalizedBody: returnRequestedBody,
  })

  assert(returnParsed !== null, "return request should parse")
  assert(returnParsed?.eventType === "amazon.return_requested", "return request event type")
  assert(returnParsed?.orderId === "112-1234567-1234567", "return request order id")
  if (returnParsed && returnParsed.eventType === "amazon.return_requested") {
    assert(returnParsed.amount === 129.99, "return request amount")
    assert(returnParsed.dropOffBy === "2026-03-15", "return request drop off by")
    assert(
      returnParsed.itemTitle === "Logitech MX Master 3 Mouse",
      "return request item title"
    )
  }

  const refundParsed = parseAmazonReturnEmail({
    provider: "gmail",
    fromAddress: "return@amazon.ca",
    subject: "Your refund is on the way",
    receivedAt: new Date("2026-03-01T00:00:00Z"),
    normalizedBody: refundIssuedBody,
  })

  assert(refundParsed !== null, "refund issued should parse")
  assert(refundParsed?.eventType === "amazon.refund_issued", "refund issued event type")
  assert(refundParsed?.orderId === "112-9876543-9876543", "refund issued order id")
  if (refundParsed && refundParsed.eventType === "amazon.refund_issued") {
    assert(refundParsed.refundAmount === 249.0, "refund issued amount")
    assert(
      refundParsed.itemTitle === "Bose QuietComfort Headphones",
      "refund issued item title"
    )
  }

  const returnNoYearParsed = parseAmazonReturnEmail({
    provider: "gmail",
    fromAddress: "return@amazon.ca",
    subject: "Your return of ELEGOO PLA Filament 1.75mm Silk....",
    receivedAt: new Date("2026-01-23T00:00:00Z"),
    normalizedBody: returnRequestedNoYearBody,
  })

  assert(returnNoYearParsed !== null, "return request without year should parse")
  assert(
    returnNoYearParsed?.eventType === "amazon.return_requested",
    "return request without year event type"
  )
  if (returnNoYearParsed && returnNoYearParsed.eventType === "amazon.return_requested") {
    assert(returnNoYearParsed.dropOffBy === "2026-02-02", "drop off date without year")
    assert(
      returnNoYearParsed.itemTitle.startsWith("ELEGOO PLA Filament"),
      "item title from link"
    )
  }

  const refundSubjectParsed = parseAmazonReturnEmail({
    provider: "gmail",
    fromAddress: "return@amazon.ca",
    subject: "Your refund for Wireless Earbuds, Sports....",
    receivedAt: new Date("2026-01-23T00:00:00Z"),
    normalizedBody: refundSubjectBody,
  })

  assert(refundSubjectParsed !== null, "refund subject should parse")
  assert(
    refundSubjectParsed?.eventType === "amazon.refund_issued",
    "refund subject event type"
  )
  if (refundSubjectParsed && refundSubjectParsed.eventType === "amazon.refund_issued") {
    assert(
      refundSubjectParsed.itemTitle.startsWith("Wireless Earbuds"),
      "refund item title from subject"
    )
  }

  const dropOffParsed = parseAmazonReturnEmail({
    provider: "gmail",
    fromAddress: "return@amazon.ca",
    subject: "Your return drop-off confirmation for ELEGOO Silk PLA Filament 1.75mm....",
    receivedAt: new Date("2026-01-23T00:00:00Z"),
    normalizedBody: dropOffBody,
  })

  assert(dropOffParsed !== null, "drop-off confirmation should parse")
  assert(
    dropOffParsed?.eventType === "amazon.return_dropped_off",
    "drop-off event type"
  )
  if (dropOffParsed && dropOffParsed.eventType === "amazon.return_dropped_off") {
    assert(dropOffParsed.estimatedRefund === 26.44, "drop-off estimated refund")
    assert(dropOffParsed.refundBy === "2026-01-24", "drop-off refund by date")
    assert(
      dropOffParsed.itemTitle.startsWith("ELEGOO Silk PLA Filament"),
      "drop-off item title"
    )
  }

  console.log("Amazon return parser tests passed")
}

runTests()
