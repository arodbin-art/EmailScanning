import { MoneyRecoveryClient } from "./moneyRecoveryClient.js"

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message)
  }
}

type Call = { url: string; method: string; body?: any }

async function testCreateWhenNoMatchAndPersonCode(): Promise<void> {
  const calls: Call[] = []
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url)
    calls.push({ url: u, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : undefined })

    if (u.includes("/rvi/external-references/lookup")) return mkRes(404, { error: "not found" })
    if (u.includes("/rvi/returns/candidates")) return mkRes(200, { data: [] })
    if (u.endsWith("/rvi")) return mkRes(201, { id: 901 })
    if (u.includes("/rvi/901/external-references")) return mkRes(200, { ok: true })
    if (u.endsWith("/rvi/901")) {
      if ((init?.method ?? "GET") === "GET") {
        return mkRes(200, {
          id: 901,
          amount_total: 0,
          override_deadline_date: null,
          memo: "",
          flows: [{ id: 301, type: "return", status: "ready" }],
        })
      }
      return mkRes(200, { ok: true })
    }

    return mkRes(500, { error: "unexpected", url: u })
  }) as any

  const client = new MoneyRecoveryClient({ baseUrl: "https://example.test", bearerToken: "x", timeoutMs: 1000 })
  const result = await client.deliverOutboxEvent({
    eventId: 1,
    eventType: "amazon.return_requested",
    sourceEmailId: 11,
    mailAccountId: 2,
    mailAccountPersonCode: "ROD",
    payload: {
      order_id: "702-9059320-9056262",
      amount_total: 124.85,
      drop_off_by: "2026-03-13",
      item_title: "AGM M8 Rugged Basic Flip Phone, 4G",
      email: { received_at: "2026-02-18T20:00:00.000Z", subject: "Your return request is confirmed" },
    },
  })

  assert(result.status === "accepted", `expected accepted, got ${result.status}`)
  assert(calls.some((c) => c.url.endsWith("/rvi") && c.method === "POST"), "expected create RVI")
  assert(calls.some((c) => c.url.includes("/rvi/901/external-references")), "expected external ref link")
  assert(
    calls.some((c) => c.url.endsWith("/rvi/901") && c.method === "PATCH"),
    "expected return-request update on rvi"
  )
}

async function testReplayDoesNotDuplicateCreate(): Promise<void> {
  const calls: Call[] = []
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url)
    calls.push({ url: u, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : undefined })

    if (u.includes("/rvi/external-references/lookup")) return mkRes(200, { rvi_id: 901 })
    if (u.includes("/rvi/901/external-references")) return mkRes(200, { ok: true })
    if (u.endsWith("/rvi/901")) {
      if ((init?.method ?? "GET") === "GET") {
        return mkRes(200, {
          id: 901,
          amount_total: 124.85,
          override_deadline_date: "2026-03-13",
          memo: "[Amazon] AGM M8 Rugged Basic Flip Phone, 4G",
          flows: [{ id: 301, type: "return", status: "ready" }],
        })
      }
      return mkRes(200, { ok: true })
    }

    return mkRes(500, { error: "unexpected", url: u })
  }) as any

  const client = new MoneyRecoveryClient({ baseUrl: "https://example.test", bearerToken: "x", timeoutMs: 1000 })
  const result = await client.deliverOutboxEvent({
    eventId: 2,
    eventType: "amazon.return_requested",
    sourceEmailId: 12,
    mailAccountId: 2,
    mailAccountPersonCode: "ROD",
    payload: {
      order_id: "702-9059320-9056262",
      amount_total: 124.85,
      drop_off_by: "2026-03-13",
      item_title: "AGM M8 Rugged Basic Flip Phone, 4G",
      email: { received_at: "2026-02-18T20:00:00.000Z", subject: "Your return request is confirmed" },
    },
  })

  assert(result.status === "accepted", `expected accepted, got ${result.status}`)
  assert(!calls.some((c) => c.url.endsWith("/rvi") && c.method === "POST"), "should not create duplicate RVI")
  assert(
    !calls.some((c) => c.url.endsWith("/rvi/901") && c.method === "PATCH"),
    "replay should be idempotent when fields already match"
  )
}

async function testNeedsReviewWhenPersonCodeMissing(): Promise<void> {
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url)
    if (u.includes("/rvi/external-references/lookup")) return mkRes(404, { error: "not found" })
    if (u.includes("/rvi/returns/candidates")) return mkRes(200, { data: [] })
    return mkRes(500, { error: "unexpected", url: u, method: init?.method })
  }) as any

  const client = new MoneyRecoveryClient({ baseUrl: "https://example.test", bearerToken: "x", timeoutMs: 1000 })
  const result = await client.deliverOutboxEvent({
    eventId: 3,
    eventType: "amazon.return_requested",
    sourceEmailId: 13,
    mailAccountId: 7,
    mailAccountPersonCode: null,
    payload: {
      order_id: "701-1111111-2222222",
      amount_total: 12.34,
      email: { received_at: "2026-02-18T20:00:00.000Z" },
    },
  })

  assert(result.status === "needs_review", `expected needs_review, got ${result.status}`)
  assert((result.raw as any)?.reason === "missing_person_code_mapping_for_mail_account", "expected missing mapping reason")
}

