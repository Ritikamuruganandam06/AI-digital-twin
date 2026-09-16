import { Router } from 'express';
import { listServicesHandler, getServiceHandler, getServiceMetricsHandler } from '../controllers/services.controller';
export const servicesRouter = Router();

servicesRouter.get('/', listServicesHandler);
servicesRouter.get('/:name', getServiceHandler);
servicesRouter.get('/:name/metrics', getServiceMetricsHandler);
