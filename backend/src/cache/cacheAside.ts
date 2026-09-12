import { getRedisClient, isRedisConnected } from '../config/redis';
import { env } from '../config/env';
import { logger } from '../config/logger';

export interface CacheAsideOptions {
  ttlSeconds?: number;
}

export interface CacheAsideResult<T> {
  value: T;
  cacheHit: boolean;
}

/**
 * The cache-aside pattern from docs/architecture.md §6:
 *
 *   Request -> Redis -> hit? return : miss -> fetcher() -> store in Redis -> return
 *
 * If Redis is unreachable or a read/write fails, this falls back to calling
 * fetcher() directly and reports a miss rather than failing the request —
 * Redis is a cache, not the system of record (docs/architecture.md §6:
 * "nothing becomes the only place a piece of data lives in Redis"), so an
 * outage here should make responses slower, not broken.
 */
export async function getOrSetCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: CacheAsideOptions = {}
): Promise<CacheAsideResult<T>> {
  const ttlSeconds = options.ttlSeconds ?? env.redisDefaultTtlSeconds;

  if (!isRedisConnected()) {
    return { value: await fetcher(), cacheHit: false };
  }

  const redis = getRedisClient();

  try {
    const cached = await redis.get(key);
    if (cached !== null) {
      return { value: JSON.parse(cached) as T, cacheHit: true };
    }
  } catch (err) {
    logger.warn({ err, key }, 'cache read failed, falling back to source');
  }

  const value = await fetcher();

  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err) {
    logger.warn({ err, key }, 'cache write failed, continuing without caching');
  }

  return { value, cacheHit: false };
}

/** Called after a write that makes a cached read stale. */
export async function invalidateCache(key: string): Promise<void> {
  if (!isRedisConnected()) return;
  try {
    await getRedisClient().del(key);
  } catch (err) {
    logger.warn({ err, key }, 'cache invalidation failed');
  }
}
