import { Router } from 'express';
import { askAssistantHandler } from '../controllers/assistant.controller';

/**
 * Mounted at /api/assistant. Unauthenticated in this phase -- Phase 15
 * adds JWT/RBAC, the same deferral incidents.route.ts already used for
 * POST /api/incidents.
 */
export const assistantRouter = Router();

assistantRouter.post('/ask', askAssistantHandler);
