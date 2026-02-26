type TokenProvider = () => Promise<string | undefined>
type DeliveryAuthMode = "client_credentials" | "static"

type CachedToken = {
  token: string
  expiresAtEpochMs: number
}

const CLOCK_SKEW_MS = 2 * 60 * 1000

export function createDeliveryTokenProviderFromEnv(): TokenProvider | undefined {
  const mode = readDeliveryAuthMode(process.env.RVI_AUTH_MODE)
  const staticAllowed = isTrue(process.env.RVI_STATIC_BEARER_ALLOW)

  if (mode === "static") {
    if (!staticAllowed) {
      throw new Error(
        "RVI static bearer mode is disabled by default. Set RVI_STATIC_BEARER_ALLOW=true only for emergency fallback."
      )
    }
    return undefined
  }

  const tenantId =
    process.env.RVI_AUTH_TENANT_ID?.trim() ||
    process.env.ENTRA_TENANT_ID?.trim() ||
    process.env.GRAPH_TENANT_ID?.trim()
  const clientId =
    process.env.RVI_AUTH_CLIENT_ID?.trim() ||
    process.env.ENTRA_CLIENT_ID?.trim() ||
    process.env.GRAPH_CLIENT_ID?.trim()
  const clientSecret =
    process.env.RVI_AUTH_CLIENT_SECRET?.trim() ||
    process.env.ENTRA_CLIENT_SECRET?.trim() ||
    process.env.GRAPH_CLIENT_SECRET?.trim()
  const resource =
    process.env.RVI_AUTH_RESOURCE?.trim() ||
    process.env.RVI_AUTH_AUDIENCE?.trim() ||
    process.env.ENTRA_API_SCOPE?.trim()?.split("/").slice(0, 3).join("/") ||
    inferResourceFromBearerToken(process.env.RVI_BEARER_TOKEN) ||
    inferResourceFromBaseUrl()

  if (!tenantId || !clientId || !clientSecret || !resource) {
    const missing: string[] = []
    if (!tenantId) missing.push("RVI_AUTH_TENANT_ID (or ENTRA/GRAPH tenant id)")
    if (!clientId) missing.push("RVI_AUTH_CLIENT_ID (or ENTRA/GRAPH client id)")
    if (!clientSecret) missing.push("RVI_AUTH_CLIENT_SECRET (or ENTRA/GRAPH client secret)")
    if (!resource) missing.push("RVI_AUTH_RESOURCE (or ENTRA_API_SCOPE/API client id)")
    throw new Error(
      `RVI client-credentials auth requires: ${missing.join(", ")}`
    )
  }

  const fetcher = new EntraClientCredentialsTokenProvider({
    tenantId,
    clientId,
    clientSecret,
    resource,
  })
  return () => fetcher.getToken()
}

function readDeliveryAuthMode(raw: string | undefined): DeliveryAuthMode {
  const value = (raw ?? "client_credentials").trim().toLowerCase()
  if (value === "static") return "static"
  return "client_credentials"
}

function isTrue(value: string | undefined): boolean {
  return (value ?? "").trim().toLowerCase() === "true"
}

class EntraClientCredentialsTokenProvider {
  private readonly tenantId: string
  private readonly clientId: string
  private readonly clientSecret: string
  private readonly resource: string
  private cached?: CachedToken

  constructor(params: {
    tenantId: string
    clientId: string
    clientSecret: string
    resource: string
  }) {
    this.tenantId = params.tenantId
    this.clientId = params.clientId
    this.clientSecret = params.clientSecret
    this.resource = params.resource
  }

  async getToken(): Promise<string> {
    if (this.cached && Date.now() + CLOCK_SKEW_MS < this.cached.expiresAtEpochMs) {
      return this.cached.token
    }

    const v2 = await this.fetchTokenV2()
    if (hasAppAssignment(v2.token)) {
      this.cached = v2
      return v2.token
    }

    // Some tenants/API configs only materialize app roles in v1 resource tokens.
    const v1 = await this.fetchTokenV1()
    this.cached = v1
    return v1.token
  }

  private async fetchTokenV2(): Promise<CachedToken> {
    const url = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "client_credentials",
      scope: `${this.resource}/.default`,
    })
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    })
    const payload = await response.json()
    if (!response.ok || typeof payload?.access_token !== "string") {
      throw new Error(`Failed to obtain Entra token (v2): ${JSON.stringify(payload)}`)
    }
    return {
      token: payload.access_token,
      expiresAtEpochMs: deriveExpiryMs(payload.access_token, payload.expires_in),
    }
  }

  private async fetchTokenV1(): Promise<CachedToken> {
    const url = `https://login.microsoftonline.com/${this.tenantId}/oauth2/token`
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "client_credentials",
      resource: this.resource,
    })
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    })
    const payload = await response.json()
    if (!response.ok || typeof payload?.access_token !== "string") {
      throw new Error(`Failed to obtain Entra token (v1): ${JSON.stringify(payload)}`)
    }
    return {
      token: payload.access_token,
      expiresAtEpochMs: deriveExpiryMs(payload.access_token, payload.expires_in),
    }
  }
}

function deriveExpiryMs(token: string, expiresIn?: unknown): number {
  const claims = decodeJwtPayload(token)
  const exp = typeof claims?.exp === "number" ? claims.exp * 1000 : null
  if (exp) return exp
  const seconds = typeof expiresIn === "number" ? expiresIn : Number(expiresIn)
  if (Number.isFinite(seconds)) return Date.now() + seconds * 1000
  return Date.now() + 45 * 60 * 1000
}

function hasAppAssignment(token: string): boolean {
  const claims = decodeJwtPayload(token)
  if (!claims || typeof claims !== "object") return false
  const roles = (claims as any).roles
  if (Array.isArray(roles) && roles.length > 0) return true
  const scp = (claims as any).scp
  return typeof scp === "string" && scp.trim().length > 0
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".")
  if (parts.length < 2) return null
  try {
    const payload = Buffer.from(parts[1], "base64url").toString("utf8")
    return JSON.parse(payload) as Record<string, unknown>
  } catch {
    return null
  }
}

function inferResourceFromBaseUrl(): string {
  const scope = process.env.ENTRA_API_SCOPE?.trim()
  if (scope && scope.startsWith("api://")) {
    return scope.split("/").slice(0, 3).join("/")
  }
  const apiClientId = process.env.ENTRA_API_CLIENT_ID?.trim()
  if (apiClientId) {
    return `api://${apiClientId}`
  }
  return ""
}

function inferResourceFromBearerToken(token: string | undefined): string {
  if (!token) return ""
  const claims = decodeJwtPayload(token)
  const aud = typeof claims?.aud === "string" ? claims.aud.trim() : ""
  if (aud.startsWith("api://")) {
    return aud
  }
  return ""
}
