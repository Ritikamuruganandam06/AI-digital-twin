import { RequestHandler } from 'express';
import { diagnosticPingRepository } from '../repositories/diagnosticPing.repository';
import { assertDatabaseConnected } from '../config/database';
import { getOrSetCache, invalidateCache } from '../cache/cacheAside';
import { AppError } from '../utils/AppError';
const RECENT_PINGS_CACHE_KEY = 'diagnostics:pings:recent:top100';
const RECENT_PINGS_CACHE_TTL_SECONDS = 30;

export const createPing: RequestHandler = async (req, res, next) => {
  try {
    assertDatabaseConnected();

    const { message } = req.body ?? {};
    if (typeof message !== 'string' || message.trim().length === 0) {
      throw new AppError('message is required and must be a non-empty string', 400);
    }

    const record = await diagnosticPingRepository.create(message.trim());
    await invalidateCache(RECENT_PINGS_CACHE_KEY);

    res.status(201).json({ data: record });
  } catch (err) {
    next(err);
  }
};

export const listPings: RequestHandler = async (req, res, next) => {
  try {
    assertDatabaseConnected();

    const requested = Number(req.query.limit ?? 10);
    const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), 100) : 10;

    const { value: top100, cacheHit } = await getOrSetCache(
      RECENT_PINGS_CACHE_KEY,
      () => diagnosticPingRepository.findRecent(100),
      { ttlSeconds: RECENT_PINGS_CACHE_TTL_SECONDS }
    );

    res.status(200).json({ data: top100.slice(0, limit), cacheHit });
  } catch (err) {
    next(err);
  }
};
