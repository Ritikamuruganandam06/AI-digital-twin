import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { env } from '../src/config/env';
import { connectToRedis, disconnectFromRedis, getRedisClient } from '../src/config/redis';
import { checkRedisHealth } from '../src/health/checks/redis.check';
import { getOrSetCache, invalidateCache } from '../src/cache/cacheAside';

/**
 * Requires a REAL Redis reachable at REDIS_URL (the same one Phase 1's
 * prerequisites ask you to install locally — there is no "redis-memory-server"
 * equivalent to mongodb-memory-server used here, on purpose: Redis already
 * supports 16 isolated logical databases out of the box, so this suite
 * connects to logical database 15 instead of database 0 (Redis DB indexing
 * is 0-based; there is no database 16) and flushes ONLY that database
 * before/after — your real dev data in database 0 is never touched.
 *
 * If no Redis is running, every test in this file fails at beforeAll with a
 * connection error — that's a missing local dependency, not a bug here.
 */
const TEST_REDIS_URL = `${env.redisUrl.replace(/\/\d+$/, '')}/15`;

describe('Redis cache-aside against a real local Redis (logical db 15)', () => {
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

  it('performs a real SET -> GET -> TTL round trip via the health check', async () => {
    const result = await checkRedisHealth();

    expect(result.status).toBe('ok');
    expect(typeof result.latencyMs).toBe('number');

    const ttl = await getRedisClient().ttl('health:redis:canary');
    expect(ttl).toBeGreaterThan(0);
  });

  it('getOrSetCache: misses once, then hits on the next call for the same key', async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return { count: calls };
    };

    const first = await getOrSetCache('test:counter', fetcher, { ttlSeconds: 5 });
    expect(first.cacheHit).toBe(false);
    expect(first.value).toEqual({ count: 1 });

    const second = await getOrSetCache('test:counter', fetcher, { ttlSeconds: 5 });
    expect(second.cacheHit).toBe(true);
    expect(second.value).toEqual({ count: 1 }); // cached value, fetcher not called again
    expect(calls).toBe(1);
  });

  it('respects the TTL: an expired key is treated as a miss', async () => {
    await getOrSetCache('test:ttl', async () => 'value', { ttlSeconds: 1 });

    await new Promise((resolve) => setTimeout(resolve, 1200));

    const raw = await getRedisClient().get('test:ttl');
    expect(raw).toBeNull();
  }, 5_000);

  it('invalidateCache deletes the key so the next read is a real miss', async () => {
    await getOrSetCache('test:invalidate', async () => 'first-value', { ttlSeconds: 30 });
    await invalidateCache('test:invalidate');

    const raw = await getRedisClient().get('test:invalidate');
    expect(raw).toBeNull();

    const after = await getOrSetCache('test:invalidate', async () => 'second-value', { ttlSeconds: 30 });
    expect(after.cacheHit).toBe(false);
    expect(after.value).toBe('second-value');
  });
});
