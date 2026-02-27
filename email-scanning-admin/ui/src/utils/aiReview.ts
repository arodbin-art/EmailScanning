export type AiReviewSummary = {
  label: "high" | "medium" | "low"
  score: number
  baselineScore: number
  igptScore: number | null
  rationale: string
  flags: string[]
}

export function parseAiReview(payload: unknown): AiReviewSummary | null {
  if (!payload || typeof payload !== "object") return null
  const review = asObject((payload as Record<string, unknown>).ai_review)
  if (!review) return null
  const label = asString(review.label)
  if (label !== "high" && label !== "medium" && label !== "low") return null
  const score = asNumber(review.score)
  const baselineScore = asNumber(review.baselineScore)
  const rationale = asString(review.rationale)
  if (score === null || baselineScore === null || !rationale) return null
  const igptScore = asNumber(review.igptScore)
  const flags = Array.isArray(review.flags)
    ? review.flags
        .map((value) => asString(value))
        .filter((value): value is string => Boolean(value))
    : []
  return {
    label,
    score: clamp01(score),
    baselineScore: clamp01(baselineScore),
    igptScore: igptScore === null ? null : clamp01(igptScore),
    rationale,
    flags,
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  if (value >= 1) return 1
  return value
}
