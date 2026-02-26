import { EmailIntelligenceProvider, IntelligenceEmailInput, StructuredSignal } from "./types.js"

type FetchLike = typeof fetch
type IGPTAuthMode = "auto" | "api_key" | "session"
type AnalyzeAttemptResult = {
  signals: StructuredSignal[]
  reason?: string
  raw?: unknown
}

export class IGPTProvider implements EmailIntelligenceProvider {
  private readonly fetchImpl: FetchLike

  constructor(params?: { fetchImpl?: FetchLike }) {
    this.fetchImpl = params?.fetchImpl ?? fetch
  }

  async analyzeEmail(email: IntelligenceEmailInput): Promise<StructuredSignal[]> {
    if ((process.env.IGPT_ENABLED ?? "false").toLowerCase() !== "true") {
      return []
    }

    const authMode = getIGPTAuthMode(process.env.IGPT_AUTH_MODE)
    const reasons: string[] = []

    if (authMode !== "session") {
      const apiResult = await this.analyzeWithApiKey(email)
      if (apiResult.signals.length > 0) {
        return apiResult.signals
      }
      if (apiResult.reason) {
        reasons.push(apiResult.reason)
      }
      if (authMode === "api_key") {
        return this.tryFallback(email, {
          reason: reasons[reasons.length - 1] ?? "igpt_empty",
          raw: apiResult.raw,
        })
      }
    }

    const sessionResult = await this.analyzeWithSessionToken(email)
    if (sessionResult.signals.length > 0) {
      return sessionResult.signals
    }
    if (sessionResult.reason) {
      reasons.push(sessionResult.reason)
    }
    if (authMode === "session") {
      return this.tryFallback(email, {
        reason: reasons[reasons.length - 1] ?? "igpt_session_empty",
        raw: sessionResult.raw,
      })
    }

    return this.tryFallback(email, { reason: reasons[reasons.length - 1] ?? "igpt_empty" })
  }

