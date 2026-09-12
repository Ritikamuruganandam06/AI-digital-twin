import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { connectToDatabase, disconnectFromDatabase } from './config/database';
import { connectToRedis, disconnectFromRedis } from './config/redis';
import { registerHealthCheck } from './health/registry';
import { checkMongoHealth } from './health/checks/mongodb.check';
import { checkRedisHealth } from './health/checks/redis.check';

registerHealthCheck('mongodb', checkMongoHealth);
registerHealthCheck('redis', checkRedisHealth);

const app = createApp();

async function start(): Promise<void> {
  try {
    await connectToDatabase();
  } catch (err) {
    // Do not crash the process: GET /health will correctly report MongoDB
    // as "down" via the registered check above, and every route that
    // doesn't touch the database keeps working. Crashing here would turn a
    // database outage into a total backend outage, which is strictly worse.
    logger.error({ err }, 'failed to connect to MongoDB on startup — continuing without it');
  }

  try {
    await connectToRedis();
  } catch (err) {
    // Same reasoning as MongoDB above: Redis is a cache, not the system of
    // record (docs/architecture.md §6) — the app should run slower without
    // it, not refuse to start. src/cache/cacheAside.ts already falls back
    // to the real data source whenever Redis is unreachable.
    logger.error({ err }, 'failed to connect to Redis on startup — continuing without it');
  }

  const server = app.listen(env.port, () => {
    logger.info(`backend listening on port ${env.port} (${env.nodeEnv})`);
  });

  /**
   * Graceful shutdown: stop accepting new connections, let in-flight ones
   * finish, then close the MongoDB and Redis connections before exiting —
   * rather than dropping requests or leaving dangling connections when the
   * process is killed.
   */
  function shutdown(signal: string): void {
    logger.info(`received ${signal}, shutting down`);
    server.close((err) => {
      if (err) {
        logger.error({ err }, 'error during shutdown');
        process.exit(1);
        return;
      }
      Promise.allSettled([disconnectFromDatabase(), disconnectFromRedis()])
        .then((results) => {
          results.forEach((result) => {
            if (result.status === 'rejected') {
              logger.error({ err: result.reason }, 'error during connection shutdown');
            }
          });
        })
        .finally(() => process.exit(0));
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();
