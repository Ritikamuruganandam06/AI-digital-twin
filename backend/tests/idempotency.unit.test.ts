import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { AppError } from '../src/utils/AppError';

/**
 * Unit tests for the pure decision logic in src/middleware/idempotency.ts,
 * with config/redis mocked -- same split as rateLimiter.unit.test.ts /
 * rateLimiter.integration.test.ts. The real, unmocked proof (a genuine
 * duplicate POST /api/incidents against real Mongo + real Redis) is
 * tests/idempotency.integration.test.ts.
 */

const isRedisConnected = vi.fn();
const get = vi.fn();
const set = vi.fn();
const del = vi.fn();

vi.mock('../src/config/redis', () => ({
  isRedisConnected: () => isRedisConnected(),
  getRedisClient: () => ({ get, set, del }),
}));

const { idempotency } = await import('../src/middleware/idempotency');

function fakeRequest(headers: Record<string, string> = {}): Request {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    method: 'POST',
    originalUrl: '/api/incidents',
    header: (name: string) => lower[name.toLowerCase()],
  } as unknown as Request;
}

function fakeResponse(): Response {
  let statusCode = 200;
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (body: unknown) => body,
    get statusCode() {
      return statusCode;
    },
    _headers: headers,
  } as unknown as Response;
  return res;
}

function runMiddleware(req: Request, res: Response): Promise<unknown> {
  return new Promise((resolve) => {
    idempotency(req, res, (err?: unknown) => resolve(err));
  });
}

beforeEach(() => {
  isRedisConnected.mockReset();
  get.mockReset();
  set.mockReset();
  del.mockReset();
});

describe('idempotency', () => {
  it('is opt-in: with no Idempotency-Key header, the handler just runs, no Redis touched', async () => {
    const err = await runMiddleware(fakeRequest(), fakeResponse());

    expect(err).toBeUndefined();
    expect(get).not.toHaveBeenCalled();
  });

  it('fails open (handler runs normally) when Redis is not connected', async () => {
    isRedisConnected.mockReturnValue(true);
    // not connected takes precedence over the header being present
    isRedisConnected.mockReturnValue(false);

    const err = await runMiddleware(fakeRequest({ 'Idempotency-Key': 'abc' }), fakeResponse());

    expect(err).toBeUndefined();
    expect(get).not.toHaveBeenCalled();
  });

  it('claims a fresh key and calls next() so the handler runs', async () => {
    isRedisConnected.mockReturnValue(true);
    get.mockResolvedValue(null);
    set.mockResolvedValue('OK'); // SET NX succeeded

    const err = await runMiddleware(fakeRequest({ 'Idempotency-Key': 'key-1' }), fakeResponse());

    expect(err).toBeUndefined();
    expect(set).toHaveBeenCalledWith(
      expect.stringContaining('key-1'),
      expect.stringContaining('in_progress'),
      'EX',
      expect.any(Number),
      'NX'
    );
  });

  it('replays a stored completed response instead of calling next()', async () => {
    isRedisConnected.mockReturnValue(true);
    get.mockResolvedValue(JSON.stringify({ status: 'completed', statusCode: 201, body: { data: { id: 'i1' } } }));

    // The replay path resolves the response directly and never calls
    // next() at all, so -- unlike every other case in this file -- the
    // test must wait on res.json() being called, not on next().
    const res = fakeResponse();
    let nextCalled = false;
    const jsonCalled = new Promise<unknown>((resolve) => {
      const originalJson = res.json.bind(res);
      res.json = ((body: unknown) => {
        resolve(body);
        return originalJson(body);
      }) as typeof res.json;
    });

    idempotency(fakeRequest({ 'Idempotency-Key': 'key-2' }), res, () => {
      nextCalled = true;
    });

    await jsonCalled;

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(201);
    expect((res as unknown as { _headers: Record<string, string> })._headers['Idempotent-Replayed']).toBe('true');
  });

  it('rejects a concurrent duplicate (still in_progress) with a 409 AppError', async () => {
    isRedisConnected.mockReturnValue(true);
    get.mockResolvedValue(JSON.stringify({ status: 'in_progress' }));

    const err = await runMiddleware(fakeRequest({ 'Idempotency-Key': 'key-3' }), fakeResponse());

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(409);
  });

  it('rejects with 409 when SET NX loses a race (another request claimed the key first)', async () => {
    isRedisConnected.mockReturnValue(true);
    get.mockResolvedValue(null);
    set.mockResolvedValue(null); // NX failed: key already exists

    const err = await runMiddleware(fakeRequest({ 'Idempotency-Key': 'key-4' }), fakeResponse());

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(409);
  });

  it('stores the completed response once res.json is called after a successful claim', async () => {
    isRedisConnected.mockReturnValue(true);
    get.mockResolvedValue(null);
    set.mockResolvedValueOnce('OK'); // the claim
    set.mockResolvedValueOnce('OK'); // storing the completed record

    const res = fakeResponse();
    await runMiddleware(fakeRequest({ 'Idempotency-Key': 'key-5' }), res);

    res.status(201);
    res.json({ data: { id: 'new-incident' } });

    expect(set).toHaveBeenCalledTimes(2);
    const [, secondCall] = set.mock.calls;
    expect(secondCall[0]).toContain('key-5');
    expect(secondCall[1]).toContain('completed');
  });

  it('does not cache a 5xx response -- it releases the lock instead', async () => {
    isRedisConnected.mockReturnValue(true);
    get.mockResolvedValue(null);
    set.mockResolvedValueOnce('OK'); // the claim
    del.mockResolvedValue(1);

    const res = fakeResponse();
    await runMiddleware(fakeRequest({ 'Idempotency-Key': 'key-6' }), res);

    res.status(500);
    res.json({ error: { message: 'boom' } });

    expect(del).toHaveBeenCalledOnce();
    expect(del.mock.calls[0][0]).toContain('key-6');
  });

  it('fails open when the Redis GET call itself rejects', async () => {
    isRedisConnected.mockReturnValue(true);
    get.mockRejectedValue(new Error('connection reset'));

    const err = await runMiddleware(fakeRequest({ 'Idempotency-Key': 'key-7' }), fakeResponse());

    expect(err).toBeUndefined();
  });
});
