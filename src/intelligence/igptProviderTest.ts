import { IGPTProvider } from "./igptProvider.js"
import { IntelligenceEmailInput } from "./types.js"
import { buildAiReview, computeManulifeBaselineScore } from "./aiReview.js"
import { reviewManulifeWithIGPT } from "./igptReviewManulife.js"

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message)
  }
}

const sampleEmail: IntelligenceEmailInput = {
  emailId: "123",
  subject: "Refund issued",
  normalizedText: "Order #701-0000000-0000000 Refund issued $35.70",
  receivedAt: new Date("2026-02-26T00:00:00.000Z"),
  provider: "gmail",
  mailAccountId: 1,
  fromAddress: "return@amazon.ca",
}

async function testDisabledReturnsEmpty(): Promise<void> {
  const original = snapshotEnv()
  process.env.IGPT_ENABLED = "false"
  process.env.IGPT_API_KEY = "test"
  process.env.IGPT_AUTH_MODE = "api_key"
  process.env.IGPT_SESSION_TOKEN = ""
  process.env.IGPT_SESSION_DEVICE_ID = ""

  let called = false
  const provider = new IGPTProvider({
    fetchImpl: (async () => {
      called = true
      throw new Error("should not be called")
    }) as any,
  })

  const result = await provider.analyzeEmail(sampleEmail)
  restoreEnv(original)

  assert(Array.isArray(result), "result should be an array")
  assert(result.length === 0, "disabled provider should return empty array")
  assert(called === false, "fetch should not run when IGPT is disabled")
}

async function testMalformedJsonReturnsEmpty(): Promise<void> {
  const original = snapshotEnv()
  process.env.IGPT_ENABLED = "true"
  process.env.IGPT_API_KEY = "test"
  process.env.IGPT_AUTH_MODE = "api_key"
  process.env.IGPT_BASE_URL = "https://example.test"
  process.env.IGPT_TIMEOUT_MS = "2000"
  process.env.IGPT_SESSION_TOKEN = ""
  process.env.IGPT_SESSION_DEVICE_ID = ""

  const provider = new IGPTProvider({
    fetchImpl: (async () => {
      return {
        ok: true,
        json: async () => ({ not_signals: "unexpected-shape" }),
      } as any
    }) as any,
  })

  const result = await provider.analyzeEmail(sampleEmail)
  restoreEnv(original)

  assert(result.length === 0, "malformed response should return empty array")
}

async function testJsonParseThrowsReturnsEmpty(): Promise<void> {
  const original = snapshotEnv()
  process.env.IGPT_ENABLED = "true"
  process.env.IGPT_API_KEY = "test"
  process.env.IGPT_AUTH_MODE = "api_key"
  process.env.IGPT_BASE_URL = "https://example.test"
  process.env.IGPT_SESSION_TOKEN = ""
  process.env.IGPT_SESSION_DEVICE_ID = ""

  const provider = new IGPTProvider({
    fetchImpl: (async () => {
      return {
        ok: true,
        json: async () => {
          throw new Error("invalid json")
        },
      } as any
    }) as any,
  })

  const result = await provider.analyzeEmail(sampleEmail)
  restoreEnv(original)

  assert(result.length === 0, "json parse error should return empty array")
}

async function testAuthErrorFallsBackToAzureOpenAi(): Promise<void> {
  const original = snapshotEnv()
  process.env.IGPT_ENABLED = "true"
  process.env.IGPT_API_KEY = "test"
  process.env.IGPT_AUTH_MODE = "api_key"
  process.env.IGPT_BASE_URL = "https://api.igpt.ai"
  process.env.IGPT_FALLBACK_ENABLED = "true"
  process.env.AZURE_OPENAI_ENDPOINT = "https://example-openai.test"
  process.env.AZURE_OPENAI_KEY = "azure-key"
  process.env.AZURE_OPENAI_DEPLOYMENT = "dep"
  process.env.AZURE_OPENAI_API_VERSION = "2024-02-15-preview"
  process.env.IGPT_SESSION_TOKEN = ""
  process.env.IGPT_SESSION_DEVICE_ID = ""

  const calls: string[] = []
  const provider = new IGPTProvider({
    fetchImpl: (async (url: any) => {
      const u = String(url)
      calls.push(u)
      if (u.includes("/v1/recall/ask")) {
        return {
          ok: true,
          json: async () => ({ error: "auth" }),
        } as any
      }
      if (u.includes("/openai/deployments/")) {
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    signals: [
                      {
                        eventType: "amazon.refund_issued",
                        primaryRef: "701-1234567-1234567",
                        amount: 35.7,
                        confidence: 0.82,
                        payload: {
                          order_id: "701-1234567-1234567",
                          status_text: "refund issued",
                        },
                      },
                    ],
                  }),
                },
              },
            ],
          }),
        } as any
      }
      throw new Error(`unexpected url: ${u}`)
    }) as any,
  })

  const result = await provider.analyzeEmail({
    ...sampleEmail,
    subject: "Amazon refund issued",
  })
  restoreEnv(original)

  assert(calls.length === 2, "expected IGPT call + fallback call")
  assert(result.length === 1, "expected one fallback signal")
  assert(result[0].eventType === "amazon.refund_issued", "fallback event type")
  assert(
    (result[0].payload as any)?._shadow_source === "openai_fallback",
    "fallback payload should mark source"
  )
}