async function testRefundIssuedArrivesFirst(): Promise<void> {
  const calls: Call[] = []
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url)
    calls.push({ url: u, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : undefined })

    if (u.includes("/rvi/external-references/lookup")) return mkRes(404, { error: "not found" })
    if (u.includes("/rvi/returns/candidates")) return mkRes(200, { data: [] })
    if (u.endsWith("/rvi")) return mkRes(201, { id: 777 })
    if (u.includes("/rvi/777/external-references")) return mkRes(200, { ok: true })
    if (u.endsWith("/rvi/777")) return mkRes(200, { flows: [{ id: 888, type: "return" }] })
    if (u.includes("/return-flows/888/refund-detected")) return mkRes(200, { ok: true })

    return mkRes(500, { error: "unexpected", url: u })
  }) as any

  const client = new MoneyRecoveryClient({ baseUrl: "https://example.test", bearerToken: "x", timeoutMs: 1000 })
  const result = await client.deliverOutboxEvent({
    eventId: 4,
    eventType: "amazon.refund_issued",
    sourceEmailId: 14,
    mailAccountId: 4,
    mailAccountPersonCode: "ROD",
    payload: {
      order_id: "701-1111111-2222222",
      refund_amount: 45.19,
      email: { received_at: "2026-02-18T20:00:00.000Z" },
    },
  })

  assert(result.status === "accepted", `expected accepted, got ${result.status}`)
  assert(calls.some((c) => c.url.endsWith("/rvi") && c.method === "POST"), "expected create when refund arrives first")
  assert(
    calls.some((c) => c.url.includes("/return-flows/888/refund-detected")),
    "expected refund-detected call"
  )
}

async function testManulifeClaimPaidUpdatesClaimFlow(): Promise<void> {
  const calls: Call[] = []
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url)
    calls.push({ url: u, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : undefined })
    if (u.includes("/rvi/external-references/lookup")) return mkRes(200, { rvi_id: 501 })
    if (u.includes("/rvi/501/external-references")) return mkRes(200, { ok: true })
    if (u.endsWith("/rvi/501")) {
      return mkRes(200, {
        id: 501,
        flows: [
          {
            id: 77,
            type: "claim",
            sequence_order: 1,
            amount_submitted: 30,
            amount_paid: 0,
          },
        ],
      })
    }
    if (u.includes("/claim-flows/77")) return mkRes(200, { ok: true })
    return mkRes(500, { error: "unexpected", url: u, method: init?.method })
  }) as any

  const client = new MoneyRecoveryClient({ baseUrl: "https://example.test", bearerToken: "x", timeoutMs: 1000 })
  const result = await client.deliverOutboxEvent({
    eventId: 5,
    eventType: "manulife.claim_paid",
    sourceEmailId: 15,
    mailAccountId: 4,
    mailAccountPersonCode: "ROD",
    payload: {
      claim_id: "CLM-998877",
      status_text: "paid",
      amounts: { amount_paid: 45.5, amount_eligible: 45.5 },
      dates: { paid_at: "2026-02-20" },
      email: { received_at: "2026-02-20T10:00:00.000Z" },
    },
  })

  assert(result.status === "accepted", `expected accepted, got ${result.status}`)
  assert(
    calls.some((c) => c.url.includes("/claim-flows/77") && c.method === "PATCH"),
    "claim paid should patch claim flow"
  )
}

async function testManulifeStatusUpdateNeedsReview(): Promise<void> {
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url)
    if (u.includes("/rvi/external-references/lookup")) return mkRes(200, { rvi_id: 501 })
    if (u.includes("/rvi/501/external-references")) return mkRes(200, { ok: true })
    return mkRes(500, { error: "unexpected", url: u, method: init?.method })
  }) as any

  const client = new MoneyRecoveryClient({ baseUrl: "https://example.test", bearerToken: "x", timeoutMs: 1000 })
  const result = await client.deliverOutboxEvent({
    eventId: 6,
    eventType: "manulife.claim_status_update",
    sourceEmailId: 16,
    mailAccountId: 4,
    mailAccountPersonCode: "ROD",
    payload: {
      claim_id: "CLM-998877",
      status_text: "pending review",
      amounts: { amount_claimed: 100 },
    },
  })

  assert(result.status === "needs_review", `expected needs_review, got ${result.status}`)
}

async function main() {
  await testCreateWhenNoMatchAndPersonCode()
  await testReplayDoesNotDuplicateCreate()
  await testNeedsReviewWhenPersonCodeMissing()
  await testRefundIssuedArrivesFirst()
  await testManulifeClaimPaidUpdatesClaimFlow()
  await testManulifeStatusUpdateNeedsReview()
  console.log("moneyRecoveryClientTest ok")
}

function mkRes(status: number, body: any) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body)
    },
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
