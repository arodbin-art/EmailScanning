export type AiReview = {
  provider: "igpt"
  model?: string
  score: number
  label: "high" | "medium" | "low"
  rationale: string
  flags?: string[]
  createdAt: string
  baselineScore: number
  igptScore?: number | null
}

export type ManulifeBaselineInput = {
  beneficiary?: string | null
  claimType?: string | null
  serviceDate?: string | null
  submitted?: number | null
  paidTotal?: number | null
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  if (value <= 0) {
    return 0
  }
  if (value >= 1) {
    return 1
  }
  return value
}

export function labelFromScore(score: number): "high" | "medium" | "low" {
  const normalized = clamp01(score)
  if (normalized >= 0.85) {
    return "high"
  }
  if (normalized >= 0.65) {
    return "medium"
  }
  return "low"
}

export function truncate140(value: string): string {
  const normalized = value.trim()
  if (normalized.length <= 140) {
    return normalized
  }
  return normalized.slice(0, 140)
}

export function computeManulifeBaselineScore(input: ManulifeBaselineInput): number {
  let score = 0
  const beneficiary = normalizeWhitespace(input.beneficiary)
  if (beneficiary && beneficiary.split(/\s+/).length >= 2) {
    score += 0.25
  }

  const claimType = normalizeWhitespace(input.claimType)
  if (claimType && claimType.length >= 3) {
    score += 0.2
  }

  if (isValidIsoDate(input.serviceDate)) {
    score += 0.2
  }

  const submitted = asNumber(input.submitted)
  if (submitted !== null && submitted > 0) {
    score += 0.2
  }

  const paidTotal = asNumber(input.paidTotal)
  if (
    submitted !== null &&
    submitted > 0 &&
    paidTotal !== null &&
    paidTotal >= 0 &&
    paidTotal <= submitted * 1.05
  ) {
    score += 0.15
  }

  return clamp01(score)
}

export function buildAiReview(params: {
  baselineScore: number
  igptScore?: number | null
  rationale?: string | null
  flags?: string[] | null
  model?: string | null
  createdAt?: string | Date
}): AiReview {
  const baselineScore = clamp01(params.baselineScore)
  const igptScore = asNumber(params.igptScore)
  const finalScore =
    igptScore === null
      ? baselineScore
      : clamp01(baselineScore * 0.55 + clamp01(igptScore) * 0.45)
  const rationale = truncate140(
    normalizeWhitespace(params.rationale) || "Deterministic parse confidence only."
  )
  const flags = Array.isArray(params.flags)
    ? params.flags
        .map((value) => normalizeWhitespace(value))
        .filter((value): value is string => Boolean(value))
    : undefined
  const createdAt = toIso(params.createdAt)

  return {
    provider: "igpt",
    model: normalizeWhitespace(params.model) ?? undefined,
    score: finalScore,
    label: labelFromScore(finalScore),
    rationale,
    flags: flags && flags.length > 0 ? flags : undefined,
    createdAt,
    baselineScore,
    igptScore,
  }
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return null
}

function normalizeWhitespace(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const normalized = value.replace(/\s+/g, " ").trim()
  return normalized.length > 0 ? normalized : null
}

function isValidIsoDate(value: string | null | undefined): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return false
  }
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) {
    return false
  }
  return parsed.toISOString().slice(0, 10) === value
}

function toIso(value: string | Date | undefined): string {
  if (typeof value === "string") {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString()
    }
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString()
  }
  return new Date().toISOString()
}
