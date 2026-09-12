import { randomUUID } from 'crypto';
import pinoHttp from 'pino-http';
import { logger } from '../config/logger';

/**
 * Per-request access logging. Must run AFTER src/middleware/requestId.ts
 * so req.id already exists — genReqId reuses it instead of minting a
 * second, different id for the same request. The randomUUID() fallback
 * only fires if requestLogger is ever wired up without requestId ahead of
 * it (e.g. a future standalone script), so it never has to return undefined.
 */
export const requestLogger = pinoHttp({
  logger,
  genReqId: (req) => (req as { id?: string }).id ?? randomUUID(),
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.url} -> ${res.statusCode}`,
  customErrorMessage: (req, res, err) => `${req.method} ${req.url} -> ${res.statusCode} (${err.message})`,
});
