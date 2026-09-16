import { ErrorRequestHandler } from 'express';
import { AppError } from '../utils/AppError';

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
