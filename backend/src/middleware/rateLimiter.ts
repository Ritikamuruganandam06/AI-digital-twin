import { RequestHandler } from 'express';
import { getRedisClient, isRedisConnected } from '../config/redis';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../utils/AppError';


const KEY_PREFIX = 'ratelimit';

function clientKey(req: Parameters<RequestHandler>[0]): string {
  return req.ip ?? 'unknown';
}

export const rateLimiter: RequestHandler = (req, res, next) => {
  if (!isRedisConnected()) {
    next();
    return;
  }

  const windowMs = env.rateLimitWindowMs;
  const windowIndex = Math.floor(Date.now() / windowMs);
  const key = `${KEY_PREFIX}:${clientKey(req)}:${windowIndex}`;
  const redis = getRedisClient();

  redis
    .incr(key)
    .then(async (count) => {
      if (count === 1) {
        try {
          await redis.pexpire(key, windowMs);
        } catch (err) {
          logger.warn({ err, key }, 'rate limiter: failed to set window expiry, continuing');
        }
      }

      if (count > env.rateLimitMax) {
        next(new AppError('Too many requests, please try again later', 429));
        return;
      }

      res.setHeader('X-RateLimit-Limit', String(env.rateLimitMax));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, env.rateLimitMax - count)));
      next();
    })
    .catch((err: unknown) => {
      logger.warn({ err }, 'rate limiter: Redis call failed, failing open');
      next();
    });
};
