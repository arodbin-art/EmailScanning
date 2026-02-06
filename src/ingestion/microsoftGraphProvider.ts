import { AccessTokenProvider, EmailProvider, ProviderAttachment, ProviderMessage, ProviderMessageRef } from "./types.js"
import { MailAccount } from "@prisma/client"

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0"

export class MicrosoftGraphEmailProvider implements EmailProvider {
  readonly provider = "microsoft"
  private readonly tokenProvider: AccessTokenProvider

  constructor(tokenProvider: AccessTokenProvider) {
    this.tokenProvider = tokenProvider
  }

  async listMessages(account: MailAccount, limit: number): Promise<ProviderMessageRef[]> {
    const token = await this.tokenProvider.getAccessToken(account)
    const mailbox = account.mailboxAddress
    const refs: ProviderMessageRef[] = []
    let nextUrl = `${GRAPH_BASE_URL}/users/${encodeURIComponent(mailbox)}/messages?$select=id&$orderby=receivedDateTime desc&$top=${Math.min(limit, 50)}`

    while (nextUrl && refs.length < limit) {
      const response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      if (!response.ok) {
        throw new Error(`Graph listMessages failed: ${response.status} ${response.statusText}`)
      }
      const payload = await response.json()
      const page = (payload.value ?? []) as { id: string }[]
      for (const item of page) {
        refs.push({ id: item.id })
        if (refs.length >= limit) {
          break
        }
      }
      nextUrl = payload["@odata.nextLink"] ?? null
    }

    return refs
  }

  async getMessage(account: MailAccount, id: string): Promise<ProviderMessage | null> {
    const token = await this.tokenProvider.getAccessToken(account)
    const mailbox = account.mailboxAddress
    const messageUrl = `${GRAPH_BASE_URL}/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(id)}?$select=id,internetMessageId,conversationId,from,subject,receivedDateTime,body`
    const response = await fetch(messageUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    if (response.status === 404) {
      return null
    }
    if (!response.ok) {
      throw new Error(`Graph getMessage failed: ${response.status} ${response.statusText}`)
    }
    const message = await response.json()
    const attachments = await this.listAttachments(token, mailbox, id)

    return {
      id: message.id,
      messageId: message.internetMessageId ?? "",
      threadId: message.conversationId ?? undefined,
      fromAddress: message?.from?.emailAddress?.address ?? "",
      subject: message.subject ?? undefined,
      receivedAt: new Date(message.receivedDateTime),
      body: {
        contentType: message.body?.contentType === "html" ? "html" : "text",
        content: message.body?.content ?? "",
      },
      attachments,
    }
  }

  private async listAttachments(token: string, mailbox: string, id: string): Promise<ProviderAttachment[]> {
    const url = `${GRAPH_BASE_URL}/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(id)}/attachments?$select=id,name,contentType,size,isInline,contentBytes`
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    if (!response.ok) {
      throw new Error(`Graph listAttachments failed: ${response.status} ${response.statusText}`)
    }
    const payload = await response.json()
    return (payload.value ?? []).map((attachment: any) => ({
      id: attachment.id,
      name: attachment.name ?? "attachment",
      contentType: attachment.contentType ?? undefined,
      size: attachment.size ?? undefined,
      isInline: attachment.isInline ?? undefined,
      contentBytes: attachment.contentBytes ?? undefined,
    }))
  }
}
