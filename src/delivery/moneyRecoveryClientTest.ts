import { MoneyRecoveryClient } from "./moneyRecoveryClient.js"

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message)
  }
}

async function main() {
  const calls: Array<{ url: string; method: string; body?: any }> = []

  // Minimal fetch mock for a happy-path: lookup -> 404 -> candidates 1 -> upsert ref -> rvi detail -> refund.
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : undefined })

    const u = String(url)
    if (u.includes("/rvi/external-references/lookup")) {
      return mkRes(404, { error: "not found" })
    }
    if (u.includes("/rvi/returns/candidates")) {
      return mkRes(200, { data: [{ id: 123, return_flow_id: 456 }] })
    }
    if (u.includes("/rvi/123/external-references")) {
      return mkRes(200, { rvi_id: 123, source: "signal-engine", ref_type: "amazon_order_id", ref_value: "701-1111111-2222222" })
    }
    if (u.endsWith("/rvi/123")) {
      return mkRes(200, { flows: [{ id: 456, type: "return" }] })
    }
    if (u.includes("/return-flows/456/refund")) {
      return mkRes(200, { ok: true })
    }
    if (u.includes("/return-flows/456")) {
      return mkRes(200, { ok: true })
    }

    return mkRes(500, { error: "unexpected", url: u })
  }) as any

  const client = new MoneyRecoveryClient({ baseUrl: "https://example.test", bearerToken: "x", timeoutMs: 1000 })
  const result = await client.deliverOutboxEvent({
    eventType: "amazon.refund_issued",
    payload: {
      order_id: "701-1111111-2222222",
      refund_amount: 12.34,
      email: { received_at: "2026-02-07T00:00:00.000Z" },
    },
  })

  assert(result.status === "accepted", `expected accepted, got ${result.status}`)
  assert(calls.some((c) => c.url.includes("/rvi/returns/candidates")), "expected candidates lookup")
  assert(calls.some((c) => c.url.includes("/rvi/123/external-references")), "expected external ref upsert")
  assert(calls.some((c) => c.url.includes("/return-flows/456/refund")), "expected refund call")

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

