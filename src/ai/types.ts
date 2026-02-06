export type AiPromptContext = {
  subject?: string
  normalizedBody: string
  attachmentsSummary: string
  monitorPrompt: string
}

export type AiResult = {
  intent_type: string
  event_type: string
  reference_ids: string[]
  merchant_or_insurer?: string
  amount?: number
  dates?: string[]
  suggested_deadline?: string
  confidence: number
}

export interface AiClient {
  classify(context: AiPromptContext): Promise<AiResult>
  modelName(): string
  promptVersion(): string
}
