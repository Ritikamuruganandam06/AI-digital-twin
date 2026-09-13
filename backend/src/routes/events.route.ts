import { Router } from 'express';
import { listEventsHandler } from '../controllers/events.controller';

/** Mounted at /api/events — recent service lifecycle/operational events, optionally filtered by ?service=name. */
export const eventsRouter = Router();

eventsRouter.get('/', listEventsHandler);
