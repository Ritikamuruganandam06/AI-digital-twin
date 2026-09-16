import { RequestHandler } from 'express';
import { getRedisClient, isRedisConnected } from '../config/redis';
import { logger } from '../config/logger';
import { AppError } from '../utils/AppError';

const KEY_PREFIX = 'idempotency';
const LOCK_TTL_SECONDS = 30;
const RESULT_TTL_SECONDS = 24 * 60 * 60;

interface StoredRecord {
  status: 'in_progress' | 'completed';
  statusCode?: number;
  body?: unknown;
}

export const idempotency: RequestHandler = (req, res, next) => {
  const key = req.header('Idempotency-Key');
  if (!key || key.trim().length === 0) {
    next();
    return;
  }

  if (!isRedisConnected()) {
    next();
    return;
  }

  const redisKey = `${KEY_PREFIX}:${req.method}:${req.originalUrl}:${key}`;
  const redis = getRedisClient();

  void (async () => {
    try {
      const existingRaw = await redis.get(redisKey);
      if (existingRaw) {
        const existing = JSON.parse(existingRaw) as StoredRecord;
        if (existing.status === 'completed') {
          res.setHeader('Idempotent-Replayed', 'true');
          res.status(existing.statusCode ?? 200).json(existing.body);
          return;
        }
        next(new AppError('A request with this Idempotency-Key is already being processed', 409));
        return;
      }

      const claimed = await redis.set(redisKey, JSON.stringify({ status: 'in_progress' } satisfies StoredRecord), 'EX', LOCK_TTL_SECONDS, 'NX');
      if (claimed === null) {
        next(new AppError('A request with this Idempotency-Key is already being processed', 409));
        return;
      }

      const originalJson = res.json.bind(res);
      res.json = ((body: unknown) => {
        if (res.statusCode >= 500) {
          redis.del(redisKey).catch((err: unknown) => {
            logger.warn({ err, redisKey }, 'idempotency: failed to release lock after a server error');
          });
        } else {
          const record: StoredRecord = { status: 'completed', statusCode: res.statusCode, body };
          redis.set(redisKey, JSON.stringify(record), 'EX', RESULT_TTL_SECONDS).catch((err: unknown) => {
            logger.warn({ err, redisKey }, 'idempotency: failed to store completed response');
          });
        }
        return originalJson(body);
      }) as typeof res.json;

      next();
    } catch (err) {
      logger.warn({ err, redisKey }, 'idempotency: Redis call failed, failing open');
      next();
    }
  })();
};
