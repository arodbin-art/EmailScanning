export interface StructuredSignal {
  eventType: string
  primaryRef?: string
  amount?: number
  occurredAt?: string
  payload: any
  confidence?: number
}

export type IntelligenceEmailInput = {
  emailId: string
  subject: string
  normalizedText: string
  receivedAt: Date
  provider: string
  mailAccountId: number
  // Optional extension for deterministic sender-based parsers.
  fromAddress?: string
}

export interface EmailIntelligenceProvider {
  analyzeEmail(email: IntelligenceEmailInput): Promise<StructuredSignal[]>
}
