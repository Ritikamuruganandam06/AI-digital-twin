import { Router } from 'express';
import { listIncidentsHandler, getIncidentHandler, createIncidentHandler } from '../controllers/incidents.controller';

/**
 * Mounted at /api/incidents. POST is unauthenticated in this phase — Phase
 * 15 adds JWT/RBAC, and Phase 11 adds the agent's privileged (propose-only)
 * create_incident tool on top of this same endpoint.
 */
export const incidentsRouter = Router();

incidentsRouter.get('/', listIncidentsHandler);
incidentsRouter.get('/:id', getIncidentHandler);
incidentsRouter.post('/', createIncidentHandler);
