import mongoose from 'mongoose';
import { HealthCheckResult } from '../registry';
import { isDatabaseConnected } from '../../config/database';

/**
 * Registered once, in server.ts, via registerHealthCheck('mongodb', ...).
 * Pings the real server rather than trusting readyState alone — readyState
 * can say "connected" for a connection whose server has since become
 * unreachable until the next operation actually fails.
 */
export async function checkMongoHealth(): Promise<HealthCheckResult> {
  if (!isDatabaseConnected()) {
    return { status: 'down', message: `not connected (readyState=${mongoose.connection.readyState})` };
  }

  const startedAt = Date.now();
  try {
    await mongoose.connection.db?.admin().ping();
    return { status: 'ok', latencyMs: Date.now() - startedAt };
  } catch (err) {
    return { status: 'down', message: err instanceof Error ? err.message : 'ping failed' };
  }
}
