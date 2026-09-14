import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { login, register } from '../../src/api/auth';

/**
 * Regression coverage for the reported "backend login verified working via
 * curl, but the frontend showed 'Login failed.'" bug. This pins the exact
 * response shape the backend controller actually returns
 * (backend/src/controllers/auth.controller.ts -> res.status(200).json({
 * data: result }) where result is backend/src/services/auth.service.ts's
 * `{ token, user: { id, email, role } }`) against what the frontend
 * expects, field-for-field -- including confirming the frontend does NOT
 * expect `accessToken` (a plausible but, on inspection, incorrect
 * hypothesis for this bug: src/api/types.ts's `AuthResult.token` already
 * matches the backend exactly).
 */
describe('login()', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves with { token, user } for the real backend response shape, unmodified', async () => {
    const backendResponse = {
      data: {
        token: 'header.payload.signature',
        user: { id: 'u-123', email: 'user@demo.local', role: 'USER' },
      },
    };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify(backendResponse), { status: 200 }));

    const result = await login('user@demo.local', 'DemoPass123!');

    expect(result).toEqual(backendResponse.data);
    expect(result.token).toBe('header.payload.signature');
    expect((result as unknown as Record<string, unknown>).accessToken).toBeUndefined();
  });

  it('POSTs the credentials as { email, password } with no Authorization header', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ data: { token: 't', user: { id: '1', email: 'a@b.com', role: 'USER' } } }), { status: 200 })
    );

    await login('user@demo.local', 'DemoPass123!');

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/auth/login');
    expect(JSON.parse(init.body)).toEqual({ email: 'user@demo.local', password: 'DemoPass123!' });
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('propagates the backend 401 message on invalid credentials as an ApiError, not a generic failure', async () => {
    const { ApiError } = await import('../../src/api/client');
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Invalid email or password' } }), { status: 401 })
    );

    const error = await login('user@demo.local', 'wrong-password').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as InstanceType<typeof ApiError>).message).toBe('Invalid email or password');
  });
});

describe('register()', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('resolves with { token, user } for the real backend response shape', async () => {
    const backendResponse = { data: { token: 't', user: { id: 'u-1', email: 'new@demo.local', role: 'USER' } } };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify(backendResponse), { status: 201 }));

    const result = await register('new@demo.local', 'DemoPass123!');
    expect(result).toEqual(backendResponse.data);
  });
});
