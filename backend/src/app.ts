import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { requestId } from './middleware/requestId';
import { requestLogger } from './middleware/requestLogger';
import { notFound } from './middleware/notFound';
import { errorHandler } from './middleware/errorHandler';
import { healthRouter } from './routes/health.route';
import { diagnosticPingRouter } from './routes/diagnosticPing.route';
import { diagnosticKafkaRouter } from './routes/diagnosticKafka.route';
import { servicesRouter } from './routes/services.route';
import { eventsRouter } from './routes/events.route';
import { incidentsRouter } from './routes/incidents.route';
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

  app.use('/health', healthRouter);
  app.use('/api/diagnostics/pings', diagnosticPingRouter);
  app.use('/api/diagnostics/kafka-messages', diagnosticKafkaRouter);
  app.use('/api/services', servicesRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api/incidents', incidentsRouter);
  app.use('/internal/tools', toolsRouter);

  // Must be last: notFound catches anything no router matched, errorHandler
  // catches anything thrown/passed to next() by everything above it.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
