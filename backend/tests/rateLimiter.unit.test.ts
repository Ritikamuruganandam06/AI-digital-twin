import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { AppError } from '../src/utils/AppError';

/**
 * Unit tests for the pure decision logic in src/middleware/rateLimiter.ts,
 * with config/redis mocked so these never touch a real Redis -- the same
 * split tests/authMiddleware.unit.test.ts uses (pure logic here,
 * tests/rateLimiter.integration.test.ts proves it against a real Redis).
 */

const isRedisConnected = vi.fn();
const incr = vi.fn();
const pexpire = vi.fn();

vi.mock('../src/config/redis', () => ({
  isRedisConnected: () => isRedisConnected(),
  getRedisClient: () => ({ incr, pexpire }),
}));

// Imported after the mock is registered so rateLimiter.ts picks up the
// mocked module rather than the real one.
const { rateLimiter } = await import('../src/middleware/rateLimiter');

function fakeRequest(ip = '127.0.0.1'): Request {
  return { ip } as unknown as Request;
}

function fakeResponse(): Response {
  const headers: Record<string, string> = {};
  return {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    _headers: headers,
  } as unknown as Response;
}

function runMiddleware(req: Request, res: Response): Promise<unknown> {
  return new Promise((resolve) => {
    rateLimiter(req, res, (err?: unknown) => resolve(err));
  });
}

beforeEach(() => {
  isRedisConnected.mockReset();
  incr.mockReset();
  pexpire.mockReset();
});

describe('rateLimiter', () => {
  it('fails open (calls next with no error, never touches Redis) when Redis is not connected', async () => {
    isRedisConnected.mockReturnValue(false);

    const err = await runMiddleware(fakeRequest(), fakeResponse());

    expect(err).toBeUndefined();
    expect(incr).not.toHaveBeenCalled();
  });

  it('allows a request under the limit and sets rate-limit headers', async () => {
    isRedisConnected.mockReturnValue(true);
    incr.mockResolvedValue(1);
    pexpire.mockResolvedValue(1);

    const res = fakeResponse();
    const err = await runMiddleware(fakeRequest(), res);

    expect(err).toBeUndefined();
    expect((res as unknown as { _headers: Record<string, string> })._headers['X-RateLimit-Limit']).toBeDefined();
  });

  it('sets the window expiry only on the first increment of a window', async () => {
    isRedisConnected.mockReturnValue(true);
    incr.mockResolvedValue(1);
    pexpire.mockResolvedValue(1);

    await runMiddleware(fakeRequest(), fakeResponse());

    expect(pexpire).toHaveBeenCalledOnce();
  });

  it('does NOT set the expiry again on later increments in the same window', async () => {
    isRedisConnected.mockReturnValue(true);
    incr.mockResolvedValue(5); // not the first increment

    await runMiddleware(fakeRequest(), fakeResponse());

    expect(pexpire).not.toHaveBeenCalled();
  });

  it('rejects with a 429 AppError once the count exceeds RATE_LIMIT_MAX', async () => {
    isRedisConnected.mockReturnValue(true);
    incr.mockResolvedValue(101); // default RATE_LIMIT_MAX is 100

    const err = await runMiddleware(fakeRequest(), fakeResponse());

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(429);
  });

  it('allows a request exactly at the limit (off-by-one boundary)', async () => {
    isRedisConnected.mockReturnValue(true);
    incr.mockResolvedValue(100); // exactly RATE_LIMIT_MAX, not over it

    const err = await runMiddleware(fakeRequest(), fakeResponse());

    expect(err).toBeUndefined();
  });

  it('fails open when the Redis INCR call itself rejects', async () => {
    isRedisConnected.mockReturnValue(true);
    incr.mockRejectedValue(new Error('connection reset'));

    const err = await runMiddleware(fakeRequest(), fakeResponse());

    expect(err).toBeUndefined();
  });

  it('fails open even if the PEXPIRE call fails (the request itself still proceeds)', async () => {
    isRedisConnected.mockReturnValue(true);
    incr.mockResolvedValue(1);
    pexpire.mockRejectedValue(new Error('connection reset'));

    const err = await runMiddleware(fakeRequest(), fakeResponse());

    expect(err).toBeUndefined();
  });
});
