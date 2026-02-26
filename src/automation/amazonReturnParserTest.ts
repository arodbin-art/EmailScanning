import { readFileSync } from "node:fs"
import path from "node:path"
import { parseAmazonReturnEmail } from "./amazonReturnParser.js"

const fixtureRequested = readFileSync(
  path.join(process.cwd(), "src/automation/fixtures/amazon_return_requested_702-3272715-0390601.txt"),
  "utf8"
)

const fixtureDroppedOff = readFileSync(
  path.join(process.cwd(), "src/automation/fixtures/amazon_return_dropped_off_701-7116856-5433865.txt"),
  "utf8"
)

const refundIssuedBody = `
Hello,

Refund issued.
Order #701-7333604-7372223
Refund subtotal $45.19
Your refund has been issued.
This amount will be refunded to your Visa ending in 1448.

Item returned: 1
[Wireless Earbuds, Sports Bluetooth...](https://www.amazon.ca/gp/product/B0G2L2KMLY)
`

const rodneyReturnBody = `
Hello,

Your return request is confirmed.
Order ID: 702-9059320-9056262
Item: AGM M8 Rugged Basic Flip Phone, 4G
Refund subtotal: CAD $124.85
Drop off by Mar 13
Payment method ending in 1448
`

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message)
  }
}

function runTests() {
  const returnNoYearParsed = parseAmazonReturnEmail({
    provider: "gmail",
    fromAddress: "return@amazon.ca",
    subject: "Your return request is confirmed",
    receivedAt: new Date("2026-01-23T00:00:00Z"),
    normalizedBody: fixtureRequested,
  })

  assert(returnNoYearParsed !== null, "return request without year should parse")
  assert(
    returnNoYearParsed?.eventType === "amazon.return_requested",
    "return request without year event type"
  )
  if (returnNoYearParsed && returnNoYearParsed.eventType === "amazon.return_requested") {
    assert(returnNoYearParsed.orderId === "702-3272715-0390601", "order id parsed")
    assert(returnNoYearParsed.refundTotalEstimated === 31.12, "estimated refund parsed")
    assert(returnNoYearParsed.dropOffBy === "2026-02-02", "drop off date without year")
    assert(
      returnNoYearParsed.items[0]?.title.startsWith("ELEGOO PLA Filament"),
      "item title from markdown link"
    )
  }

  const droppedOffParsed = parseAmazonReturnEmail({
    provider: "gmail",
    fromAddress: "return@amazon.ca",
    subject: "Your return drop-off confirmation",
    receivedAt: new Date("2026-02-01T00:00:00Z"),
    normalizedBody: fixtureDroppedOff,
  })

  assert(droppedOffParsed !== null, "drop-off confirmation should parse")
  assert(droppedOffParsed?.eventType === "amazon.return_dropped_off", "drop-off event type")
  if (droppedOffParsed && droppedOffParsed.eventType === "amazon.return_dropped_off") {
    assert(droppedOffParsed.orderId === "701-7116856-5433865", "drop-off order id")
    assert(droppedOffParsed.refundTotalEstimated === 35.7, "drop-off estimated refund")
    assert(
      droppedOffParsed.refundDestinationText?.toLowerCase().includes("amazon account balance") ?? false,
      "drop-off refund destination"
    )
    assert(droppedOffParsed.items.length === 2, "drop-off should parse multiple items")
  }

  const refundIssuedParsed = parseAmazonReturnEmail({
    provider: "gmail",
    fromAddress: "return@amazon.ca",
    subject: "Your refund has been issued",
    receivedAt: new Date("2026-01-23T00:00:00Z"),
    normalizedBody: refundIssuedBody,
  })

  assert(refundIssuedParsed !== null, "refund issued should parse")
  assert(refundIssuedParsed?.eventType === "amazon.refund_issued", "refund issued event type")
  if (refundIssuedParsed && refundIssuedParsed.eventType === "amazon.refund_issued") {
    assert(refundIssuedParsed.orderId === "701-7333604-7372223", "refund order id")
    assert(refundIssuedParsed.refundAmountIssued === 45.19, "refund amount parsed")
    assert(
      refundIssuedParsed.refundDestinationText?.toLowerCase().includes("ending in 1448") ?? false,
      "refund destination parsed"
    )
  }

  const rodneyParsed = parseAmazonReturnEmail({
    provider: "gmail",
    fromAddress: "return@amazon.ca",
    subject: "Your return request is confirmed",
    receivedAt: new Date("2026-02-18T00:00:00Z"),
    normalizedBody: rodneyReturnBody,
  })
  assert(rodneyParsed !== null, "Rodney return email should parse")
  assert(rodneyParsed?.eventType === "amazon.return_requested", "Rodney event type")
  if (rodneyParsed && rodneyParsed.eventType === "amazon.return_requested") {
    assert(rodneyParsed.orderId === "702-9059320-9056262", "Rodney order id")
    assert(rodneyParsed.refundTotalEstimated === 124.85, "Rodney amount total")
    assert(rodneyParsed.dropOffBy === "2026-03-13", "Rodney drop off by")
    assert(rodneyParsed.items[0]?.title.startsWith("AGM M8"), "Rodney item title")
    assert(rodneyParsed.paymentMethodLast4 === "1448", "Rodney payment last4")
  }

  console.log("Amazon return parser tests passed")
}

runTests()
