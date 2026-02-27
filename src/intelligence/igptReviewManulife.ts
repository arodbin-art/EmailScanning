import { clamp01, truncate140 } from "./aiReview.js"

type IGPTReview = {
  score: number
  rationale: string
  flags?: string[]
  model?: string
}

type ReviewInput = {
  normalizedText: string
  deterministicExtraction: Record<string, unknown>
}

export async function reviewManulifeWithIGPT(input: ReviewInput): Promise<IGPTReview | null> {
  if ((process.env.IGPT_ENABLED ?? "false").toLowerCase() !== "true") {
    return null
  }

  const apiKey = (process.env.IGPT_API_KEY ?? "").trim()
  if (!apiKey) {
    return null
  }

  const baseUrl = (process.env.IGPT_BASE_URL ?? "https://api.igpt.ai")
    .trim()
    .replace(/\/+$/, "")
  const timeoutMs = clampTimeout(process.env.IGPT_TIMEOUT_MS)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${baseUrl}/v1/recall/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        user: "signal_engine",
        stream: false,
        quality: "cef-1-normal",
        input: buildPrompt({
          normalizedText: input.normalizedText.slice(0, 6000),
          deterministicExtraction: input.deterministicExtraction,
        }),
        output_format: {
          type: "json_schema",
          json_schema: {
            name: "manulife_ai_review",
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["score", "rationale"],
              properties: {
                score: { type: "number", minimum: 0, maximum: 1 },
                rationale: { type: "string", maxLength: 140 },
                flags: {
                  type: "array",
                  items: { type: "string" },
                  maxItems: 10,
                },
              },
            },
          },
        },
      }),
    })

    if (!response.ok) {
      return null
    }

    const payload = await response.json().catch(() => null)
    return extractIGPTReview(payload)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function buildPrompt(input: {
  normalizedText: string
  deterministicExtraction: Record<string, unknown>
}): string {
  return [
    "Score confidence for deterministic Manulife claim extraction.",
    "Return JSON only with keys: score (0..1), rationale (<=140 chars), flags (optional string array).",
    "Never infer new amounts or IDs. Score only the provided extraction quality against email text.",
    `Deterministic extraction: ${JSON.stringify(input.deterministicExtraction)}`,
    "Email text:",
    input.normalizedText,
  ].join("\n")
}

function extractIGPTReview(payload: unknown): IGPTReview | null {
  const candidate = findReviewObject(payload)
  if (!candidate || typeof candidate !== "object") {
    return null
  }

  const score = toNumber((candidate as Record<string, unknown>).score)
  if (score === null) {
    return null
  }

  const rationale = normalizeText((candidate as Record<string, unknown>).rationale)
  if (!rationale) {
    return null
  }

  const rawFlags = (candidate as Record<string, unknown>).flags
  const flags = Array.isArray(rawFlags)
    ? rawFlags
        .map((value: unknown) => normalizeText(value))
        .filter((value: string | null): value is string => Boolean(value))
    : undefined

  const model =
    normalizeText((payload as Record<string, unknown>)?.model) ??
    normalizeText((payload as Record<string, unknown>)?.["model_name"]) ??
    normalizeText(
      (payload as Record<string, unknown>)?.output &&
        typeof (payload as Record<string, unknown>).output === "object"
        ? ((payload as Record<string, unknown>).output as Record<string, unknown>)?.model
        : null
    ) ??
    undefined

  return {
    score: clamp01(score),
    rationale: truncate140(rationale),
    flags: flags && flags.length > 0 ? flags : undefined,
    model,
  }
}

function findReviewObject(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") {
    return null
  }

  if (looksLikeReview(payload)) {
    return payload as Record<string, unknown>
  }

  const root = payload as Record<string, unknown>
  const directCandidates: unknown[] = [
    root.output,
    root.data,
    root.result,
    root.response,
    root.json,
  ]
  for (const entry of directCandidates) {
    if (entry && typeof entry === "object" && looksLikeReview(entry)) {
      return entry as Record<string, unknown>
    }
  }

  const nestedJson = [
    readPath(root, ["output", "json"]),
    readPath(root, ["data", "json"]),
    readPath(root, ["response", "json"]),
    readPath(root, ["result", "json"]),
  ]
  for (const entry of nestedJson) {
    if (entry && typeof entry === "object" && looksLikeReview(entry)) {
      return entry as Record<string, unknown>
    }
  }

  const contentCandidates = [
    readPath(root, ["output", "text"]),
    readPath(root, ["output", "content"]),
    readPath(root, ["choices", 0, "message", "content"]),
    root.content,
    root.text,
  ]
  for (const value of contentCandidates) {
    if (typeof value !== "string") continue
    const parsed = parseJsonObject(value)
    if (parsed && looksLikeReview(parsed)) {
      return parsed
    }
  }

  return null
}

function looksLikeReview(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return false
  }
  const row = value as Record<string, unknown>
  return toNumber(row.score) !== null && normalizeText(row.rationale) !== null
}

function readPath(root: Record<string, unknown>, path: Array<string | number>): unknown {
  let value: unknown = root
  for (const key of path) {
    if (typeof key === "number") {
      if (!Array.isArray(value)) return null
      value = value[key]
      continue
    }
    if (!value || typeof value !== "object") return null
    value = (value as Record<string, unknown>)[key]
  }
  return value
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const normalized = value.replace(/\s+/g, " ").trim()
  return normalized.length > 0 ? normalized : null
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return null
}

function clampTimeout(value: string | undefined): number {
  const parsed = Number(value ?? "")
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 5000
  }
  return Math.max(500, Math.min(30000, Math.floor(parsed)))
}
