import { persistAiCandidateSignals, safeAnalyzeSignals } from "./shadowRuntime.js"
import { EmailIntelligenceProvider, IntelligenceEmailInput } from "./types.js"

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message)
  }
}

const email: IntelligenceEmailInput = {
  emailId: "456",
  subject: "Your refund has been issued",
  normalizedText: "Order #701-7333604-7372223",
  receivedAt: new Date("2026-02-26T01:00:00.000Z"),
  provider: "gmail",
  mailAccountId: 2,
  fromAddress: "return@amazon.ca",
}

async function testAiCandidateEventPersists(): Promise<void> {
  const captured: Array<Record<string, unknown>> = []

  const writer = {
    async createMany(args: { data: Array<Record<string, unknown>> }) {
      captured.push(...args.data)
      return { count: args.data.length }
    },
  }

  await persistAiCandidateSignals({
    writer,
    email,
    signals: [
      {
        eventType: "amazon.refund_issued",
        primaryRef: "701-7333604-7372223",
        amount: 45.19,
        occurredAt: "2026-02-26T01:00:00.000Z",
        payload: { order_id: "701-7333604-7372223" },
        confidence: 0.87,
      },
    ],
  })

  assert(captured.length === 1, "expected one candidate event row")
  assert(captured[0].emailId === "456", "email id should be captured")
  assert(captured[0].eventType === "amazon.refund_issued", "event type should persist")
}

async function testIngestionContinuesIfIgptThrows(): Promise<void> {
  let warned = false
  const provider: EmailIntelligenceProvider = {
    async analyzeEmail() {
      throw new Error("igpt unavailable")
    },
  }

  const result = await safeAnalyzeSignals({
    provider,
    email,
    providerName: "igpt",
    logger: {
      info() {},
      warn() {
        warned = true
      },
      error() {},
    },
  })

  assert(Array.isArray(result), "result should always be an array")
  assert(result.length === 0, "failed IGPT analysis should return empty array")
  assert(warned, "failed IGPT analysis should log warning")
}

async function main() {
  await testAiCandidateEventPersists()
  await testIngestionContinuesIfIgptThrows()
  console.log("shadowRuntimeTest ok")
}

main().catch((error) => {
  console.error("shadowRuntimeTest failed", error)
  process.exit(1)
})
