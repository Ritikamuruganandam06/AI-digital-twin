/**
 * The ONLY place in this app that calls `fetch`. Every other module under
 * `src/api/` goes through `apiFetch()` here -- this is what makes
 * `docs/phases.md`'s ground rule ("React never talks to
 * Mongo/Redis/Kafka/Qdrant/Groq directly") a structural fact rather than
 * a convention someone could quietly violate from a component: there's
 * exactly one function capable of making an HTTP request in this
 * codebase, and it only ever calls `VITE_API_BASE_URL` (the Node
 * backend).
 *
 * Mirrors the "normalize every failure into one typed error" discipline
 * backend/src/clients/aiServiceClient.ts and
 * ai-service/app/clients/backend_client.py both established: a raw
 * network exception and a non-2xx response both become the same
 * `ApiError`, so no component needs its own try/catch shape for "the
 * backend is down" vs. "the backend said no."
 */

const TOKEN_STORAGE_KEY = 'ai-digital-twin:token';

export class ApiError extends Error {
  public readonly status: number;
  public readonly requestId?: string;
  public readonly details?: unknown;

  constructor(message: string, status: number, requestId?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.requestId = requestId;
    this.details = details;
  }
}

/**
 * Token storage lives here, not in AuthContext -- AuthContext (React
 * state, for re-rendering components when auth changes) is a thin layer
 * on top of this (the actual persistence), so a page reload can restore
 * a session without waiting on any component to mount first.
 */
export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    // A private-browsing mode or a locked-down browser can make
    // localStorage throw on read -- treat that the same as "no session"
    // rather than crashing the whole app over it.
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // Same reasoning as getToken(): losing persistence is degraded, not fatal.
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Same as above.
  }
}

interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /**
   * Sets the `Idempotency-Key` header (backend/src/middleware/idempotency.ts,
   * Phase 16) -- opt-in per call, since it only makes sense for a mutating
   * request the caller might genuinely need to retry safely (see
   * `createIncident()` in api/incidents.ts).
   */
  idempotencyKey?: string;
  /** Skip attaching the stored Bearer token -- only auth.ts's register()/login() need this. */
  skipAuth?: boolean;
}

interface ApiEnvelope<T> {
  data: T;
}

interface ApiErrorBody {
  error?: {
    message?: string;
    requestId?: string;
    details?: unknown;
  };
}

function buildUrl(path: string, query?: ApiFetchOptions['query']): string {
  const base = import.meta.env.VITE_API_BASE_URL;
  if (!base) {
    // Thrown synchronously, before any network call -- caught below and
    // normalized into the same ApiError every other failure becomes, so a
    // missing/blank .env (the ambient `ImportMetaEnv` type claims this is
    // always a `string`, so `tsc` can't catch this at build time) surfaces
    // as an actionable message instead of a raw TypeError from
    // `base.endsWith` that every caller's `err instanceof ApiError` check
    // would silently swallow into a generic "Login failed."-style fallback.
    throw new Error(
      'VITE_API_BASE_URL is not configured. Copy frontend/.env.example to frontend/.env, set it to the backend URL, and restart the dev server.'
    );
  }
  const url = new URL(path, base.endsWith('/') ? base : `${base}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * Calls the backend and returns the unwrapped `data` field every
 * successful response envelope carries (`{"data": ...}` -- the same
 * envelope shape `ai-service/app/tools/backend_tools_client.py`'s
 * `_request()` unwraps on the Python side of this exact API). Throws
 * `ApiError` for anything else -- and only ever `ApiError`, never a raw
 * exception: a non-2xx response (using the backend's own
 * `error.message`/`requestId` when present), a raw network failure
 * (connection refused, DNS, CORS, ...), a bad request-time setup (e.g. an
 * unset `VITE_API_BASE_URL`), or a response whose body isn't valid JSON,
 * all normalized into the same shape. This total normalization is what
 * every caller's `err instanceof ApiError` check (see `LoginPage.tsx`)
 * relies on to show the real failure reason instead of a generic
 * fallback string.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (!options.skipAuth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }

  let requestUrl = path;
  let response: Response;
  try {
    requestUrl = buildUrl(path, options.query);
    response = await fetch(requestUrl, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ApiError(`Could not reach the backend at ${requestUrl}: ${reason}`, 0);
  }

  if (!response.ok) {
    let body: ApiErrorBody = {};
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // A non-JSON error body (e.g. a proxy's own HTML error page) --
      // fall back to the status text below rather than throwing here.
    }
    throw new ApiError(
      body.error?.message ?? `Request failed with HTTP ${response.status}`,
      response.status,
      body.error?.requestId,
      body.error?.details
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  try {
    const envelope = (await response.json()) as ApiEnvelope<T>;
    return envelope.data;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ApiError(`The backend returned a response that could not be parsed: ${reason}`, response.status);
  }
}
