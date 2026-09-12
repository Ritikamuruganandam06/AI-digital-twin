import mongoose from 'mongoose';
import { env } from './env';
import { logger } from './logger';

/**
 * MongoDB connection lifecycle, kept separate from any one route/model so
 * every phase after this one (digital twin models in Phase 6, agent
 * execution traces in Phase 14, ...) shares one connection instead of each
 * opening its own.
 *
 * Production always calls connectToDatabase() with no argument, which
 * reads env.mongodbUri (MONGODB_URI). Tests pass an explicit URI —
 * normally one from mongodb-memory-server — so a test run can never
 * accidentally touch a real database, and production code can never
 * accidentally depend on a test-only package (mongodb-memory-server is a
 * devDependency; it is not imported anywhere under src/).
 */

mongoose.connection.on('connected', () => {
  logger.info({ db: 'mongodb' }, 'MongoDB connection established');
});

mongoose.connection.on('error', (err) => {
  logger.error({ db: 'mongodb', err }, 'MongoDB connection error');
});

mongoose.connection.on('disconnected', () => {
  logger.warn({ db: 'mongodb' }, 'MongoDB disconnected');
});

export async function connectToDatabase(uri: string = env.mongodbUri): Promise<void> {
  await mongoose.connect(uri, {
    // Fail fast instead of hanging the whole request/startup path when
    // Mongo isn't reachable — matches "do not silently swallow errors."
    serverSelectionTimeoutMS: 5000,
  });
}

export async function disconnectFromDatabase(): Promise<void> {
  await mongoose.disconnect();
}

/** readyState: 0 disconnected, 1 connected, 2 connecting, 3 disconnecting. */
export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
