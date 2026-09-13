import { Router } from 'express';
import {
  getServicesToolHandler,
  getServiceToolHandler,
  getDependenciesToolHandler,
  getDependentsToolHandler,
  getServiceMetricsToolHandler,
  getRecentEventsToolHandler,
  getIncidentHistoryToolHandler,
  getCurrentSystemStateToolHandler,
  recommendScalingToolHandler,
  createIncidentToolHandler,
} from './tools.controller';
import {
  simulateServiceFailureToolHandler,
  simulateTrafficIncreaseToolHandler,
  simulateDatabaseFailureToolHandler,
  simulateCacheFailureToolHandler,
  simulateHighLatencyToolHandler,
  simulateHighErrorRateToolHandler,
  calculateBlastRadiusToolHandler,
  findBottleneckToolHandler,
} from './simulationTools.controller';

/**
 * Mounted at /internal/tools — docs/architecture.md §4's "Internal HTTP
 * endpoints the AI service calls as tools" and §10's "Tool-calling
 * architecture" privilege groups, made concrete. Every route here maps
 * 1:1 to one named tool in ai-service/app/tools/schemas.py (Phase 10) —
 * the route path is not itself part of the tool contract the LLM sees
 * (the LLM only ever sees the tool's name + JSON-schema parameters); this
 * file and that one are kept in sync by hand, documented on both sides.
 *
 * Distinct from /api/* (Phase 6's public query surface a frontend would
 * use): same underlying data and business logic, but uncached, and not
 * meant for a browser — only for the AI service's tool executor.
 */
export const toolsRouter = Router();

// Read-only
toolsRouter.get('/services', getServicesToolHandler);
toolsRouter.get('/services/:name', getServiceToolHandler);
toolsRouter.get('/services/:name/dependencies', getDependenciesToolHandler);
toolsRouter.get('/services/:name/dependents', getDependentsToolHandler);
toolsRouter.get('/services/:name/metrics', getServiceMetricsToolHandler);
toolsRouter.get('/events', getRecentEventsToolHandler);
toolsRouter.get('/incidents', getIncidentHistoryToolHandler);
toolsRouter.get('/system-state', getCurrentSystemStateToolHandler);

// Simulation (deterministic, read-only w.r.t. real state)
toolsRouter.post('/simulate/service-failure', simulateServiceFailureToolHandler);
toolsRouter.post('/simulate/traffic-increase', simulateTrafficIncreaseToolHandler);
toolsRouter.post('/simulate/database-failure', simulateDatabaseFailureToolHandler);
toolsRouter.post('/simulate/cache-failure', simulateCacheFailureToolHandler);
toolsRouter.post('/simulate/high-latency', simulateHighLatencyToolHandler);
toolsRouter.post('/simulate/high-error-rate', simulateHighErrorRateToolHandler);
toolsRouter.get('/blast-radius/:name', calculateBlastRadiusToolHandler);
toolsRouter.get('/bottleneck', findBottleneckToolHandler);

// Privileged
toolsRouter.get('/recommend-scaling/:name', recommendScalingToolHandler);
toolsRouter.post('/create-incident', createIncidentToolHandler);