  private async analyzeWithApiKey(email: IntelligenceEmailInput): Promise<AnalyzeAttemptResult> {
    const apiKey = (process.env.IGPT_API_KEY ?? "").trim()
    if (!apiKey) {
      return { signals: [], reason: "missing_igpt_api_key" }
    }

    const baseUrl = (process.env.IGPT_BASE_URL ?? "https://api.igpt.ai")
      .trim()
      .replace(/\/+$/, "")
    const timeoutMs = clampTimeout(process.env.IGPT_TIMEOUT_MS)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await this.fetchImpl(`${baseUrl}/v1/recall/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          user: "signal_engine",
          input: buildIGPTPrompt(email),
          stream: false,
          quality: "cef-1-normal",
          output_format: "json",
          metadata: {
            email_id: email.emailId,
            provider: email.provider,
            mail_account_id: email.mailAccountId,
            subject: email.subject,
            received_at: email.receivedAt.toISOString(),
          },
        }),
      })

      if (!response.ok) {
        return { signals: [], reason: `igpt_http_${response.status}` }
      }

      const data = await response.json().catch(() => null)
      if (isAuthErrorPayload(data)) {
        return { signals: [], reason: "igpt_auth_error", raw: data }
      }

      const signals = parseSignalsFromResponse(data)
      if (signals.length > 0) {
        return { signals }
      }

      return { signals: [], reason: "igpt_empty", raw: data }
    } catch {
      return { signals: [], reason: "igpt_fetch_error" }
    } finally {
      clearTimeout(timer)
    }
  }

  private async analyzeWithSessionToken(
    email: IntelligenceEmailInput
  ): Promise<AnalyzeAttemptResult> {
    const sessionToken = (process.env.IGPT_SESSION_TOKEN ?? "").trim()
    if (!sessionToken) {
      return { signals: [], reason: "missing_igpt_session_token" }
    }

    const sessionDeviceId = (process.env.IGPT_SESSION_DEVICE_ID ?? "").trim()
    if (!sessionDeviceId) {
      return { signals: [], reason: "missing_igpt_session_device_id" }
    }

    const sessionBaseUrl = (
      process.env.IGPT_SESSION_BASE_URL ?? "https://igpt.ai/api/v1"
    )
      .trim()
      .replace(/\/+$/, "")

    const timeoutMs = clampTimeout(process.env.IGPT_TIMEOUT_MS)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await this.fetchImpl(`${sessionBaseUrl}/recall/ask/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-token": sessionToken,
          "x-deviceId": sessionDeviceId,
        },
        signal: controller.signal,
        body: JSON.stringify({
          user:
            (process.env.IGPT_SESSION_USER_ID ?? "").trim() ||
            `signal_engine_mail_${email.mailAccountId}`,
          input: buildIGPTPrompt(email),
          stream: false,
          quality: "cef-1-normal",
          output_format: "json",
        }),
      })

      if (!response.ok) {
        return { signals: [], reason: `igpt_session_http_${response.status}` }
      }

      const data = await response.json().catch(() => null)
      if (isAuthErrorPayload(data)) {
        return { signals: [], reason: "igpt_session_auth_error", raw: data }
      }

      const signals = parseSignalsFromResponse(data).map((signal) => ({
        ...signal,
        payload: {
          ...(asRecord(signal.payload) ?? { value: signal.payload }),
          _shadow_source: "igpt_session",
        },
      }))
      if (signals.length > 0) {
        return { signals }
      }

      return { signals: [], reason: "igpt_session_empty", raw: data }
    } catch {
      return { signals: [], reason: "igpt_session_fetch_error" }
    } finally {
      clearTimeout(timer)
    }
  }

  private async tryFallback(
    email: IntelligenceEmailInput,
    context: { reason: string; raw?: unknown }
  ): Promise<StructuredSignal[]> {
    if ((process.env.IGPT_FALLBACK_ENABLED ?? "false").toLowerCase() !== "true") {
      return []
    }
    if (!looksLikeSupportedDomain(email)) {
      return []
    }

    const config = getAzureFallbackConfig()
    if (!config) {
      return []
    }

    const controller = new AbortController()
    const timeoutMs = clampTimeout(process.env.IGPT_TIMEOUT_MS)
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await this.fetchImpl(
        `${config.endpoint}/openai/deployments/${config.deployment}/chat/completions?api-version=${config.apiVersion}`,
        {
          method: "POST",
          signal: controller.signal,
          headers: {
            "api-key": config.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages: [
              {
                role: "system",
                content:
                  "Extract Amazon return/refund and Manulife claim signals from email text. Return strict JSON object with key 'signals' (array). If none, return {\"signals\":[]}.",
              },
              {
                role: "user",
                content: buildFallbackPrompt(email, context.reason),
              },
            ],
            temperature: 0,
            max_tokens: 700,
            response_format: { type: "json_object" },
          }),
        }
      )
      if (!response.ok) {
        return []
      }
      const payload = await response.json().catch(() => null)
      const content = payload?.choices?.[0]?.message?.content
      if (typeof content !== "string") {
        return []
      }
      const parsed = parseJsonObject(content)
      if (!parsed) {
        return []
      }
      return parseSignals(parsed).map((signal) => ({
        ...signal,
        payload: {
          ...(asRecord(signal.payload) ?? { value: signal.payload }),
          _shadow_source: "openai_fallback",
          _fallback_reason: context.reason,
        },
      }))
    } catch {
      return []
    } finally {
      clearTimeout(timer)
    }
  }
}

function clampTimeout(value: string | undefined): number {
  const parsed = Number(value ?? "")
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 5000
  }
  return Math.max(500, Math.min(30000, Math.floor(parsed)))
}

function getIGPTAuthMode(raw: string | undefined): IGPTAuthMode {
  const value = (raw ?? "auto").trim().toLowerCase()
  if (value === "api_key" || value === "session") {
    return value
  }
  return "auto"
}

type AzureFallbackConfig = {
  endpoint: string
  apiKey: string
  deployment: string
  apiVersion: string
}

function getAzureFallbackConfig(): AzureFallbackConfig | null {
  const endpoint = (process.env.AZURE_OPENAI_ENDPOINT ?? "").trim().replace(/\/+$/, "")
  const apiKey = (process.env.AZURE_OPENAI_KEY ?? "").trim()
  const deployment = (process.env.AZURE_OPENAI_DEPLOYMENT ?? "").trim()
  const apiVersion = (process.env.AZURE_OPENAI_API_VERSION ?? "2024-02-15-preview").trim()
  if (!endpoint || !apiKey || !deployment) {
    return null
  }
  return { endpoint, apiKey, deployment, apiVersion }
}

