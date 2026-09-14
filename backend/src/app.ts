import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { requestId } from './middleware/requestId';
import { requestLogger } from './middleware/requestLogger';
import { notFound } from './middleware/notFound';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/authenticate';
import { healthRouter } from './routes/health.route';
import { authRouter } from './routes/auth.route';
import { diagnosticPingRouter } from './routes/diagnosticPing.route';
import { diagnosticKafkaRouter } from './routes/diagnosticKafka.route';
import { servicesRouter } from './routes/services.route';
import { eventsRouter } from './routes/events.route';
import { incidentsRouter } from './routes/incidents.route';
import { assistantRouter } from './routes/assistant.route';
import { agentExecutionsRouter } from './routes/agentExecutions.route';
import { toolsRouter } from './tools/tools.route';

/**
 * Builds an Express app without starting a listener. Kept separate from
 * server.ts so tests (tests/health.test.ts) can exercise the app directly
 * with supertest instead of binding a real port.
 */
export function createApp(): Application {
  const app = express();

  app.disable('x-powered-by');

  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  // Order matters: requestId must run before requestLogger so the logger
  // can reuse req.id instead of generating a second, different one.
  app.use(requestId);
  app.use(requestLogger);

  // Phase 15: authenticate is wired explicitly per mount, not globally,
  // so the auth boundary is visible right here rather than only
  // documented — the same "grouping is enforced, not just documented"
  // ethos docs/architecture.md §10 established for tool privilege tiers.
  //
  // /health and /api/auth stay unauthenticated on purpose (you can't be
  // required to hold a JWT to get one, or to check if the server is up).
  // /internal/tools stays outside JWT auth too: it's a separate
  // service-to-service trust boundary between the AI service and this
  // backend (docs/architecture.md §15), not user-facing RBAC.
  app.use('/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/diagnostics/pings', authenticate, diagnosticPingRouter);
  app.use('/api/diagnostics/kafka-messages', authenticate, diagnosticKafkaRouter);
  app.use('/api/services', authenticate, servicesRouter);
  app.use('/api/events', authenticate, eventsRouter);
  app.use('/api/incidents', authenticate, incidentsRouter);
  app.use('/api/assistant', authenticate, assistantRouter);
  app.use('/api/executions', authenticate, agentExecutionsRouter);
  app.use('/internal/tools', toolsRouter);

  // Must be last: notFound catches anything no router matched, errorHandler
  // catches anything thrown/passed to next() by everything above it.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
