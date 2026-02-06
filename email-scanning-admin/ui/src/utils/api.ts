const CONFIGURED_API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '';
const ADMIN_TOKEN = (import.meta.env.VITE_ADMIN_TOKEN as string | undefined) || '';

function resolveApiBase(): string {
  // When the UI is opened from another machine (e.g., http://nas:5175),
  // hardcoding http://localhost:4000 breaks because "localhost" becomes the browser machine.
  if (CONFIGURED_API_BASE && !CONFIGURED_API_BASE.includes('localhost')) {
    return CONFIGURED_API_BASE;
  }
  if (typeof window !== 'undefined' && window.location?.hostname) {
    return `${window.location.protocol}//${window.location.hostname}:4000`;
  }
  return CONFIGURED_API_BASE || 'http://localhost:4000';
}

export type ApiResponse<T> = {
  data: T;
  warnings?: { code: string; message: string }[];
};

export async function apiRequest<T>(path: string, options?: RequestInit): Promise<ApiResponse<T>> {
  const apiBase = resolveApiBase();
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(ADMIN_TOKEN ? { Authorization: `Bearer ${ADMIN_TOKEN}` } : {}),
      ...(options?.headers || {})
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = payload?.error || `Request failed (${response.status})`;
    throw new Error(message);
  }

  if (response.status === 204) {
    return { data: undefined as T };
  }

  return (await response.json()) as ApiResponse<T>;
}
