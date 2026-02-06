import { MailAccount } from "@prisma/client"

export type PollContext = {
  pollCycleId: string
}

export type ProviderMessageRef = {
  id: string
}

export type ProviderMessage = {
  id: string
  messageId: string
  threadId?: string
  fromAddress: string
  subject?: string
  receivedAt: Date
  labels?: string[]
  body: {
    contentType: "text" | "html"
    content: string
  }
  attachments: ProviderAttachment[]
}

export type ProviderAttachment = {
  id: string
  name: string
  contentType?: string
  size?: number
  isInline?: boolean
  contentBytes?: string
}

export type ProviderName = "microsoft" | "gmail"

export type EmailProvider = {
  provider: ProviderName
  listMessages(account: MailAccount, limit: number): Promise<ProviderMessageRef[]>
  getMessage(account: MailAccount, id: string): Promise<ProviderMessage | null>
}

export type AccessTokenProvider = {
  getAccessToken(account: MailAccount): Promise<string>
}

export type Logger = {
  info(message: string, fields?: Record<string, unknown>): void
  warn(message: string, fields?: Record<string, unknown>): void
  error(message: string, fields?: Record<string, unknown>): void
}
