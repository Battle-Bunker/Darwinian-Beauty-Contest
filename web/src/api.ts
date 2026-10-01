// Tiny JSON client for /api. Cookies carry the session; errors become ApiError.

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(status: number, message: string, data: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
/** Called whenever a request comes back 401, so the app can show the login screen again. */
export function onUnauthorized(fn: Listener) {
  unauthorizedListeners.add(fn);
  return () => { unauthorizedListeners.delete(fn); };
}

/** `path` is relative to /api unless it starts with "/api" or "http". `okStatuses` are returned, not thrown. */
export async function api<T = any>(method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<T> {
  const url = path.startsWith("/api") || path.startsWith("http") ? path : "/api" + path;
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok && !okStatuses.includes(res.status)) {
    if (res.status === 401) unauthorizedListeners.forEach((fn) => fn());
    throw new ApiError(res.status, data?.error || `${res.status} ${res.statusText}`, data);
  }
  return data as T;
}

export const gameBase = (room: string, game: string) => `/rooms/${encodeURIComponent(room)}/games/${encodeURIComponent(game)}`;

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
