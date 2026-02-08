const CONFIGURED_API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '';
const COMPILED_ADMIN_TOKEN = (import.meta.env.VITE_ADMIN_TOKEN as string | undefined) || '';

function resolveAdminToken(): string {
  if (COMPILED_ADMIN_TOKEN) {
    return COMPILED_ADMIN_TOKEN;
  }
  if (typeof window !== 'undefined') {
    // Allows runtime token entry without rebuilding the UI.
    const stored = window.localStorage.getItem('email_scanning_admin_token');
    if (stored && stored.trim().length > 0) {
      return stored.trim();
    }
  }
  return '';
}

function resolveApiBase(): string {
  // When the UI is opened from another machine (e.g., http://nas:5175),
  // hardcoding http://localhost:4000 breaks because "localhost" becomes the browser machine.
  if (CONFIGURED_API_BASE && !CONFIGURED_API_BASE.includes('localhost')) {
    return CONFIGURED_API_BASE;
  }
  if (typeof window !== 'undefined' && window.location?.hostname) {
    // If the UI is served by the API (same origin), use it directly.
    // If the UI is served by Vite dev server (5175), assume API is on :4000.
    const port = window.location.port || '';
    if (!port || port === '80' || port === '443' || port === '4000') {
      return window.location.origin;
    }
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
  const adminToken = resolveAdminToken();
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
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
