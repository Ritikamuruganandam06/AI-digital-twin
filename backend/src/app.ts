import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { requestId } from './middleware/requestId';
import { requestLogger } from './middleware/requestLogger';
import { notFound } from './middleware/notFound';
import { errorHandler } from './middleware/errorHandler';
import { authenticate } from './middleware/authenticate';
import { rateLimiter } from './middleware/rateLimiter';
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


export function createApp(): Application {
  const app = express();

  app.disable('x-powered-by');

  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(requestId);
  app.use(requestLogger);
  app.use('/health', healthRouter);
  app.use('/api', rateLimiter);
  app.use('/api/auth', authRouter);
  app.use('/api/diagnostics/pings', authenticate, diagnosticPingRouter);
  app.use('/api/diagnostics/kafka-messages', authenticate, diagnosticKafkaRouter);
  app.use('/api/services', authenticate, servicesRouter);
  app.use('/api/events', authenticate, eventsRouter);
  app.use('/api/incidents', authenticate, incidentsRouter);
  app.use('/api/assistant', authenticate, assistantRouter);
  app.use('/api/executions', authenticate, agentExecutionsRouter);
  app.use('/internal/tools', toolsRouter);
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
