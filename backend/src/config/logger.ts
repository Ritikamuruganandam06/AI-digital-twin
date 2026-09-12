import pino from 'pino';
import { env, isProduction } from './env';

/**
 * Structured logging (pino): every log line is a JSON object in production,
 * so it can later be shipped/queried by request id, correlation id, or
 * agent execution id (Phase 14+) without regex-scraping text logs.
 * In development, pino-pretty renders those same JSON lines as readable
 * colored text — the structure never changes between environments, only
 * the presentation.
 */
export const logger = pino({
  level: env.logLevel,
  transport: isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      },
});
