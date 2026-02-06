import fs from "fs/promises"
import { AiClient } from "./types.js"
import { OpenAiClient } from "./openAiClient.js"

export async function createAiClient(): Promise<AiClient | undefined> {
  const enabled = (process.env.AI_ENABLED ?? "false").toLowerCase() === "true"
  if (!enabled) {
    return undefined
  }

  const provider = (process.env.AI_PROVIDER ?? "openai").toLowerCase()
  if (provider !== "openai") {
    throw new Error(`Unsupported AI_PROVIDER: ${provider}`)
  }

  const apiKey = await readApiKeyFromFile()
  if (!apiKey) {
    throw new Error("OpenAI API key not found at secrets/OpenAI.key")
  }

  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini"
  const promptVersion = process.env.OPENAI_PROMPT_VERSION ?? "v1"

  return new OpenAiClient({ apiKey, model, promptVersion })
}

async function readApiKeyFromFile(): Promise<string | null> {
  try {
    const raw = await fs.readFile("secrets/OpenAI.key", "utf8")
    const value = raw.trim()
    return value.length > 0 ? value : null
  } catch {
    return null
  }
}