async function testSessionModeReturnsSignalsFromOutputJson(): Promise<void> {
  const original = snapshotEnv()
  process.env.IGPT_ENABLED = "true"
  process.env.IGPT_AUTH_MODE = "session"
  process.env.IGPT_SESSION_TOKEN = "session-token"
  process.env.IGPT_SESSION_DEVICE_ID = "device-1"
  process.env.IGPT_SESSION_BASE_URL = "https://igpt.ai/api/v1"
  process.env.IGPT_FALLBACK_ENABLED = "false"

  const calls: string[] = []
  const provider = new IGPTProvider({
    fetchImpl: (async (url: any) => {
      const u = String(url)
      calls.push(u)
      return {
        ok: true,
        json: async () => ({
          output: {
            json: {
              signals: [
                {
                  eventType: "RefundIssued",
                  primaryRef: "701-1111111-1111111",
                  amount: 19.99,
                  occurredAt: "2026-02-26T00:00:00.000Z",
                  confidence: 0.91,
                  payload: { status_text: "refund issued" },
                },
              ],
            },
          },
        }),
      } as any
    }) as any,
  })

  const result = await provider.analyzeEmail(sampleEmail)
  restoreEnv(original)

  assert(calls.length === 1, "session mode should call only one endpoint")
  assert(calls[0].includes("/api/v1/recall/ask/"), "session endpoint should be used")
  assert(result.length === 1, "session mode should parse one signal")
  assert(result[0].eventType === "amazon.refund_issued", "event type should normalize")
  assert(
    (result[0].payload as any)?._shadow_source === "igpt_session",
    "session payload should mark source"
  )
}

async function testAutoModeFallsBackToSessionAfterApiAuth(): Promise<void> {
  const original = snapshotEnv()
  process.env.IGPT_ENABLED = "true"
  process.env.IGPT_AUTH_MODE = "auto"
  process.env.IGPT_API_KEY = "api-key"
  process.env.IGPT_BASE_URL = "https://api.igpt.ai"
  process.env.IGPT_SESSION_FALLBACK_ENABLED = "true"
  process.env.IGPT_SESSION_TOKEN = "session-token"
  process.env.IGPT_SESSION_DEVICE_ID = "device-1"
  process.env.IGPT_SESSION_BASE_URL = "https://igpt.ai/api/v1"
  process.env.IGPT_FALLBACK_ENABLED = "false"

  const calls: string[] = []
  const provider = new IGPTProvider({
    fetchImpl: (async (url: any) => {
      const u = String(url)
      calls.push(u)
      if (u.includes("api.igpt.ai/v1/recall/ask")) {
        return {
          ok: true,
          json: async () => ({ error: "auth" }),
        } as any
      }
      if (u.includes("igpt.ai/api/v1/recall/ask/")) {
        return {
          ok: true,
          json: async () => ({
            output: {
              json: {
                signals: [
                  {
                    eventType: "manulife.claim_paid",
                    primaryRef: "CLM-123",
                    amount: 42.5,
                    confidence: 0.8,
                    payload: { claim_id: "CLM-123" },
                  },
                ],
              },
            },
          }),
        } as any
      }
      throw new Error(`unexpected url: ${u}`)
    }) as any,
  })

  const result = await provider.analyzeEmail(sampleEmail)
  restoreEnv(original)

  assert(calls.length === 2, "auto mode should try api key then session")
  assert(result.length === 1, "auto mode should return session signal")
  assert(result[0].eventType === "manulife.claim_paid", "session signal should be parsed")
}

async function testAutoModeSkipsSessionWithoutFallbackFlag(): Promise<void> {
  const original = snapshotEnv()
  process.env.IGPT_ENABLED = "true"
  process.env.IGPT_AUTH_MODE = "auto"
  process.env.IGPT_API_KEY = "api-key"
  process.env.IGPT_BASE_URL = "https://api.igpt.ai"
  process.env.IGPT_SESSION_FALLBACK_ENABLED = "false"
  process.env.IGPT_SESSION_TOKEN = "session-token"
  process.env.IGPT_SESSION_DEVICE_ID = "device-1"
  process.env.IGPT_SESSION_BASE_URL = "https://igpt.ai/api/v1"
  process.env.IGPT_FALLBACK_ENABLED = "false"

  const calls: string[] = []
  const provider = new IGPTProvider({
    fetchImpl: (async (url: any) => {
      const u = String(url)
      calls.push(u)
      return {
        ok: true,
        json: async () => ({ error: "auth" }),
      } as any
    }) as any,
  })

  const result = await provider.analyzeEmail(sampleEmail)
  restoreEnv(original)

  assert(calls.length === 1, "auto mode should only call api endpoint when session fallback disabled")
  assert(result.length === 0, "auto mode should return empty when api fails and no fallback")
}

