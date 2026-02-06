import { google } from "googleapis"
import { GmailTokenStore } from "../../auth/gmailTokenStore.js"

type GmailClientConfig = {
  clientId: string
  clientSecret: string
  redirectUri: string
  tokenStore: GmailTokenStore
}

type RequestContext = {
  credentialRef: string
  userId: string
}

export class GmailClient {
  private readonly oauth2
  private readonly gmail
  private readonly tokenStore: GmailTokenStore

  constructor(config: GmailClientConfig) {
    this.oauth2 = new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri)
    this.gmail = google.gmail({ version: "v1", auth: this.oauth2 })
    this.tokenStore = config.tokenStore
  }

  async getAccessToken(credentialRef: string): Promise<string> {
    const refreshToken = await this.tokenStore.getRefreshToken(credentialRef)
    this.oauth2.setCredentials({ refresh_token: refreshToken })
    const tokenResponse = await this.oauth2.getAccessToken()
    const accessToken = tokenResponse?.token
    if (!accessToken) {
      throw new Error("Failed to obtain Gmail access token")
    }
    return accessToken
  }

  async listMessages(
    context: RequestContext & { maxResults: number; pageToken?: string; labelIds?: string[]; query?: string }
  ) {
    await this.ensureAuth(context.credentialRef)
    return withRetry(() =>
      this.gmail.users.messages.list({
        userId: context.userId,
        maxResults: context.maxResults,
        pageToken: context.pageToken,
        labelIds: context.labelIds,
        q: context.query,
      })
    )
  }

  async getMessage(context: RequestContext & { messageId: string }) {
    await this.ensureAuth(context.credentialRef)
    return withRetry(() =>
      this.gmail.users.messages.get({
        userId: context.userId,
        id: context.messageId,
        format: "full",
      })
    )
  }

  async getAttachment(context: RequestContext & { messageId: string; attachmentId: string }) {
    await this.ensureAuth(context.credentialRef)
    return withRetry(() =>
      this.gmail.users.messages.attachments.get({
        userId: context.userId,
        messageId: context.messageId,
        id: context.attachmentId,
      })
    )
  }

  private async ensureAuth(credentialRef: string): Promise<void> {
    const refreshToken = await this.tokenStore.getRefreshToken(credentialRef)
    this.oauth2.setCredentials({ refresh_token: refreshToken })
    const token = await this.oauth2.getAccessToken()
    if (!token?.token) {
      throw new Error("Gmail OAuth refresh failed: access token not returned")
    }
  }
}

async function withRetry<T>(fn: () => Promise<T>, attempt = 0): Promise<T> {
  try {
    return await fn()
  } catch (error: any) {
    const status = error?.code ?? error?.response?.status
    const reason = error?.response?.data?.error?.message
    if (status === 401 || status === 403) {
      throw new Error(`Gmail auth error (${status}): ${reason ?? "unauthorized"}`)
    }
    if (status === 429) {
      throw new Error(`Gmail quota error (429): ${reason ?? "rate limit exceeded"}`)
    }
    const shouldRetry = status === 500 || status === 502 || status === 503
    if (!shouldRetry || attempt >= 4) {
      throw error instanceof Error ? error : new Error(String(error))
    }
    const delay = Math.min(1000 * 2 ** attempt, 8000)
    await new Promise((resolve) => setTimeout(resolve, delay))
    return withRetry(fn, attempt + 1)
  }
}
