/** Browser-side API client. All calls go to this web app's own /api routes (same origin). */

export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: unknown) {
    super(message);
  }
}

function messageOf(data: unknown, status: number): string {
  const m = (data as { message?: string | string[] })?.message;
  if (Array.isArray(m)) return m.join('. ');
  if (typeof m === 'string') return m;
  if (status === 429) return 'Too many attempts. Wait a minute and try again.';
  return `Request failed (${status})`;
}

async function request<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    /* plain text */
  }
  if (res.status === 401 && typeof window !== 'undefined' && !url.startsWith('/api/auth/')) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?next=${next}`;
  }
  if (!res.ok) throw new ApiError(res.status, messageOf(data, res.status), data);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(`/api/v1${path}`, 'GET'),
  post: <T>(path: string, body?: unknown) => request<T>(`/api/v1${path}`, 'POST', body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>(`/api/v1${path}`, 'PATCH', body),
  del: <T>(path: string) => request<T>(`/api/v1${path}`, 'DELETE'),
  auth: <T>(action: 'login' | 'register' | 'logout' | 'refresh' | 'pin-switch', body?: unknown) => request<T>(`/api/auth/${action}`, 'POST', body ?? {}),
};

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
