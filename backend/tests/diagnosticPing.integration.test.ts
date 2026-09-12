import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app';
import { connectToDatabase, disconnectFromDatabase } from '../src/config/database';
import { connectToRedis, disconnectFromRedis, getRedisClient } from '../src/config/redis';
import { env } from '../src/config/env';
import { DiagnosticPing } from '../src/models/diagnosticPing.model';

/**
 * PRODUCTION vs TEST database, kept explicitly separate:
 *
 *   PRODUCTION: src/server.ts -> connectToDatabase() -> env.mongodbUri (a
 *               real MongoDB, e.g. mongodb://localhost:27017/ai-digital-twin)
 *   TEST:       this file -> connectToDatabase(mongod.getUri()) -> a
 *               temporary in-memory MongoDB that exists only for this run
 *
 * mongodb-memory-server is a devDependency only — nothing under src/
 * imports it, so it is structurally impossible for production code to
 * depend on it.
 *
 * This test downloads a real mongod binary on first run (cached afterwards
 * by mongodb-memory-server). It needs outbound network access to
 * fastdl.mongodb.org; if your environment blocks that host, run a local
 * MongoDB instead and point MONGODB_URI at it for manual verification.
 *
 * It also needs a REAL Redis reachable at REDIS_URL (see
 * tests/redis.integration.test.ts for why: Redis DB 15 is used for
 * isolation instead of a memory-server package) — this is what makes the
 * cache-aside assertions below (`cacheHit`) a real, not mocked, proof.
 */
const TEST_REDIS_URL = `${env.redisUrl.replace(/\/\d+$/, '')}/15`;

describe('Diagnostic ping CRUD against a real MongoDB (in-memory) + real Redis cache', () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await connectToDatabase(mongod.getUri());
    await connectToRedis(TEST_REDIS_URL);
  }, 60_000);

  afterEach(async () => {
    await DiagnosticPing.deleteMany({});
    await getRedisClient().flushdb();
  });

  afterAll(async () => {
    await disconnectFromDatabase();
    await disconnectFromRedis();
    await mongod.stop();
  });

  it('creates a ping and reads it back via the repository/API path', async () => {
    const app = createApp();

    const createRes = await request(app).post('/api/diagnostics/pings').send({ message: 'phase-3-proof' });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.message).toBe('phase-3-proof');
    expect(createRes.body.data.id).toBeTruthy();

    const listRes = await request(app).get('/api/diagnostics/pings');

    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(1);
    expect(listRes.body.data[0].message).toBe('phase-3-proof');
    expect(listRes.body.cacheHit).toBe(false); // fresh fetch: POST invalidated the cache
  });

  it('cache-aside: second consecutive read is a cache hit, and a write invalidates it', async () => {
    const app = createApp();

    await request(app).post('/api/diagnostics/pings').send({ message: 'cache-me' });

    const firstRead = await request(app).get('/api/diagnostics/pings');
    expect(firstRead.body.cacheHit).toBe(false); // miss: populates the cache

    const secondRead = await request(app).get('/api/diagnostics/pings');
    expect(secondRead.body.cacheHit).toBe(true); // hit: served from Redis, not Mongo
    expect(secondRead.body.data).toEqual(firstRead.body.data);

    await request(app).post('/api/diagnostics/pings').send({ message: 'invalidator' });

    const afterWrite = await request(app).get('/api/diagnostics/pings');
    expect(afterWrite.body.cacheHit).toBe(false); // the write invalidated the cached list
    expect(afterWrite.body.data).toHaveLength(2);
  });

  it('rejects an empty message with a 400 before touching the database', async () => {
    const app = createApp();

    const res = await request(app).post('/api/diagnostics/pings').send({ message: '   ' });

    expect(res.status).toBe(400);
    const count = await DiagnosticPing.countDocuments();
    expect(count).toBe(0);
  });

  it('orders results newest-first and respects the limit query param', async () => {
    const app = createApp();

    for (const message of ['first', 'second', 'third']) {
      // eslint-disable-next-line no-await-in-loop
      await request(app).post('/api/diagnostics/pings').send({ message });
    }

    const res = await request(app).get('/api/diagnostics/pings?limit=2');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].message).toBe('third');
    expect(res.body.data[1].message).toBe('second');
  });

  it('reports the mongodb health check as ok against the real connection', async () => {
    const { checkMongoHealth } = await import('../src/health/checks/mongodb.check');
    const result = await checkMongoHealth();

    expect(result.status).toBe('ok');
    expect(typeof result.latencyMs).toBe('number');
  });

  it('reports the redis health check as ok against the real connection', async () => {
    const { checkRedisHealth } = await import('../src/health/checks/redis.check');
    const result = await checkRedisHealth();

    expect(result.status).toBe('ok');
    expect(typeof result.latencyMs).toBe('number');
  });
});
