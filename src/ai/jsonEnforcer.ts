import { AiResult } from "./types.js"

export function parseStrictJson(text: string): AiResult {
  const trimmed = text.trim()
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
  validateAiResult(parsed)
  return parsed as AiResult
}

function validateAiResult(value: unknown): void {
  if (!value || typeof value !== "object") {
    throw new Error("AI output JSON is not an object")
  }
  const obj = value as Record<string, unknown>
  const requiredString = ["intent_type", "event_type"]
  for (const field of requiredString) {
    if (typeof obj[field] !== "string" || !(obj[field] as string).trim()) {
      throw new Error(`AI output missing required string field: ${field}`)
    }
  }
  if (!Array.isArray(obj.reference_ids)) {
    throw new Error("AI output missing reference_ids array")
  }
  if (typeof obj.confidence !== "number" || obj.confidence < 0 || obj.confidence > 1) {
    throw new Error("AI output confidence must be 0-1")
  }
}
