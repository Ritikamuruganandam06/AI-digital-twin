import { Router } from 'express';
import { createPing, listPings } from '../controllers/diagnosticPing.controller';

/**
 * Mounted at /api/diagnostics/pings — a throwaway CRUD proof that the real
 * MongoDB connection works, not a digital-twin domain endpoint. Kept under
 * /diagnostics so it reads as infrastructure, not product API surface.
 */
export const diagnosticPingRouter = Router();

diagnosticPingRouter.post('/', createPing);
diagnosticPingRouter.get('/', listPings);
