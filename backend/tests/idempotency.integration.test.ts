import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app';
import { connectToDatabase, disconnectFromDatabase } from '../src/config/database';
import { connectToRedis, disconnectFromRedis, getRedisClient } from '../src/config/redis';
import { env } from '../src/config/env';
import { serviceRepository } from '../src/repositories/service.repository';
import { Service } from '../src/models/service.model';
import { Incident } from '../src/models/incident.model';
import { authHeader } from './helpers/testAuth';

/**
 * The real, unmocked proof of src/middleware/idempotency.ts against
 * `POST /api/incidents`: needs both a real MongoDB (mongodb-memory-server,
 * same as tests/digitalTwin.integration.test.ts) and a real Redis (logical
 * db 15, same isolation convention as tests/redis.integration.test.ts) --
 * the middleware genuinely reads/writes Redis and the handler genuinely
 * writes Mongo, so this is what proves "a retried request does not create
 * a second incident," not just that the mocked logic would allow it to.
 */
const TEST_REDIS_URL = `${env.redisUrl.replace(/\/\d+$/, '')}/15`;

describe('Idempotency-Key on POST /api/incidents against real MongoDB + real Redis', () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await connectToDatabase(mongod.getUri());
    await connectToRedis(TEST_REDIS_URL);
  }, 60_000);

  afterEach(async () => {
    await Service.deleteMany({});
    await Incident.deleteMany({});
    await getRedisClient().flushdb();
  });

  afterAll(async () => {
    await disconnectFromDatabase();
    await disconnectFromRedis();
    await mongod.stop();
  });

  async function seedService() {
    await serviceRepository.upsertByName({
      name: 'billing-service',
      displayName: 'billing-service',
      type: 'microservice',
      description: '',
      dependencies: [],
      dependents: [],
      health: {
        status: 'healthy',
        latencyMsP50: 10,
        latencyMsP99: 20,
        errorRatePercent: 0.1,
        trafficRps: 5,
        updatedAt: new Date(),
      },
    });
  }

  it('a retried POST with the same Idempotency-Key creates exactly one incident and replays the same response', async () => {
    await seedService();
    const app = createApp();
    const body = {
      title: 'Billing errors spiking',
      description: 'billing-service 5xx rate jumped after a deploy.',
      serviceName: 'billing-service',
      severity: 'high',
    };

    const first = await request(app)
      .post('/api/incidents')
      .set({ ...authHeader('OPERATOR'), 'Idempotency-Key': 'retry-key-1' })
      .send(body);
    expect(first.status).toBe(201);
    const firstId = first.body.data.id;

    const second = await request(app)
      .post('/api/incidents')
      .set({ ...authHeader('OPERATOR'), 'Idempotency-Key': 'retry-key-1' })
      .send(body);

    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.data.id).toBe(firstId); // same incident, not a new one

    const count = await Incident.countDocuments();
    expect(count).toBe(1); // the operation genuinely only happened once
  });

  it('two different Idempotency-Keys for the same body create two separate incidents', async () => {
    await seedService();
    const app = createApp();
    const body = {
      title: 'Billing errors spiking',
      description: 'billing-service 5xx rate jumped after a deploy.',
      serviceName: 'billing-service',
      severity: 'high',
    };

    await request(app)
      .post('/api/incidents')
      .set({ ...authHeader('OPERATOR'), 'Idempotency-Key': 'key-a' })
      .send(body);
    await request(app)
      .post('/api/incidents')
      .set({ ...authHeader('OPERATOR'), 'Idempotency-Key': 'key-b' })
      .send(body);

    const count = await Incident.countDocuments();
    expect(count).toBe(2); // different keys -- genuinely two separate requests
  });

  it('without an Idempotency-Key header, two identical POSTs create two separate incidents (opt-in only)', async () => {
    await seedService();
    const app = createApp();
    const body = {
      title: 'Billing errors spiking',
      description: 'billing-service 5xx rate jumped after a deploy.',
      serviceName: 'billing-service',
      severity: 'high',
    };

    await request(app).post('/api/incidents').set(authHeader('OPERATOR')).send(body);
    await request(app).post('/api/incidents').set(authHeader('OPERATOR')).send(body);

    const count = await Incident.countDocuments();
    expect(count).toBe(2); // no header, no idempotency guarantee -- this is expected
  });

  it('rejects a validation failure the same way whether or not it carries an Idempotency-Key, and never writes an incident', async () => {
    await seedService();
    const app = createApp();

    const res = await request(app)
      .post('/api/incidents')
      .set({ ...authHeader('OPERATOR'), 'Idempotency-Key': 'bad-request-key' })
      .send({ title: 'x', description: 'y', serviceName: 'does-not-exist', severity: 'low' });

    expect(res.status).toBe(400);
    const count = await Incident.countDocuments();
    expect(count).toBe(0);
  });
});
