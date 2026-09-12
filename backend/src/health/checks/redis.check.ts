import { randomUUID } from 'crypto';
import { getRedisClient, isRedisConnected } from '../../config/redis';
import { HealthCheckResult } from '../registry';

const CANARY_KEY = 'health:redis:canary';
const CANARY_TTL_SECONDS = 30;

/**
 * This is the project's live SET -> GET -> verify TTL proof (docs/architecture.md
 * §21), not just a PING: every call to GET /health writes a fresh random
 * value with a TTL, reads it back, and checks both the value and that the
 * TTL was actually applied — a real correctness check, not just reachability.
 */
export async function checkRedisHealth(): Promise<HealthCheckResult> {
  if (!isRedisConnected()) {
    return { status: 'down', message: 'not connected' };
  }

  const startedAt = Date.now();
  const redis = getRedisClient();
  const expected = randomUUID();

  try {
    await redis.set(CANARY_KEY, expected, 'EX', CANARY_TTL_SECONDS);
    const actual = await redis.get(CANARY_KEY);
    const ttl = await redis.ttl(CANARY_KEY);

    if (actual !== expected) {
      return { status: 'down', message: 'SET/GET round trip returned a mismatched value' };
    }
    if (ttl <= 0) {
      return { status: 'down', message: 'TTL was not applied to the canary key' };
    }

    return { status: 'ok', latencyMs: Date.now() - startedAt };
  } catch (err) {
    return { status: 'down', message: err instanceof Error ? err.message : 'redis check failed' };
  }
}
