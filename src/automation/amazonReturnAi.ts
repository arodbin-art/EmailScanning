import { AmazonReturnParseResult } from "./amazonReturnParser.js"

export type AmazonAiSuggestion = {
  event_type: AmazonReturnParseResult["eventType"] | "unknown"
  order_id?: string
  amount?: number
  item_title?: string
  drop_off_by?: string
  refund_by?: string
  confidence: number
  reasoning?: string
}

type AmazonAiInput = {
  subject?: string
  normalizedBody: string
}

type AzureConfig = {
  endpoint: string
  apiKey: string
  deployment: string
  apiVersion: string
}

export function amazonAiEnabled(): boolean {
  if ((process.env.AMAZON_AI_ENABLED ?? "").toLowerCase() !== "true") {
    return false
  }
  return Boolean(getAzureConfig())
}

export async function classifyAmazonEmailWithAi(
  input: AmazonAiInput
): Promise<AmazonAiSuggestion | null> {
  const config = getAzureConfig()
  if (!config) {
    return null
  }

  const response = await fetch(
    `${config.endpoint}/openai/deployments/${config.deployment}/chat/completions?api-version=${config.apiVersion}`,
    {
      method: "POST",
      headers: {
        "api-key": config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content:
              "You analyze Amazon.ca return/refund emails. Return only JSON matching the schema. Do not include extra keys or commentary.",
          },
          {
            role: "user",
            content: buildPrompt(input),
          },
        ],
        temperature: 0,
        max_tokens: 500,
        response_format: buildResponseFormat(),
      }),
    }
  )

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Azure OpenAI request failed: ${response.status} ${response.statusText} ${text}`)
  }

  const payload = await response.json()
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content !== "string") {
    throw new Error("Azure OpenAI response missing content")
  }

  return parseSuggestion(content)
}

function getAzureConfig(): AzureConfig | null {
  const endpoint = (process.env.AZURE_OPENAI_ENDPOINT ?? "").trim().replace(/\/+$/, "")
  const apiKey = (process.env.AZURE_OPENAI_KEY ?? "").trim()
  const deployment = (process.env.AZURE_OPENAI_DEPLOYMENT ?? "").trim()
  const apiVersion = (process.env.AZURE_OPENAI_API_VERSION ?? "2024-02-15-preview").trim()
  if (!endpoint || !apiKey || !deployment) {
    return null
  }
  return { endpoint, apiKey, deployment, apiVersion }
}

function buildPrompt(input: AmazonAiInput): string {
  return [
    "Subject:",
    input.subject ?? "",
    "\nNormalized Body:\n",
    input.normalizedBody,
    "\nSchema:\n",
    JSON.stringify(
      {
        event_type: "amazon.return_requested | amazon.refund_issued | amazon.return_dropped_off | unknown",
        order_id: "string (optional)",
        amount: "number (optional, refund/estimated)",
        item_title: "string (optional)",
        drop_off_by: "YYYY-MM-DD (optional)",
        refund_by: "YYYY-MM-DD (optional)",
        confidence: "number between 0 and 1",
        reasoning: "short string",
      },
      null,
      2
    ),
  ].join("\n")
}

function buildResponseFormat(): Record<string, unknown> {
  return {
    type: "json_schema",
    json_schema: {
      name: "amazon_email_classification",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["event_type", "confidence"],
        properties: {
          event_type: {
            type: "string",
            enum: [
              "amazon.return_requested",
              "amazon.refund_issued",
              "amazon.return_dropped_off",
              "unknown",
            ],
          },
          order_id: { type: "string" },
          amount: { type: "number" },
          item_title: { type: "string" },
          drop_off_by: { type: "string" },
          refund_by: { type: "string" },
          confidence: { type: "number" },
          reasoning: { type: "string" },
        },
      },
    },
  }
}

function parseSuggestion(content: string): AmazonAiSuggestion {
  const trimmed = content.trim()
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("AI output did not contain JSON object")
  }
  const jsonText = trimmed.slice(start, end + 1)
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new Error("AI output JSON parse failed")
  }
  return validateSuggestion(parsed)
}

function validateSuggestion(value: unknown): AmazonAiSuggestion {
  if (!value || typeof value !== "object") {
    throw new Error("AI output JSON is not an object")
  }
  const obj = value as Record<string, unknown>
  const eventType = typeof obj.event_type === "string" ? obj.event_type : "unknown"
  const confidence = typeof obj.confidence === "number" ? obj.confidence : 0
  if (confidence < 0 || confidence > 1) {
    throw new Error("AI output confidence must be 0-1")
  }
  return {
    event_type: eventType as AmazonAiSuggestion["event_type"],
    order_id: typeof obj.order_id === "string" ? obj.order_id : undefined,
    amount: typeof obj.amount === "number" ? obj.amount : undefined,
    item_title: typeof obj.item_title === "string" ? obj.item_title : undefined,
    drop_off_by: typeof obj.drop_off_by === "string" ? obj.drop_off_by : undefined,
    refund_by: typeof obj.refund_by === "string" ? obj.refund_by : undefined,
    confidence,
    reasoning: typeof obj.reasoning === "string" ? obj.reasoning : undefined,
  }
}
