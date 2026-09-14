import { RequestHandler } from 'express';
import { getRedisClient, isRedisConnected } from '../config/redis';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../utils/AppError';

/**
 * Fixed-window rate limiting (docs/phases.md row 16 / docs/architecture.md
 * §17: "rate limiting"). RATE_LIMIT_WINDOW_MS/RATE_LIMIT_MAX have sat in
 * .env.example and docs/env-vars.md unused since Phase 1 -- this is the
 * first code that reads them (src/config/env.ts) or does anything with
 * them.
 *
 * Redis-backed so every backend process shares one counter per key rather
 * than each process tracking its own (a real concern once this ever runs
 * as more than one instance) -- the same "Redis as shared state, not just
 * a cache" role src/cache/cacheAside.ts already plays. Implementation is a
 * classic fixed window: `INCR` a key named for the current window, and
 * `PEXPIRE` it (only on the first increment of that window) so it expires
 * on its own once the window ends. A fixed window can allow a short burst
 * right at a window boundary (2x the limit across the boundary) compared
 * to a sliding window -- an accepted, standard trade-off for how much
 * simpler it is, and more than adequate for "protect the API from being
 * hammered," which is the concrete failure mode this solves.
 *
 * Applied broadly to /api/* in src/app.ts (not /health -- nothing to
 * protect; not /internal/tools -- that's the AI-service<->backend trust
 * boundary, not user-facing traffic, docs/architecture.md §15). Keyed by
 * IP rather than by authenticated user id, specifically so it sits in
 * front of authenticate and also protects POST /api/auth/login and
 * /api/auth/register from credential-stuffing/brute-force, not just
 * already-authenticated traffic.
 *
 * Fails OPEN: if Redis is unreachable, or any Redis call throws, the
 * request is allowed through rather than rejected -- the same posture
 * cacheAside.ts and invalidateCache() already take ("an outage here
 * should make responses slower/less-protected, not broken"). Rate
 * limiting is a defensive layer, not a correctness guarantee this app
 * depends on to function.
 */

const KEY_PREFIX = 'ratelimit';

function clientKey(req: Parameters<RequestHandler>[0]): string {
  // req.ip respects Express's `trust proxy` setting (not enabled here),
  // so in this deployment it is the direct TCP peer address -- adequate
  // for the "don't let one source hammer us" goal without adding a new
  // dependency on trusting proxy headers this app doesn't otherwise use.
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
        // Only the increment that created this window's key sets its
        // expiry -- every later increment in the same window just bumps
        // the count, so the TTL always reflects the window's own end,
        // not a moving target reset on every request.
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
