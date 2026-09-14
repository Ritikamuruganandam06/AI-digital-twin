import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app';
import { connectToDatabase, disconnectFromDatabase } from '../src/config/database';
import { serviceRepository } from '../src/repositories/service.repository';
import { serviceMetricRepository } from '../src/repositories/serviceMetric.repository';
import { computeDependents } from '../src/services/topology.service';
import { Service } from '../src/models/service.model';
import { ServiceMetric } from '../src/models/serviceMetric.model';
import { Event } from '../src/models/event.model';
import { Incident } from '../src/models/incident.model';
import { authHeader } from './helpers/testAuth';

/**
 * Phase 6's real MongoDB proof, same PRODUCTION-vs-TEST database split as
 * tests/diagnosticPing.integration.test.ts: this file always connects to a
 * throwaway mongodb-memory-server instance, never env.mongodbUri. It needs
 * outbound access to fastdl.mongodb.org for that in-memory binary's
 * one-time download — see backend/README.md if that's blocked on your
 * network, same limitation Phase 3 already documented.
 *
 * Deliberately seeds a small 3-service topology directly through the
 * repository layer rather than running src/scripts/seed.ts, so this test
 * stays fast and hermetic and isn't coupled to the demo data changing.
 */
describe('Digital twin query endpoints against a real MongoDB (in-memory)', () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await connectToDatabase(mongod.getUri());
  }, 60_000);

  afterEach(async () => {
    await Promise.all([
      Service.deleteMany({}),
      ServiceMetric.deleteMany({}),
      Event.deleteMany({}),
      Incident.deleteMany({}),
    ]);
  });

  afterAll(async () => {
    await disconnectFromDatabase();
    await mongod.stop();
  });

  async function seedTinyTopology() {
    const defs = [
      { name: 'auth-service', dependencies: [] as string[] },
      { name: 'billing-service', dependencies: ['auth-service'] },
    ];
    const dependents = computeDependents(defs);

    for (const def of defs) {
      // eslint-disable-next-line no-await-in-loop
      await serviceRepository.upsertByName({
        name: def.name,
        displayName: def.name,
        type: 'microservice',
        description: '',
        dependencies: def.dependencies,
        dependents: dependents[def.name] ?? [],
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
  }

  it('GET /api/services lists the seeded topology', async () => {
    await seedTinyTopology();
    const app = createApp();

    const res = await request(app).get('/api/services').set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.map((s: { name: string }) => s.name).sort()).toEqual(['auth-service', 'billing-service']);
  });

  it('GET /api/services/:name resolves both directions of the dependency graph', async () => {
    await seedTinyTopology();
    const app = createApp();

    const authRes = await request(app).get('/api/services/auth-service').set(authHeader());
    expect(authRes.status).toBe(200);
    expect(authRes.body.data.resolvedDependencies).toEqual([]);
    expect(authRes.body.data.resolvedDependents).toHaveLength(1);
    expect(authRes.body.data.resolvedDependents[0].name).toBe('billing-service');

    const billingRes = await request(app).get('/api/services/billing-service').set(authHeader());
    expect(billingRes.status).toBe(200);
    expect(billingRes.body.data.resolvedDependents).toEqual([]);
    expect(billingRes.body.data.resolvedDependencies).toHaveLength(1);
    expect(billingRes.body.data.resolvedDependencies[0].name).toBe('auth-service');
  });

  it('GET /api/services/:name returns 404 for an unknown service', async () => {
    const app = createApp();
    const res = await request(app).get('/api/services/does-not-exist').set(authHeader());
    expect(res.status).toBe(404);
  });

  it('GET /api/services/:name/metrics returns recent samples newest-first', async () => {
    await seedTinyTopology();
    const auth = await serviceRepository.findByName('auth-service');
    const now = Date.now();
    await serviceMetricRepository.insertMany([
      {
        serviceId: auth!.id,
        serviceName: 'auth-service',
        timestamp: new Date(now - 60_000),
        latencyMsP50: 9,
        latencyMsP99: 18,
        errorRatePercent: 0.1,
        trafficRps: 4,
        capacityPercent: 40,
      },
      {
        serviceId: auth!.id,
        serviceName: 'auth-service',
        timestamp: new Date(now),
        latencyMsP50: 11,
        latencyMsP99: 22,
        errorRatePercent: 0.2,
        trafficRps: 6,
        capacityPercent: 45,
      },
    ]);
    const app = createApp();

    const res = await request(app).get('/api/services/auth-service/metrics').set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].trafficRps).toBe(6); // newest first
  });

  it('POST /api/incidents creates an incident tied to a real service, then GET retrieves it (OPERATOR role required)', async () => {
    await seedTinyTopology();
    const app = createApp();

    const createRes = await request(app)
      .post('/api/incidents')
      .set(authHeader('OPERATOR'))
      .send({
        title: 'Billing errors spiking',
        description: 'billing-service 5xx rate jumped after a deploy.',
        serviceName: 'billing-service',
        affectedServiceNames: ['auth-service'],
        severity: 'high',
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.status).toBe('open');
    expect(createRes.body.data.source).toBe('manual');

    const getRes = await request(app).get(`/api/incidents/${createRes.body.data.id}`).set(authHeader());
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.title).toBe('Billing errors spiking');

    const listRes = await request(app).get('/api/incidents').set(authHeader());
    expect(listRes.body.data).toHaveLength(1);
  });

  it('POST /api/incidents rejects a plain USER role with 403, writing nothing', async () => {
    await seedTinyTopology();
    const app = createApp();

    const res = await request(app)
      .post('/api/incidents')
      .set(authHeader('USER'))
      .send({
        title: 'Billing errors spiking',
        description: 'billing-service 5xx rate jumped after a deploy.',
        serviceName: 'billing-service',
        severity: 'high',
      });

    expect(res.status).toBe(403);
    const count = await Incident.countDocuments();
    expect(count).toBe(0);
  });

  it('POST /api/incidents rejects an unknown serviceName with a 400 before writing anything', async () => {
    await seedTinyTopology();
    const app = createApp();

    const res = await request(app)
      .post('/api/incidents')
      .set(authHeader('OPERATOR'))
      .send({
        title: 'x',
        description: 'y',
        serviceName: 'does-not-exist',
        severity: 'low',
      });

    expect(res.status).toBe(400);
    const count = await Incident.countDocuments();
    expect(count).toBe(0);
  });

  it('GET /api/events filters by ?service= and returns 404 for an unknown one', async () => {
    await seedTinyTopology();
    const app = createApp();

    const badRes = await request(app).get('/api/events?service=does-not-exist').set(authHeader());
    expect(badRes.status).toBe(404);

    const goodRes = await request(app).get('/api/events?service=auth-service').set(authHeader());
    expect(goodRes.status).toBe(200);
    expect(goodRes.body.data).toEqual([]);
  });
});
