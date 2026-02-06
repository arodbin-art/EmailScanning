export type SenderRule = {
  type: "exact" | "domain" | "regex"
  value: string
}

export type MonitorDefinition = {
  id: string
  name: string
  enabled: boolean
  provider: string
  senderRules?: SenderRule[]
  fromContains?: string
  subjectContains?: string
  subjectRegex?: string
  bodyRegex?: string
  hasAttachments?: boolean
  gmailLabel?: string
  scope: "all" | "selected"
  mailAccountIds?: number[]
  aiPromptTemplate?: string
  confidenceThreshold?: number
  allowedEventTypes?: string[]
}
