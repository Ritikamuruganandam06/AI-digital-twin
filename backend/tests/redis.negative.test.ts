import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { connectToRedis, disconnectFromRedis, isRedisConnected } from '../src/config/redis';
import { registerHealthCheck, clearHealthChecks } from '../src/health/registry';
import { checkRedisHealth } from '../src/health/checks/redis.check';
import { getOrSetCache } from '../src/cache/cacheAside';

/**
 * Proves the failure path with a REAL (failing) connection attempt — not a
 * mock of ioredis. Mirrors tests/database.negative.test.ts. The positive
 * path (a real SET/GET/TTL round trip, and cache-aside actually caching)
 * is covered in tests/redis.integration.test.ts against a real local Redis.
 */
describe('Redis connection failure handling', () => {
  afterEach(async () => {
    clearHealthChecks();
    await disconnectFromRedis();
  });

  it(
    'rejects when the target host refuses the connection',
    async () => {
      await expect(connectToRedis('redis://127.0.0.1:1')).rejects.toThrow();
      expect(isRedisConnected()).toBe(false);
    },
    10_000
  );

  it('reports the redis health check as down without a connection', async () => {
    const result = await checkRedisHealth();
    expect(result.status).toBe('down');
  });

  it('GET /health returns 503 when Redis is registered but unreachable', async () => {
    registerHealthCheck('redis', checkRedisHealth);
    const app = createApp();

    const res = await request(app).get('/health');

    expect(res.status).toBe(503);
    expect(res.body.checks.redis.status).toBe('down');
  });

  it('cache-aside falls back to the real source instead of failing when Redis is down', async () => {
    const fetcher = vi.fn().mockResolvedValue({ hello: 'world' });

    const result = await getOrSetCache('some:key', fetcher);

    expect(result.cacheHit).toBe(false);
    expect(result.value).toEqual({ hello: 'world' });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
