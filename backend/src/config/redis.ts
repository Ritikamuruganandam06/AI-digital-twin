import Redis from 'ioredis';
import { env } from './env';
import { logger } from './logger';

/**
 * Redis connection lifecycle, mirroring src/config/database.ts: production
 * calls connectToRedis() with no argument (reads env.redisUrl), tests pass
 * an explicit URL so they can never touch a shared dev/prod Redis instance.
 *
 * lazyConnect: true means `new Redis(...)` never opens a socket by itself —
 * connectToRedis() is the only thing that actually connects, which is what
 * lets server.ts start the HTTP listener even when Redis never comes up.
 */

let client: Redis | null = null;

function createClient(url: string): Redis {
  const redis = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 5000,
    maxRetriesPerRequest: 2,
    // Bounded backoff for reconnection attempts AFTER the initial connect
    // succeeds once and then drops — caps at 2s so a flapping Redis
    // doesn't spin the process, but keeps retrying rather than giving up.
    retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
  });

  redis.on('connect', () => {
    logger.info({ db: 'redis' }, 'Redis connection established');
  });

  redis.on('error', (err) => {
    logger.error({ db: 'redis', err }, 'Redis connection error');
  });

  redis.on('close', () => {
    logger.warn({ db: 'redis' }, 'Redis connection closed');
  });

  return redis;
}

export async function connectToRedis(url: string = env.redisUrl): Promise<void> {
  if (client) {
    await disconnectFromRedis();
  }
  client = createClient(url);
  await client.connect();
}

export async function disconnectFromRedis(): Promise<void> {
  if (!client) return;
  const toClose = client;
  client = null;
  try {
    await toClose.quit();
  } catch {
    toClose.disconnect();
  }
}

export function getRedisClient(): Redis {
  if (!client) {
    throw new Error('Redis client requested before connectToRedis() succeeded');
  }
  return client;
}

export function isRedisConnected(): boolean {
  return client?.status === 'ready';
}
