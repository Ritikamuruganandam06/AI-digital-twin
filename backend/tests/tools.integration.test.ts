import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app';
import { connectToDatabase, disconnectFromDatabase } from '../src/config/database';
import { serviceRepository } from '../src/repositories/service.repository';
import { computeDependents } from '../src/services/topology.service';
import { Service } from '../src/models/service.model';
import { ServiceMetric } from '../src/models/serviceMetric.model';
import { Event } from '../src/models/event.model';
import { Incident } from '../src/models/incident.model';

/**
 * Real MongoDB proof for the /internal/tools/* surface (docs/phases.md
 * Phase 10: "LLM calls a tool, tool hits real backend data, result
 * returned" — this file is the "tool hits real backend data" half of
 * that; the AI service side mocks the HTTP boundary the same way
 * ai-service/tests/test_backend_client.py already does for Phase 8).
 * Same production-vs-test split as every other *.integration.test.ts:
 * always mongodb-memory-server, never env.mongodbUri.
 */
describe('/internal/tools/* against a real MongoDB (in-memory)', () => {
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

  /** db-service <- api-service <- web-service, a 3-hop chain so blast-radius/cascade tests are unambiguous. */
  async function seedChainTopology() {
    const defs = [
      { name: 'db-service', dependencies: [] as string[], status: 'healthy' as const },
      { name: 'api-service', dependencies: ['db-service'], status: 'degraded' as const },
      { name: 'web-service', dependencies: ['api-service'], status: 'healthy' as const },
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
          status: def.status,
          latencyMsP50: 10,
          latencyMsP99: def.status === 'degraded' ? 900 : 20,
          errorRatePercent: def.status === 'degraded' ? 8 : 0.1,
          trafficRps: 5,
          updatedAt: new Date(),
        },
      });
    }
  }

  // ---- Read-only tools ---------------------------------------------

  it('GET /internal/tools/services returns every seeded service', async () => {
    await seedChainTopology();
    const res = await request(createApp()).get('/internal/tools/services');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
  });

  it('GET /internal/tools/services/:name resolves the full topology view', async () => {
    await seedChainTopology();
    const res = await request(createApp()).get('/internal/tools/services/api-service');

    expect(res.status).toBe(200);
    expect(res.body.data.resolvedDependencies[0].name).toBe('db-service');
    expect(res.body.data.resolvedDependents[0].name).toBe('web-service');
  });

  it('GET /internal/tools/services/:name/dependencies and /dependents return resolved records', async () => {
    await seedChainTopology();
    const app = createApp();

    const depsRes = await request(app).get('/internal/tools/services/api-service/dependencies');
    expect(depsRes.status).toBe(200);
    expect(depsRes.body.data.map((s: { name: string }) => s.name)).toEqual(['db-service']);

    const dependentsRes = await request(app).get('/internal/tools/services/api-service/dependents');
    expect(dependentsRes.status).toBe(200);
    expect(dependentsRes.body.data.map((s: { name: string }) => s.name)).toEqual(['web-service']);
  });

  it('GET /internal/tools/services/:name returns 404 for an unknown service', async () => {
    const res = await request(createApp()).get('/internal/tools/services/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('GET /internal/tools/system-state summarizes status counts across all services', async () => {
    await seedChainTopology();
    const res = await request(createApp()).get('/internal/tools/system-state');

    expect(res.status).toBe(200);
    expect(res.body.data.totalServices).toBe(3);
    expect(res.body.data.byStatus).toEqual({ healthy: 2, degraded: 1, down: 0 });
    expect(res.body.data.services).toHaveLength(3);
  });

  it('GET /internal/tools/events and /incidents behave like their public counterparts', async () => {
    await seedChainTopology();
    const app = createApp();

    const eventsRes = await request(app).get('/internal/tools/events?service=api-service');
    expect(eventsRes.status).toBe(200);
    expect(eventsRes.body.data).toEqual([]);

    const incidentsRes = await request(app).get('/internal/tools/incidents');
    expect(incidentsRes.status).toBe(200);
    expect(incidentsRes.body.data).toEqual([]);
  });

  // ---- Simulation tools ----------------------------------------------

  it('POST /internal/tools/simulate/service-failure cascades to real dependents', async () => {
    await seedChainTopology();
    const res = await request(createApp())
      .post('/internal/tools/simulate/service-failure')
      .send({ serviceName: 'db-service' });

    expect(res.status).toBe(200);
    const affectedNames = res.body.data.affectedServices.map((s: { name: string }) => s.name).sort();
    expect(affectedNames).toEqual(['api-service', 'db-service', 'web-service']);
  });

  it('POST /internal/tools/simulate/service-failure returns 400 for an unknown service (engine Error -> AppError)', async () => {
    await seedChainTopology();
    const res = await request(createApp())
      .post('/internal/tools/simulate/service-failure')
      .send({ serviceName: 'does-not-exist' });

    expect(res.status).toBe(400);
  });

  it('POST /internal/tools/simulate/traffic-increase validates multiplier is a number', async () => {
    await seedChainTopology();
    const res = await request(createApp())
      .post('/internal/tools/simulate/traffic-increase')
      .send({ serviceName: 'db-service', multiplier: 'a lot' });

    expect(res.status).toBe(400);
  });

  it('POST /internal/tools/simulate/database-failure and /cache-failure run against the whole real topology', async () => {
    await seedChainTopology();
    const app = createApp();

    const dbRes = await request(app).post('/internal/tools/simulate/database-failure').send({});
    expect(dbRes.status).toBe(200);
    expect(dbRes.body.data.scenario).toBe('database_failure');

    const cacheRes = await request(app).post('/internal/tools/simulate/cache-failure').send({});
    expect(cacheRes.status).toBe(200);
    expect(cacheRes.body.data.scenario).toBe('cache_failure');
  });

  it('GET /internal/tools/blast-radius/:name reflects the real chain', async () => {
    await seedChainTopology();
    const res = await request(createApp()).get('/internal/tools/blast-radius/db-service');

    expect(res.status).toBe(200);
    expect(res.body.data.map((e: { name: string }) => e.name).sort()).toEqual(['api-service', 'web-service']);
  });

  it('GET /internal/tools/bottleneck ranks the real topology by blast radius, tie-broken by health', async () => {
    await seedChainTopology();
    const res = await request(createApp()).get('/internal/tools/bottleneck');

    expect(res.status).toBe(200);
    expect(res.body.data.topBottleneck.name).toBe('db-service');
  });

  // ---- Privileged tools ------------------------------------------------

  it('GET /internal/tools/recommend-scaling/:name recommends scale_out for the real degraded service', async () => {
    await seedChainTopology();
    const res = await request(createApp()).get('/internal/tools/recommend-scaling/api-service');

    expect(res.status).toBe(200);
    expect(res.body.data.recommendation).toBe('scale_out');
    expect(res.body.data.currentStatus).toBe('degraded');
  });

  it('GET /internal/tools/recommend-scaling/:name returns 404 for an unknown service', async () => {
    const res = await request(createApp()).get('/internal/tools/recommend-scaling/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('POST /internal/tools/create-incident really writes to MongoDB, same as POST /api/incidents', async () => {
    await seedChainTopology();
    const res = await request(createApp()).post('/internal/tools/create-incident').send({
      title: 'DB errors spiking',
      description: 'db-service 5xx rate jumped.',
      serviceName: 'db-service',
      severity: 'high',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('open');
    const count = await Incident.countDocuments();
    expect(count).toBe(1);
  });

  it('POST /internal/tools/create-incident rejects an unknown serviceName with a 400 before writing anything', async () => {
    await seedChainTopology();
    const res = await request(createApp()).post('/internal/tools/create-incident').send({
      title: 'x',
      description: 'y',
      serviceName: 'does-not-exist',
      severity: 'low',
    });

    expect(res.status).toBe(400);
    const count = await Incident.countDocuments();
    expect(count).toBe(0);
  });
});
