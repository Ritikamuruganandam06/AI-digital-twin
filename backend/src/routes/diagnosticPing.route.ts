import { Router } from 'express';
import { createPing, listPings } from '../controllers/diagnosticPing.controller';

export const diagnosticPingRouter = Router();

diagnosticPingRouter.post('/', createPing);
diagnosticPingRouter.get('/', listPings);