function looksLikeSupportedDomain(email: IntelligenceEmailInput): boolean {
  const haystack = `${email.subject}\n${email.normalizedText}`.toLowerCase()
  return (
    haystack.includes("amazon") ||
    haystack.includes("return") ||
    haystack.includes("refund") ||
    haystack.includes("manulife") ||
    haystack.includes("claim")
  )
}

function buildIGPTPrompt(email: IntelligenceEmailInput): string {
  return [
    "Extract Amazon return/refund and Manulife claim signals from email text.",
    "Return strict JSON object with key 'signals' (array). If none, return {\"signals\":[]}.",
    "Use canonical eventType values only:",
    "amazon.return_requested, amazon.return_dropped_off, amazon.refund_issued, manulife.claim_received, manulife.claim_processed, manulife.claim_paid, manulife.claim_denied, manulife.claim_info_required, manulife.claim_status_update.",
    "Each signal: {eventType, primaryRef, amount, occurredAt, confidence, payload}.",
    "",
    `Email id: ${email.emailId}`,
    `Provider: ${email.provider}`,
    `Mail account id: ${email.mailAccountId}`,
    `Received at: ${email.receivedAt.toISOString()}`,
    `From: ${email.fromAddress ?? ""}`,
    `Subject: ${email.subject}`,
    "",
    "Email text:",
    email.normalizedText,
  ].join("\n")
}

function buildFallbackPrompt(email: IntelligenceEmailInput, fallbackReason: string): string {
  return [
    `Fallback reason: ${fallbackReason}`,
    `Email id: ${email.emailId}`,
    `Provider: ${email.provider}`,
    `Mail account id: ${email.mailAccountId}`,
    `Received at: ${email.receivedAt.toISOString()}`,
    `Subject: ${email.subject}`,
    "",
    "Return JSON only.",
    "Expected shape:",
    JSON.stringify(
      {
        signals: [
          {
            eventType:
              "amazon.return_requested | amazon.return_dropped_off | amazon.refund_issued | manulife.claim_received | manulife.claim_processed | manulife.claim_paid | manulife.claim_denied | manulife.claim_info_required | manulife.claim_status_update",
            primaryRef: "order_id or claim_id when present",
            amount: "number optional",
            occurredAt: "ISO timestamp optional",
            confidence: "0..1 optional",
            payload: {},
          },
        ],
      },
      null,
      2
    ),
    "",
    "Email text:",
    email.normalizedText,
  ].join("\n")
}

function parseJsonObject(content: string): unknown | null {
  const text = content.trim()
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) {
    return null
  }
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

function isAuthErrorPayload(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") {
    return false
  }
  const obj = raw as Record<string, unknown>
  const error = asString(obj.error)?.toLowerCase()
  return error === "auth" || error === "unauthorized" || error === "invalid_api_key"
}

function parseSignals(raw: unknown): StructuredSignal[] {
  const candidates = collectCandidates(raw)
  const signals: StructuredSignal[] = []

  for (const candidate of candidates) {
    const parsed = parseSignalCandidate(candidate)
    if (parsed) {
      signals.push(parsed)
    }
  }

  return signals
}

function parseSignalsFromResponse(raw: unknown): StructuredSignal[] {
  const directSignals = parseSignals(raw)
  if (directSignals.length > 0) {
    return directSignals
  }

  const obj = asRecord(raw)
  if (!obj) {
    return []
  }

  const output = obj.output
  const outputRecord = asRecord(output)
  if (outputRecord) {
    const nestedSignals = [
      parseSignals(outputRecord),
      parseSignals(outputRecord.json),
      parseSignals(outputRecord.data),
      parseSignals(outputRecord.result),
    ]
    for (const candidate of nestedSignals) {
      if (candidate.length > 0) {
        return candidate
      }
    }
  }

  const outputText = asString(output)
  if (outputText) {
    const parsedOutput = parseJsonObject(outputText)
    if (parsedOutput) {
      const outputSignals = parseSignals(parsedOutput)
      if (outputSignals.length > 0) {
        return outputSignals
      }
    }
  }

  return []
}

function collectCandidates(raw: unknown): unknown[] {
  if (Array.isArray(raw)) {
    return raw
  }
  if (!raw || typeof raw !== "object") {
    return []
  }

  const obj = raw as Record<string, unknown>
  for (const key of ["signals", "events", "candidates", "results", "data"]) {
    const value = obj[key]
    if (Array.isArray(value)) {
      return value
    }
  }

  return [obj]
}

