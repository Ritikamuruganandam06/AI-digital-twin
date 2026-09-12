import { ErrorRequestHandler } from 'express';
import { AppError } from '../utils/AppError';

/**
 * Centralized error handling: every thrown/next(err) error ends up here
 * exactly once, so we never have duplicate error-response logic scattered
 * across controllers and never silently swallow an error. Must be
 * registered last in src/app.ts (Express identifies error middleware by
 * its 4-argument signature).
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const message = isAppError ? err.message : 'Internal server error';

  req.log?.error({ err, requestId: req.id }, 'request failed');

  res.status(statusCode).json({
    error: {
      message,
      requestId: req.id,
      ...(isAppError && err.details !== undefined ? { details: err.details } : {}),
    },
  });
};
