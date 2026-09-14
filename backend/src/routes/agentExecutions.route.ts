import { Router } from 'express';
import { listAgentExecutionsHandler, getAgentExecutionHandler } from '../controllers/agentExecutions.controller';

/** Mounted at /api/executions -- docs/phases.md row 14: "Trace retrievable via API". */
export const agentExecutionsRouter = Router();

agentExecutionsRouter.get('/', listAgentExecutionsHandler);
agentExecutionsRouter.get('/:id', getAgentExecutionHandler);