async function testManulifeReviewDisabledFallsBackToBaseline(): Promise<void> {
  const original = snapshotEnv()
  process.env.IGPT_ENABLED = "false"
  delete process.env.IGPT_API_KEY

  const baseline = computeManulifeBaselineScore({
    beneficiary: "Rod Allen",
    claimType: "Dental",
    serviceDate: "2026-03-01",
    submitted: 120,
    paidTotal: 99,
  })
  const igpt = await reviewManulifeWithIGPT({
    normalizedText: "Claim Number: CLM-123\nAmount paid: $99",
    deterministicExtraction: { claim_id: "CLM-123" },
  })
  const review = buildAiReview({
    baselineScore: baseline,
    igptScore: igpt?.score ?? null,
    rationale: igpt?.rationale,
    flags: igpt?.flags,
    model: igpt?.model,
  })
  restoreEnv(original)

  assert(igpt === null, "disabled IGPT review should return null")
  assert(
    Math.abs(review.score - baseline) < 0.0001,
    "disabled IGPT should keep baseline score"
  )
  assert(review.igptScore === null, "disabled IGPT should leave igptScore null")
}

async function testManulifeReviewMalformedResponseFallsBackToBaseline(): Promise<void> {
  const original = snapshotEnv()
  const originalFetch = globalThis.fetch
  process.env.IGPT_ENABLED = "true"
  process.env.IGPT_API_KEY = "test-key"
  process.env.IGPT_BASE_URL = "https://api.igpt.ai"

  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ output: { json: { rationale: "missing score" } } }),
    }) as any) as any

  const baseline = computeManulifeBaselineScore({
    beneficiary: "Rod Allen",
    claimType: "Dental",
    serviceDate: "2026-03-01",
    submitted: 100,
    paidTotal: 90,
  })
  const igpt = await reviewManulifeWithIGPT({
    normalizedText: "Claim Number: CLM-123\nAmount paid: $90",
    deterministicExtraction: { claim_id: "CLM-123" },
  })
  const review = buildAiReview({
    baselineScore: baseline,
    igptScore: igpt?.score ?? null,
    rationale: igpt?.rationale,
    flags: igpt?.flags,
    model: igpt?.model,
  })

  globalThis.fetch = originalFetch
  restoreEnv(original)

  assert(igpt === null, "malformed IGPT review payload should return null")
  assert(
    Math.abs(review.score - baseline) < 0.0001,
    "malformed IGPT should keep baseline score"
  )
  assert(review.igptScore === null, "malformed IGPT should keep igptScore null")
}

function snapshotEnv(): Record<string, string | undefined> {
  return {
    IGPT_ENABLED: process.env.IGPT_ENABLED,
    IGPT_AUTH_MODE: process.env.IGPT_AUTH_MODE,
    IGPT_API_KEY: process.env.IGPT_API_KEY,
    IGPT_BASE_URL: process.env.IGPT_BASE_URL,
    IGPT_SESSION_FALLBACK_ENABLED: process.env.IGPT_SESSION_FALLBACK_ENABLED,
    IGPT_SESSION_TOKEN: process.env.IGPT_SESSION_TOKEN,
    IGPT_SESSION_DEVICE_ID: process.env.IGPT_SESSION_DEVICE_ID,
    IGPT_SESSION_BASE_URL: process.env.IGPT_SESSION_BASE_URL,
    IGPT_SESSION_USER_ID: process.env.IGPT_SESSION_USER_ID,
    IGPT_TIMEOUT_MS: process.env.IGPT_TIMEOUT_MS,
    IGPT_FALLBACK_ENABLED: process.env.IGPT_FALLBACK_ENABLED,
    AZURE_OPENAI_ENDPOINT: process.env.AZURE_OPENAI_ENDPOINT,
    AZURE_OPENAI_KEY: process.env.AZURE_OPENAI_KEY,
    AZURE_OPENAI_DEPLOYMENT: process.env.AZURE_OPENAI_DEPLOYMENT,
    AZURE_OPENAI_API_VERSION: process.env.AZURE_OPENAI_API_VERSION,
  }
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

async function main() {
  await testDisabledReturnsEmpty()
  await testMalformedJsonReturnsEmpty()
  await testJsonParseThrowsReturnsEmpty()
  await testAuthErrorFallsBackToAzureOpenAi()
  await testSessionModeReturnsSignalsFromOutputJson()
  await testAutoModeFallsBackToSessionAfterApiAuth()
  await testAutoModeSkipsSessionWithoutFallbackFlag()
  await testManulifeReviewDisabledFallsBackToBaseline()
  await testManulifeReviewMalformedResponseFallsBackToBaseline()
  console.log("igptProviderTest ok")
}

main().catch((error) => {
  console.error("igptProviderTest failed", error)
  process.exit(1)
})