function parseSignalCandidate(candidate: unknown): StructuredSignal | null {
  if (!candidate || typeof candidate !== "object") {
    return null
  }

  const obj = candidate as Record<string, unknown>
  const nested = asRecord(obj.payload) ?? asRecord(obj.signal) ?? asRecord(obj.event)

  const eventTypeRaw =
    asString(obj.eventType) ??
    asString(obj.event_type) ??
    asString(obj.type) ??
    asString(obj.name) ??
    (nested
      ? asString(nested.eventType) ??
        asString(nested.event_type) ??
        asString(nested.type) ??
        asString(nested.name)
      : undefined)

  if (!eventTypeRaw) {
    return null
  }

  const eventType = normalizeEventType(eventTypeRaw)

  const primaryRef =
    asString(obj.primaryRef) ??
    asString(obj.primary_ref) ??
    asString(obj.order_id) ??
    asString(obj.claim_id) ??
    asString(obj.return_id) ??
    asString(obj.ref) ??
    asString(obj.reference) ??
    (nested
      ? asString(nested.primaryRef) ??
        asString(nested.primary_ref) ??
        asString(nested.order_id) ??
        asString(nested.claim_id) ??
        asString(nested.return_id) ??
        asString(nested.ref) ??
        asString(nested.reference)
      : undefined)

  const amount =
    asNumber(obj.amount) ??
    asNumber(obj.amount_total) ??
    asNumber(obj.refund_amount) ??
    asNumber(obj.refund_total_estimated) ??
    asNumber(obj.refund_amount_issued) ??
    (nested
      ? asNumber(nested.amount) ??
        asNumber(nested.amount_total) ??
        asNumber(nested.refund_amount) ??
        asNumber(nested.refund_total_estimated) ??
        asNumber(nested.refund_amount_issued)
      : undefined)

  const occurredAt =
    asIsoString(obj.occurredAt) ??
    asIsoString(obj.occurred_at) ??
    asIsoString(obj.date) ??
    asIsoString(obj.timestamp) ??
    asIsoString(obj.received_at) ??
    (nested
      ? asIsoString(nested.occurredAt) ??
        asIsoString(nested.occurred_at) ??
        asIsoString(nested.date) ??
        asIsoString(nested.timestamp) ??
        asIsoString(nested.received_at)
      : undefined)

  const confidence =
    asNumber(obj.confidence) ??
    asNumber(obj.score) ??
    asNumber(obj.probability) ??
    (nested
      ? asNumber(nested.confidence) ??
        asNumber(nested.score) ??
        asNumber(nested.probability)
      : undefined)

  return {
    eventType,
    primaryRef,
    amount,
    occurredAt,
    payload: obj,
    confidence,
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, unknown>
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string") {
    const normalized = value.replace(/[^0-9.-]/g, "")
    const parsed = Number(normalized)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return undefined
}

function asIsoString(value: unknown): string | undefined {
  const raw = asString(value)
  if (!raw) {
    return undefined
  }
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) {
    return undefined
  }
  return parsed.toISOString()
}

function normalizeEventType(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "")
  switch (normalized) {
    case "amazonreturnrequested":
    case "returnrequested":
    case "returnrequestconfirmed":
      return "amazon.return_requested"
    case "amazonreturndroppedoff":
    case "returndroppedoff":
    case "returndropoff":
    case "dropoffconfirmed":
      return "amazon.return_dropped_off"
    case "amazonrefundissued":
    case "refundissued":
    case "refundprocessed":
    case "refundcompleted":
      return "amazon.refund_issued"
    case "manulifeclaimreceived":
    case "claimreceived":
      return "manulife.claim_received"
    case "manulifeclaimprocessed":
    case "claimprocessed":
      return "manulife.claim_processed"
    case "manulifeclaimpaid":
    case "claimpaid":
      return "manulife.claim_paid"
    case "manulifeclaimdenied":
    case "claimdenied":
      return "manulife.claim_denied"
    case "manulifeclaiminforequired":
    case "claiminforequired":
      return "manulife.claim_info_required"
    case "manulifeclaimstatusupdate":
    case "claimstatusupdate":
      return "manulife.claim_status_update"
    default:
      return value
  }
}
