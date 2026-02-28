import { readFileSync } from "node:fs"
import path from "node:path"
import {
  extractOrthodonticsAttachmentRefs,
  parseOrthodonticsPaymentEmail,
} from "./orthodonticsPaymentParser.js"

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

const fixtureApproved = readFileSync(
  path.join(process.cwd(), "src/automation/fixtures/orthodontics_approved_payment_sample.txt"),
  "utf8"
)

function testApprovedPaymentParses(): void {
  const parsed = parseOrthodonticsPaymentEmail({
    provider: "gmail",
    fromAddress: "noreply@elavon.com",
    subject: "Approved Payment",
    receivedAt: new Date("2026-01-03T10:00:00.000Z"),
    normalizedBody: fixtureApproved,
  })

  assert(parsed !== null, "durham approved payment should parse")
  assert(parsed?.eventType === "orthodontics.payment_approved", "event type")
  assert(parsed?.merchant === "Durham Orthodontics", "merchant parsed")
  assert(parsed?.amount === 235.5, "amount parsed")
  assert(parsed?.transactionId === "ELV-778899", "transaction id parsed")
  assert(parsed?.paymentReference === "ELV-778899", "legacy payment reference parsed")
}

function testNonMatchingSenderIgnored(): void {
  const parsed = parseOrthodonticsPaymentEmail({
    provider: "gmail",
    fromAddress: "billing@example.com",
    subject: "Approved Payment",
    normalizedBody: fixtureApproved,
  })
  assert(parsed === null, "non-elavon sender should not parse")
}

function testAttachmentRefsPassThrough(): void {
  const refs = extractOrthodonticsAttachmentRefs({
    attachments: [
      {
        id: "a1",
        name: "invoice.pdf",
        contentType: "application/pdf",
        size: 123456,
        objectKey: "emails/gmail/2026/02/x/attachments/a1_invoice.pdf",
      },
      {
        id: "a2",
        name: "inline-image.png",
        contentType: "image/png",
        size: 999,
        isInline: true,
      },
    ],
  })

  assert(refs.length === 1, "only uploadable attachment refs should be returned")
  assert(refs[0].filename === "invoice.pdf", "filename passthrough")
  assert(refs[0].mime_type === "application/pdf", "mime passthrough")
  assert(refs[0].size_bytes === 123456, "size passthrough")
  assert(
    refs[0].object_key === "emails/gmail/2026/02/x/attachments/a1_invoice.pdf",
    "object key passthrough"
  )
}

function main(): void {
  testApprovedPaymentParses()
  testNonMatchingSenderIgnored()
  testAttachmentRefsPassThrough()
  console.log("orthodonticsPaymentParserTest ok")
}

main()
