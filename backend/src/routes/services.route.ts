import { Router } from 'express';
import { listServicesHandler, getServiceHandler, getServiceMetricsHandler } from '../controllers/services.controller';

/**
 * Mounted at /api/services — Phase 6's real digital-twin query surface
 * (contrast /api/diagnostics/pings, which stays a throwaway proof).
 */
export const servicesRouter = Router();

servicesRouter.get('/', listServicesHandler);
servicesRouter.get('/:name', getServiceHandler);
servicesRouter.get('/:name/metrics', getServiceMetricsHandler);
