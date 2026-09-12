import { RequestHandler } from 'express';

/**
 * Catches anything that fell through every route. Registered after all
 * routers in src/app.ts.
 */
export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({
    error: {
      message: `Route not found: ${req.method} ${req.originalUrl}`,
      requestId: req.id,
    },
  });
};
