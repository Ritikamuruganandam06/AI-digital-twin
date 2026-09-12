/**
 * Base class for errors we throw deliberately (validation, not-found,
 * forbidden, etc.). Anything that isn't an AppError is treated as an
 * unexpected 500 by the error handler, so operational errors never leak
 * a stack trace to the client and unexpected bugs never get silently
 * reported as a handled 4xx.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(message: string, statusCode = 500, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}
