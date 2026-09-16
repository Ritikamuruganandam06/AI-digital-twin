import { Router } from 'express';
import { listIncidentsHandler, getIncidentHandler, createIncidentHandler } from '../controllers/incidents.controller';
import { authorize } from '../middleware/authorize';
import { idempotency } from '../middleware/idempotency';
export const incidentsRouter = Router();

incidentsRouter.get('/', listIncidentsHandler);
incidentsRouter.get('/:id', getIncidentHandler);
incidentsRouter.post('/', authorize('OPERATOR'), idempotency, createIncidentHandler);
