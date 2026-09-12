import dotenv from 'dotenv';

dotenv.config();

/**
 * Each phase extends this file to read exactly the variables it starts
 * using, rather than validating everything upfront before it's used
 * anywhere. KAFKA_BROKERS / JWT_SECRET / AI_SERVICE_URL still exist only
 * in .env.example, waiting for Phases 5/8/15.
 */
export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  // Phase 3: MongoDB connection string. Falls back to the same local
  // default documented in .env.example so `npm run dev` works out of the
  // box against a locally installed MongoDB.
  mongodbUri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017/ai-digital-twin',
  // Phase 4: Redis connection string and the default cache-aside TTL.
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  redisDefaultTtlSeconds: Number(process.env.REDIS_DEFAULT_TTL_SECONDS ?? 60),
} as const;

export const isProduction = env.nodeEnv === 'production';
