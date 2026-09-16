import { RequestHandler } from 'express';
import { assertDatabaseConnected } from '../config/database';
import { getServiceTopology, listServices } from '../services/topology.service';
import { serviceRepository } from '../repositories/service.repository';
import { serviceMetricRepository } from '../repositories/serviceMetric.repository';
import { getOrSetCache } from '../cache/cacheAside';
import { AppError } from '../utils/AppError';

const SERVICES_LIST_CACHE_KEY = 'twin:services:all';
const SERVICES_LIST_CACHE_TTL_SECONDS = 30;

export const listServicesHandler: RequestHandler = async (_req, res, next) => {
  try {
    assertDatabaseConnected();

    const { value: services, cacheHit } = await getOrSetCache(SERVICES_LIST_CACHE_KEY, () => listServices(), {
      ttlSeconds: SERVICES_LIST_CACHE_TTL_SECONDS,
    });

    res.status(200).json({ data: services, cacheHit });
  } catch (err) {
    next(err);
  }
};

export const getServiceHandler: RequestHandler = async (req, res, next) => {
  try {
    assertDatabaseConnected();

    const name = String(req.params.name ?? '').toLowerCase().trim();
    const topology = await getServiceTopology(name);

    if (!topology) {
      throw new AppError(`Service "${name}" not found`, 404);
    }

    res.status(200).json({ data: topology });
  } catch (err) {
    next(err);
  }
};

export const getServiceMetricsHandler: RequestHandler = async (req, res, next) => {
  try {
    assertDatabaseConnected();

    const name = String(req.params.name ?? '').toLowerCase().trim();
    const requested = Number(req.query.limit ?? 20);
    const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), 200) : 20;

    const service = await serviceRepository.findByName(name);
    if (!service) {
      throw new AppError(`Service "${name}" not found`, 404);
    }

    const metrics = await serviceMetricRepository.findRecentByServiceId(service.id, limit);
    res.status(200).json({ data: metrics });
  } catch (err) {
    next(err);
  }
};
