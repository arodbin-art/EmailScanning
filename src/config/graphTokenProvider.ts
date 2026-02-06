import { AccessTokenProvider } from "../ingestion/types.js"
import { MailAccount } from "@prisma/client"

type TokenCache = {
  accessToken: string
  expiresAt: number
}

export class EnvGraphTokenProvider implements AccessTokenProvider {
  private cache: TokenCache | null = null

  async getAccessToken(_account: MailAccount): Promise<string> {
    const clientId = process.env.GRAPH_CLIENT_ID
    const clientSecret = process.env.GRAPH_CLIENT_SECRET
    const tenantId = process.env.GRAPH_TENANT_ID

    if (clientId && clientSecret && tenantId) {
      return this.getClientCredentialsToken(clientId, clientSecret, tenantId)
    }

    const token = process.env.GRAPH_ACCESS_TOKEN
    if (!token) {
      throw new Error(
        "GRAPH_ACCESS_TOKEN or GRAPH_CLIENT_ID/GRAPH_CLIENT_SECRET/GRAPH_TENANT_ID is required for Microsoft Graph access"
      )
    }
    return token
  }

  private async getClientCredentialsToken(clientId: string, clientSecret: string, tenantId: string): Promise<string> {
    const now = Date.now()
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.accessToken
    }

    const scope = process.env.GRAPH_SCOPE ?? "https://graph.microsoft.com/.default"
    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope,
      grant_type: "client_credentials",
    })

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Graph token request failed: ${response.status} ${response.statusText} ${text}`)
    }

    const payload = (await response.json()) as { access_token: string; expires_in?: number }
    if (!payload.access_token) {
      throw new Error("Graph token response missing access_token")
    }

    const expiresIn = payload.expires_in ?? 3600
    this.cache = {
      accessToken: payload.access_token,
      expiresAt: now + Math.max(60, expiresIn - 60) * 1000,
    }
    return payload.access_token
  }
}
