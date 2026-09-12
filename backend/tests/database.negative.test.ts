import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../src/app';
import { connectToDatabase, disconnectFromDatabase, isDatabaseConnected } from '../src/config/database';
import { registerHealthCheck, clearHealthChecks } from '../src/health/registry';
import { checkMongoHealth } from '../src/health/checks/mongodb.check';

/**
 * Proves the failure path with a REAL (failing) connection attempt against
 * a port nothing is listening on — not a mock of mongoose. This is the one
 * MongoDB-related test in this suite that doesn't need an actual MongoDB
 * server, because it deliberately tests what happens when there isn't one.
 *
 * The positive path (a real MongoDB actually accepting the insert/read) is
 * covered separately in tests/diagnosticPing.integration.test.ts using
 * mongodb-memory-server.
 */
describe('MongoDB connection failure handling', () => {
  afterEach(async () => {
    clearHealthChecks();
    if (mongoose.connection.readyState !== 0) {
      await disconnectFromDatabase();
    }
  });

  it(
    'rejects when the target host refuses the connection',
    async () => {
      // connectToDatabase uses a 5s serverSelectionTimeoutMS (src/config/database.ts),
      // so this needs more than vitest's default 5s test timeout to observe
      // the real rejection rather than racing it.
      await expect(
        connectToDatabase('mongodb://127.0.0.1:1/does-not-matter')
      ).rejects.toThrow();

      expect(isDatabaseConnected()).toBe(false);
    },
    10_000
  );

  it('reports the mongodb health check as down without a connection', async () => {
    const result = await checkMongoHealth();
    expect(result.status).toBe('down');
  });

  it('GET /health returns 503 when MongoDB is registered but unreachable', async () => {
    registerHealthCheck('mongodb', checkMongoHealth);
    const app = createApp();

    const res = await request(app).get('/health');

    expect(res.status).toBe(503);
    expect(res.body.checks.mongodb.status).toBe('down');
  });

  it('diagnostic ping endpoints return 503 (not a raw 500) when the database is down', async () => {
    const app = createApp();

    const createRes = await request(app).post('/api/diagnostics/pings').send({ message: 'hello' });
    expect(createRes.status).toBe(503);
    expect(createRes.body.error.message).toMatch(/database/i);

    const listRes = await request(app).get('/api/diagnostics/pings');
    expect(listRes.status).toBe(503);
  });
});
