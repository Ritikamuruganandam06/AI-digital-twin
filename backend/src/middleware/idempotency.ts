import { RequestHandler } from 'express';
import { getRedisClient, isRedisConnected } from '../config/redis';
import { logger } from '../config/logger';
import { AppError } from '../utils/AppError';

/**
 * Redis-backed idempotency (docs/phases.md row 16 / docs/architecture.md
 * §17: "idempotency"). Opt-in via an `Idempotency-Key` request header --
 * the standard REST/Stripe-style convention -- so a client that retries a
 * write after a dropped connection or timeout (never knowing whether its
 * first attempt actually landed) can safely resend the exact same request
 * and get back the exact same response, without the operation happening
 * twice.
 *
 * Wired ONLY to `POST /api/incidents` (src/routes/incidents.route.ts) --
 * the one real, reachable, mutating endpoint with genuine client-retry
 * risk. Deliberately NOT applied to `POST /internal/tools/create-incident`
 * (app/tools/backend_tools_client.py's `create_incident()` on the AI
 * service side): that function's own docstring says it "is not called by
 * app/tools/executor.py's normal dispatch path" -- kept only for a future,
 * explicitly-authorized approval flow -- so it is genuinely unreachable
 * today and adding idempotency there now would be speculative.
 *
 * Concurrency: a Redis `SET ... NX` claims the key before the handler
 * runs, storing an `in_progress` marker; a second request arriving with
 * the same key while the first is still running loses that race and gets
 * a 409 rather than running the handler concurrently. Once the handler
 * finishes, res.json is (transparently, via a per-request wrapper) the
 * point where the real response is captured and stored as `completed` --
 * a later request with the same key replays that stored response instead
 * of running the handler again. A response with a 5xx status is
 * deliberately NOT cached -- it releases the lock instead -- so a retry
 * after a genuine transient server failure can actually try again rather
 * than being handed back the same failure forever.
 *
 * Fails OPEN: if Redis is unreachable, or any Redis call throws, the
 * handler just runs normally with no idempotency guarantee for that one
 * request -- the same posture src/middleware/rateLimiter.ts and
 * src/cache/cacheAside.ts already take.
 */

const KEY_PREFIX = 'idempotency';
// How long a claimed-but-not-yet-finished key blocks a concurrent
// duplicate. Comfortably longer than this endpoint should ever take, but
// short enough that a crashed request (one that claimed the key and then
// the process died before responding) doesn't block that key forever.
const LOCK_TTL_SECONDS = 30;
// How long a completed response is remembered and replayed for. A client
// retrying "for a while" after a dropped connection is the scenario this
// protects; a day is generous without being unbounded.
const RESULT_TTL_SECONDS = 24 * 60 * 60;

interface StoredRecord {
  status: 'in_progress' | 'completed';
  statusCode?: number;
  body?: unknown;
}

export const idempotency: RequestHandler = (req, res, next) => {
  const key = req.header('Idempotency-Key');
  if (!key || key.trim().length === 0) {
    // Opt-in: no header means the caller doesn't want idempotency
    // guarantees for this request, so the handler just runs normally.
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
        // Still in_progress -- a genuinely concurrent duplicate. Reported
        // via next(), not a throw: this is an intentional 409, not a
        // Redis failure, and must NOT be swallowed by the catch below
        // (which exists only to fail open on an actual Redis error).
        next(new AppError('A request with this Idempotency-Key is already being processed', 409));
        return;
      }

      const claimed = await redis.set(redisKey, JSON.stringify({ status: 'in_progress' } satisfies StoredRecord), 'EX', LOCK_TTL_SECONDS, 'NX');
      if (claimed === null) {
        // Lost a race: another request claimed this key between our GET
        // and this SET NX.
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
