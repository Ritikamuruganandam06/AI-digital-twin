import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app';
import { connectToDatabase, disconnectFromDatabase } from '../src/config/database';
import { User } from '../src/models/user.model';
import { Incident } from '../src/models/incident.model';
import { serviceRepository } from '../src/repositories/service.repository';
import { computeDependents } from '../src/services/topology.service';

/**
 * docs/phases.md row 15's verification requirement, word for word:
 * "Privileged endpoints reject insufficient roles; tests per role." Real
 * MongoDB (mongodb-memory-server, same production-vs-test split as every
 * other *.integration.test.ts -- needs outbound access to
 * fastdl.mongodb.org for the in-memory binary's one-time download, same
 * limitation Phase 3/6/10/14 already documented), real bcrypt hashing,
 * real JWT signing/verification. Registration and login go through the
 * actual HTTP endpoints (not src/services/auth.service.ts called
 * directly), so this proves the whole stack end to end: POST
 * /api/auth/register -> POST /api/auth/login -> Bearer token ->
 * src/middleware/authenticate.ts -> src/middleware/authorize.ts.
 */
describe('Authentication + RBAC against a real MongoDB (in-memory)', () => {
  let mongod: MongoMemoryServer;
  const app = createApp();

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await connectToDatabase(mongod.getUri());
  }, 60_000);

  afterEach(async () => {
    await Promise.all([User.deleteMany({}), Incident.deleteMany({})]);
  });

  afterAll(async () => {
    await disconnectFromDatabase();
    await mongod.stop();
  });

  async function seedOneService() {
    const dependents = computeDependents([{ name: 'auth-target-service', dependencies: [] }]);
    await serviceRepository.upsertByName({
      name: 'auth-target-service',
      displayName: 'auth-target-service',
      type: 'microservice',
      description: '',
      dependencies: [],
      dependents: dependents['auth-target-service'] ?? [],
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

  async function registerAndGetToken(email: string, role?: 'USER' | 'OPERATOR' | 'ADMIN'): Promise<string> {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'correct horse battery', ...(role ? { role } : {}) });
    expect(res.status).toBe(201);
    return res.body.data.token as string;
  }

  it('registers a real account, storing a real bcrypt hash, never the plaintext password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'newop@example.com', password: 'correct horse battery' });

    expect(res.status).toBe(201);
    expect(typeof res.body.data.token).toBe('string');
    expect(res.body.data.user.role).toBe('USER');

    const stored = await User.findOne({ email: 'newop@example.com' }).exec();
    expect(stored).toBeTruthy();
    expect(stored!.passwordHash).not.toBe('correct horse battery');
    expect(stored!.passwordHash.startsWith('$2')).toBe(true);
  });

  it('rejects registering the same email twice with 409', async () => {
    await registerAndGetToken('dup@example.com');
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'dup@example.com', password: 'a different password' });
    expect(res.status).toBe(409);
  });

  it('logs in with real stored credentials and rejects a wrong password', async () => {
    await registerAndGetToken('login-test@example.com');

    const goodLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login-test@example.com', password: 'correct horse battery' });
    expect(goodLogin.status).toBe(200);
    expect(typeof goodLogin.body.data.token).toBe('string');

    const badLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login-test@example.com', password: 'wrong' });
    expect(badLogin.status).toBe(401);
  });

  it('rejects a protected route with no Authorization header at all', async () => {
    const res = await request(app).get('/api/services');
    expect(res.status).toBe(401);
  });

  it('rejects a protected route with a garbage bearer token', async () => {
    const res = await request(app).get('/api/services').set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });

  it('a real registered USER can reach an authenticated-only route with their real token', async () => {
    const token = await registerAndGetToken('plainuser@example.com');

    const res = await request(app).get('/api/services').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('rejects POST /api/incidents from a real USER-role account with 403', async () => {
    await seedOneService();
    const token = await registerAndGetToken('plainuser2@example.com');

    const res = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 't', description: 'd', serviceName: 'auth-target-service', severity: 'low' });

    expect(res.status).toBe(403);
    expect(await Incident.countDocuments({})).toBe(0);
  });

  it('allows POST /api/incidents from a real OPERATOR-role account', async () => {
    await seedOneService();
    const token = await registerAndGetToken('realop@example.com', 'OPERATOR');

    const res = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 't', description: 'd', serviceName: 'auth-target-service', severity: 'low' });

    expect(res.status).toBe(201);
  });

  it('allows POST /api/incidents from a real ADMIN-role account too (rank includes higher roles)', async () => {
    await seedOneService();
    const token = await registerAndGetToken('realadmin@example.com', 'ADMIN');

    const res = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 't', description: 'd', serviceName: 'auth-target-service', severity: 'low' });

    expect(res.status).toBe(201);
  });

  it('GET /api/incidents needs only authentication, not OPERATOR (a real USER can list them)', async () => {
    const token = await registerAndGetToken('lister@example.com');

    const res = await request(app).get('/api/incidents').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('POST /api/assistant/ask requires only authentication, not OPERATOR', async () => {
    const token = await registerAndGetToken('assistantuser@example.com');

    // No AI service is running in this suite -- a 502 ("AI service is
    // unavailable") proves the request cleared auth and reached
    // askAssistant() before failing for an unrelated, expected reason. A
    // real running AI service would instead return 201, which is also
    // accepted here so this test isn't coupled to that other process.
    const res = await request(app)
      .post('/api/assistant/ask')
      .set('Authorization', `Bearer ${token}`)
      .send({ question: 'anything' });

    expect([201, 502]).toContain(res.status);
  });
});
