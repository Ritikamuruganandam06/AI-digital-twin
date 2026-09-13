import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { connectKafkaProducer, disconnectKafkaProducer, isKafkaProducerConnected } from '../src/config/kafka';
import { registerHealthCheck, clearHealthChecks } from '../src/health/registry';
import { checkKafkaHealth } from '../src/health/checks/kafka.check';

/**
 * Proves the failure path with a REAL (failing) connection attempt against
 * a port nothing is listening on — not a mock of kafkajs. Mirrors
 * tests/database.negative.test.ts and tests/redis.negative.test.ts.
 *
 * The positive path (a real producer -> broker -> consumer round trip,
 * including the DLQ) needs an actual Kafka broker, which this sandbox
 * cannot obtain (see backend/README.md, "Phase 5" section, for exactly why
 * and how to run that proof on your own machine).
 */
describe('Kafka connection failure handling', () => {
  afterEach(async () => {
    clearHealthChecks();
    await disconnectKafkaProducer();
  });

  it(
    'rejects when the target broker refuses the connection',
    async () => {
      await expect(connectKafkaProducer(['127.0.0.1:1'])).rejects.toThrow();
      expect(isKafkaProducerConnected()).toBe(false);
    },
    30_000
  );

  it('reports the kafka health check as down without a connection', async () => {
    const result = await checkKafkaHealth();
    expect(result.status).toBe('down');
    expect(result.message).toMatch(/not connected/i);
  });

  it('GET /health returns 503 when Kafka is registered but unreachable', async () => {
    registerHealthCheck('kafka', checkKafkaHealth);
    const app = createApp();

    const res = await request(app).get('/health');

    expect(res.status).toBe(503);
    expect(res.body.checks.kafka.status).toBe('down');
  });

  it('POST /api/diagnostics/kafka-messages returns 503 (not a raw 500) when Kafka is down', async () => {
    const app = createApp();

    const res = await request(app).post('/api/diagnostics/kafka-messages').send({ message: 'hello' });

    expect(res.status).toBe(503);
    expect(res.body.error.message).toMatch(/kafka/i);
  });

  it('GET /api/diagnostics/kafka-messages still works (reads the in-memory store) when Kafka is down', async () => {
    const app = createApp();

    const res = await request(app).get('/api/diagnostics/kafka-messages');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
