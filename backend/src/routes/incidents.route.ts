import { Router } from 'express';
import { listIncidentsHandler, getIncidentHandler, createIncidentHandler } from '../controllers/incidents.controller';
import { authorize } from '../middleware/authorize';

/**
 * Mounted at /api/incidents behind src/middleware/authenticate.ts (see
 * src/app.ts). POST additionally requires OPERATOR — creating an incident
 * is a real write with operational consequences, matching
 * docs/architecture.md §10's "privileged actions ... require explicit
 * user/operator approval" posture for create_incident, whether it's filed
 * by a human here or (Phase 11's propose-only agent tool) through this same
 * endpoint. GET stays at plain USER — reading incident history isn't
 * privileged.
 */
export const incidentsRouter = Router();

incidentsRouter.get('/', listIncidentsHandler);
incidentsRouter.get('/:id', getIncidentHandler);
incidentsRouter.post('/', authorize('OPERATOR'), createIncidentHandler);
