export function normalizeCaptureKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
  return normalized.length > 0 ? normalized : null;
}

export function buildCaptureLabel(captureKey: string | null | undefined): string | null {
  const normalized = normalizeCaptureKey(captureKey);
  return normalized ? `via ${normalized}` : null;
}

export function buildDisplayDescription(baseTitle: string, captureKey: string | null | undefined): string {
  const title = normalizeTitle(baseTitle);
  const captureLabel = buildCaptureLabel(captureKey);
  return captureLabel ? `${title} (${captureLabel})` : title;
}

export function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function stripGeneratedMemoFragments(
  memo: string | null | undefined,
  patterns: RegExp[]
): string | null {
  if (!memo) return null;
  const segments = memo
    .split(/\n|\|/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => !patterns.some((pattern) => pattern.test(segment)));
  if (segments.length === 0) {
    return null;
  }
  return segments.join(' | ').slice(0, 200);
}
