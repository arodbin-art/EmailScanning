import { MailAccount } from "@prisma/client"
import { EmailProvider, ProviderAttachment, ProviderMessage, ProviderMessageRef } from "../../ingestion/types.js"
import { GmailClient } from "./gmailClient.js"
import { parseCredentialRef } from "../../auth/gmailTokenStore.js"

const DEFAULT_USER_ID = "me"

export class GmailEmailProvider implements EmailProvider {
  readonly provider = "gmail"
  private readonly client: GmailClient

  constructor(client: GmailClient) {
    this.client = client
  }

  async listMessages(account: MailAccount, limit: number): Promise<ProviderMessageRef[]> {
    const credentialRef = requireCredentialRef(account)
    const filters = readGmailFilters()
    const refs: ProviderMessageRef[] = []
    let pageToken: string | undefined

    while (refs.length < limit) {
      const response = await this.client.listMessages({
        credentialRef,
        userId: DEFAULT_USER_ID,
        maxResults: Math.min(limit - refs.length, 100),
        pageToken,
        labelIds: filters.labelIds,
        query: filters.query,
      })

      const messages = response.data.messages ?? []
      for (const message of messages) {
        if (message.id) {
          refs.push({ id: message.id })
        }
      }

      pageToken = response.data.nextPageToken ?? undefined
      if (!pageToken || messages.length === 0) {
        break
      }
    }

    return refs
  }

  async getMessage(account: MailAccount, id: string): Promise<ProviderMessage | null> {
    const credentialRef = requireCredentialRef(account)
    const response = await this.client.getMessage({
      credentialRef,
      userId: DEFAULT_USER_ID,
      messageId: id,
    })

    if (!response.data.id) {
      return null
    }

    const headers = response.data.payload?.headers ?? []
    const fromRaw = getHeader(headers, "from") ?? ""
    const subject = getHeader(headers, "subject") ?? undefined
    const internalDate = response.data.internalDate ?? undefined
    const receivedAt = parseDate(internalDate, getHeader(headers, "date"))

    const bodyPart = findBodyPart(response.data.payload)
    const bodyContent = bodyPart?.body?.data ? decodeBase64UrlToUtf8(bodyPart.body.data) : ""
    const contentType = bodyPart?.mimeType === "text/html" ? "html" : "text"

    const attachments = await this.getAttachments(credentialRef, response.data.id, response.data.payload)

    return {
      id: response.data.id,
      messageId: response.data.id,
      threadId: response.data.threadId ?? undefined,
      fromAddress: extractEmailAddress(fromRaw),
      subject,
      receivedAt,
      labels: response.data.labelIds ?? undefined,
      body: {
        contentType,
        content: bodyContent,
      },
      attachments,
    }
  }

  private async getAttachments(
    credentialRef: string,
    messageId: string,
    payload?: GmailPart
  ): Promise<ProviderAttachment[]> {
    if (!payload) {
      return []
    }
    const attachments = collectAttachments(payload)
    const results: ProviderAttachment[] = []

    for (const attachment of attachments) {
      const response = await this.client.getAttachment({
        credentialRef,
        userId: DEFAULT_USER_ID,
        messageId,
        attachmentId: attachment.attachmentId,
      })
      const data = response.data.data ? decodeBase64UrlToBase64(response.data.data) : ""
      results.push({
        id: attachment.attachmentId,
        name: attachment.filename ?? "attachment",
        contentType: attachment.mimeType,
        size: attachment.size,
        isInline: attachment.isInline,
        contentBytes: data || undefined,
      })
    }

    return results
  }
}

type GmailHeader = { name?: string | null; value?: string | null }

type GmailPart = {
  partId?: string | null
  mimeType?: string | null
  filename?: string | null
  headers?: GmailHeader[]
  body?: {
    size?: number | null
    data?: string | null
    attachmentId?: string | null
  }
  parts?: GmailPart[]
}

type GmailFilters = {
  labelIds?: string[]
  query?: string
}

type AttachmentRef = {
  attachmentId: string
  filename?: string
  mimeType?: string
  size?: number
  isInline?: boolean
}

function requireCredentialRef(account: MailAccount): string {
  if (account.provider !== "gmail") {
    throw new Error(`Invalid provider for GmailEmailProvider: ${account.provider}`)
  }
  if (account.authType !== "oauth") {
    throw new Error(`Gmail account ${account.id} must use auth_type=oauth`)
  }
  const ref = account.encryptedCredentialsRef?.trim()
  if (!ref) {
    throw new Error(`Gmail account ${account.id} missing encrypted_credentials_ref`)
  }
  parseCredentialRef(ref)
  return ref
}

function getHeader(headers: GmailHeader[], name: string): string | undefined {
  const target = name.toLowerCase()
  const value = headers.find((header) => header.name?.toLowerCase() === target)?.value
  return value ?? undefined
}

function extractEmailAddress(raw: string): string {
  const match = raw.match(/<([^>]+)>/)
  if (match) {
    return match[1].trim()
  }
  return raw.trim()
}

function parseDate(internalDate?: string, headerDate?: string): Date {
  if (internalDate) {
    const ms = Number(internalDate)
    if (Number.isFinite(ms)) {
      return new Date(ms)
    }
  }
  if (headerDate) {
    const parsed = new Date(headerDate)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }
  return new Date()
}

function readGmailFilters(): GmailFilters {
  const rawLabels = (process.env.GMAIL_LABEL_IDS ?? "").trim()
  const labelIds = rawLabels
    ? rawLabels
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    : undefined
  const query = (process.env.GMAIL_QUERY ?? "").trim()
  return {
    labelIds: labelIds && labelIds.length > 0 ? labelIds : undefined,
    query: query.length > 0 ? query : undefined,
  }
}

function findBodyPart(part?: GmailPart): GmailPart | undefined {
  if (!part) {
    return undefined
  }

  if (part.mimeType === "text/plain" && part.body?.data) {
    return part
  }

  if (part.parts) {
    for (const child of part.parts) {
      const found = findBodyPart(child)
      if (found) {
        return found
      }
    }
  }

  if (part.mimeType === "text/html" && part.body?.data) {
    return part
  }

  return undefined
}

function collectAttachments(part: GmailPart): AttachmentRef[] {
  const results: AttachmentRef[] = []
  const stack: GmailPart[] = [part]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) {
      continue
    }
    const attachmentId = current.body?.attachmentId
    if (attachmentId) {
      const disposition = getHeader(current.headers ?? [], "content-disposition")?.toLowerCase() ?? ""
      results.push({
        attachmentId,
        filename: current.filename ?? undefined,
        mimeType: current.mimeType ?? undefined,
        size: current.body?.size ?? undefined,
        isInline: disposition.includes("inline"),
      })
    }
    if (current.parts) {
      for (const child of current.parts) {
        stack.push(child)
      }
    }
  }

  return results
}

function decodeBase64UrlToBase64(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
  return Buffer.from(padded, "base64").toString("base64")
}

function decodeBase64UrlToUtf8(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
  return Buffer.from(padded, "base64").toString("utf8")
}
