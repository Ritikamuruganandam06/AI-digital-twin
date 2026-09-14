import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Response } from 'express';
import { env } from '../src/config/env';
import { connectToRedis, disconnectFromRedis, getRedisClient } from '../src/config/redis';
import { rateLimiter } from '../src/middleware/rateLimiter';
import { AppError } from '../src/utils/AppError';

/**
 * Requires a REAL Redis reachable at REDIS_URL, same DB-15-isolation
 * convention as tests/redis.integration.test.ts -- see that file's own
 * doc comment for why. If no Redis is running, every test here fails at
 * beforeAll with a connection error, which is a missing local dependency,
 * not a bug in this suite.
 */
const TEST_REDIS_URL = `${env.redisUrl.replace(/\/\d+$/, '')}/15`;

function fakeRequest(ip: string) {
  return { ip } as unknown as Parameters<typeof rateLimiter>[0];
}

function fakeResponse(): Response {
  return { setHeader: () => undefined } as unknown as Response;
}

function runMiddleware(ip: string): Promise<unknown> {
  return new Promise((resolve) => {
    rateLimiter(fakeRequest(ip), fakeResponse(), (err?: unknown) => resolve(err));
  });
}

describe('rateLimiter against a real local Redis (logical db 15)', () => {
  beforeAll(async () => {
    await connectToRedis(TEST_REDIS_URL);
  }, 10_000);

  beforeEach(async () => {
    await getRedisClient().flushdb();
  });

  afterAll(async () => {
    await getRedisClient().flushdb();
    await disconnectFromRedis();
  });

  it('allows requests under RATE_LIMIT_MAX and blocks the one that exceeds it', async () => {
    const ip = '10.0.0.1';

    for (let i = 0; i < env.rateLimitMax; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const err = await runMiddleware(ip);
      expect(err).toBeUndefined();
    }

    const blockedErr = await runMiddleware(ip);
    expect(blockedErr).toBeInstanceOf(AppError);
    expect((blockedErr as AppError).statusCode).toBe(429);
  }, 15_000);

  it('tracks separate counters per IP -- one client being rate limited does not affect another', async () => {
    for (let i = 0; i < env.rateLimitMax; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await runMiddleware('10.0.0.2');
    }
    const blockedErr = await runMiddleware('10.0.0.2');
    expect(blockedErr).toBeInstanceOf(AppError);

    const otherClientErr = await runMiddleware('10.0.0.3');
    expect(otherClientErr).toBeUndefined();
  }, 15_000);

  it('sets a real expiry (PEXPIRE) on the window key so it does not live forever', async () => {
    await runMiddleware('10.0.0.4');

    const windowMs = env.rateLimitWindowMs;
    const windowIndex = Math.floor(Date.now() / windowMs);
    const key = `ratelimit:10.0.0.4:${windowIndex}`;

    const ttl = await getRedisClient().pttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(windowMs);
  });
});
