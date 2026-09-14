import dotenv from 'dotenv';

dotenv.config();

/**
 * Each phase extends this file to read exactly the variables it starts
 * using, rather than validating everything upfront before it's used
 * anywhere. AI_SERVICE_URL was in the same position from Phase 1 until
 * Phase 14 finally added the code that calls it
 * (src/clients/aiServiceClient.ts); JWT_SECRET/JWT_EXPIRES_IN were the same
 * from Phase 1 until Phase 15 added src/utils/jwt.ts.
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
  // Phase 5: Kafka broker list (comma-separated), client id, and the
  // default consumer group id for this backend's own consumers.
  kafkaBrokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',').map((b) => b.trim()),
  kafkaClientId: process.env.KAFKA_CLIENT_ID ?? 'ai-digital-twin-backend',
  kafkaConsumerGroup: process.env.KAFKA_CONSUMER_GROUP ?? 'ai-digital-twin-backend-group',
  // Phase 14: base URL of the Python AI service, used by
  // src/clients/aiServiceClient.ts. Same local-default convention as
  // every other *Uri/*Url above.
  aiServiceUrl: process.env.AI_SERVICE_URL ?? 'http://localhost:8000',
  // Phase 15: JWT signing secret + access-token lifetime, used by
  // src/utils/jwt.ts. The fallback below is the same local-dev placeholder
  // documented in .env.example ("change-me-in-local-env") — never a real
  // secret, and never what a deployed environment should actually use;
  // production is expected to set a real JWT_SECRET, same as every other
  // "local default, production sets it for real" var above.
  jwtSecret: process.env.JWT_SECRET ?? 'change-me-in-local-env',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
} as const;

export const isProduction = env.nodeEnv === 'production';
