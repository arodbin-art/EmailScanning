import { AiClient, AiPromptContext, AiResult } from "./types.js"
import { parseStrictJson } from "./jsonEnforcer.js"

export class OpenAiClient implements AiClient {
  private readonly apiKey: string
  private readonly model: string
  private readonly version: string

  constructor(params: { apiKey: string; model: string; promptVersion: string }) {
    this.apiKey = params.apiKey
    this.model = params.model
    this.version = params.promptVersion
  }

  modelName(): string {
    return this.model
  }

  promptVersion(): string {
    return this.version
  }

  async classify(context: AiPromptContext): Promise<AiResult> {
    const body = {
      model: this.model,
      messages: [
        {
          role: "system",
          content:
            "Return only JSON that matches the specified schema. Do not add extra keys or commentary.",
        },
        {
          role: "user",
          content: buildPrompt(context),
        },
      ],
      response_format: buildResponseFormat(),
      temperature: 0,
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`OpenAI request failed: ${response.status} ${response.statusText} ${text}`)
    }

    const payload = await response.json()
    const content = payload?.choices?.[0]?.message?.content
    if (typeof content !== "string") {
      throw new Error("OpenAI response missing content")
    }

    return parseStrictJson(content)
  }
}

function buildPrompt(context: AiPromptContext): string {
  return [
    "Subject:",
    context.subject ?? "",
    "\nNormalized Body:\n",
    context.normalizedBody,
    "\nAttachments Summary:\n",
    context.attachmentsSummary,
    "\nMonitor Context:\n",
    context.monitorPrompt,
  ].join("\n")
}

function buildResponseFormat(): Record<string, unknown> {
  return {
    type: "json_schema",
    json_schema: {
      name: "ai_classification",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["intent_type", "event_type", "reference_ids", "confidence"],
        properties: {
          intent_type: { type: "string" },
          event_type: { type: "string" },
          reference_ids: { type: "array", items: { type: "string" } },
          merchant_or_insurer: { type: "string" },
          amount: { type: "number" },
          dates: { type: "array", items: { type: "string" } },
          suggested_deadline: { type: "string" },
          confidence: { type: "number" },
        },
      },
    },
  }
}
