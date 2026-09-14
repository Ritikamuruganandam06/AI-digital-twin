import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, ApiError, clearToken, getToken, setToken } from '../../src/api/client';

/**
 * `apiFetch()` is the only function in the app that calls `fetch` -- these
 * tests mock exactly that boundary (`global.fetch`), the same "mock only
 * the network boundary" discipline the backend/ai-service test suites use
 * for their own outbound HTTP clients.
 */
describe('apiFetch', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('unwraps the { data } envelope on success', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ data: { id: '1', name: 'checkout' } }), { status: 200 })
    );

    const result = await apiFetch<{ id: string; name: string }>('/api/services/checkout');
    expect(result).toEqual({ id: '1', name: 'checkout' });
  });

  it('attaches a stored bearer token by default', async () => {
    setToken('secret-token');
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));

    await apiFetch('/api/services');

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-token');
  });

  it('does not attach a token when skipAuth is set', async () => {
    setToken('secret-token');
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));

    await apiFetch('/api/auth/login', { method: 'POST', body: { email: 'a@b.com' }, skipAuth: true });

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('attaches an Idempotency-Key header when given', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 201 }));

    await apiFetch('/api/incidents', { method: 'POST', body: {}, idempotencyKey: 'abc-123' });

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('abc-123');
  });

  it('throws a typed ApiError using the backend error envelope on a non-2xx response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Invalid credentials', requestId: 'req-1' } }), { status: 401 })
    );

    await expect(apiFetch('/api/auth/login')).rejects.toMatchObject({
      name: 'ApiError',
      message: 'Invalid credentials',
      status: 401,
      requestId: 'req-1',
    });
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response('not json', { status: 500 }));

    await expect(apiFetch('/api/services')).rejects.toMatchObject({
      status: 500,
      message: 'Request failed with HTTP 500',
    });
  });

  it('normalizes a raw network failure into an ApiError with status 0', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError('Failed to fetch'));

    const error = await apiFetch('/api/services').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
  });

  /**
   * Regression test for the "backend login works via curl but the frontend
   * shows a generic 'Login failed.'" bug: LoginPage.tsx only special-cases
   * `err instanceof ApiError` (to show the real message) and falls back to
   * a hardcoded string for anything else. buildUrl() used to throw a raw,
   * unwrapped TypeError (`base.endsWith is not a function` on `undefined`)
   * whenever VITE_API_BASE_URL wasn't configured -- e.g. a developer who
   * never ran `cp .env.example .env` -- which bypassed ApiError entirely
   * and produced exactly that symptom, even with a perfectly healthy
   * backend. apiFetch must never let a request-setup failure escape
   * unwrapped.
   */
  it('throws a diagnosable ApiError, not a raw exception, when VITE_API_BASE_URL is not configured', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '');

    const error = await apiFetch('/api/auth/login').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toMatch(/VITE_API_BASE_URL is not configured/);
    expect(fetch).not.toHaveBeenCalled();

    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:4000');
  });

  it('wraps a malformed JSON success response in an ApiError instead of throwing a raw parse error', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response('this is not json', { status: 200 }));

    const error = await apiFetch('/api/services').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
  });

  it('returns undefined for a 204 response without parsing a body', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(null, { status: 204 }));

    const result = await apiFetch('/api/incidents/1');
    expect(result).toBeUndefined();
  });

  it('serializes query parameters, dropping undefined values', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));

    await apiFetch('/api/events', { query: { service: undefined, limit: 10 } });

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('limit=10');
    expect(url).not.toContain('service=');
  });
});

describe('token storage', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a token through set/get/clear', () => {
    expect(getToken()).toBeNull();
    setToken('t1');
    expect(getToken()).toBe('t1');
    clearToken();
    expect(getToken()).toBeNull();
  });
});
