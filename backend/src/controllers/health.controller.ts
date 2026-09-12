import { RequestHandler } from 'express';
import { runHealthChecks } from '../health/registry';

export const getHealth: RequestHandler = async (_req, res) => {
  const { status, checks } = await runHealthChecks();

  // 503 once any registered dependency reports "down" so uptime monitors
  // and load balancers can act on it, not just humans reading the JSON.
  const httpStatus = status === 'down' ? 503 : 200;

  res.status(httpStatus).json({
    status,
    service: 'ai-digital-twin-backend',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    checks,
  });
};
