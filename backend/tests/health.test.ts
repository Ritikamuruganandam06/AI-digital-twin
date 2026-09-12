import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { registerHealthCheck, clearHealthChecks } from '../src/health/registry';

describe('GET /health', () => {
  afterEach(() => {
    clearHealthChecks();
  });

  it('returns 200 and status ok when no dependencies are registered yet', async () => {
    const app = createApp();
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('ai-digital-twin-backend');
    expect(res.body.checks).toEqual({});
    expect(typeof res.body.uptimeSeconds).toBe('number');
  });

  it('echoes a correlation id header on every response', async () => {
    const app = createApp();
    const res = await request(app).get('/health');

    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('reuses a caller-supplied x-request-id instead of generating a new one', async () => {
    const app = createApp();
    const res = await request(app).get('/health').set('x-request-id', 'test-fixed-id');

    expect(res.headers['x-request-id']).toBe('test-fixed-id');
  });

  it('reports degraded/down status and 503 when a registered check fails', async () => {
    registerHealthCheck('fake-dependency', async () => ({
      status: 'down',
      message: 'connection refused',
    }));

    const app = createApp();
    const res = await request(app).get('/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('down');
    expect(res.body.checks['fake-dependency'].status).toBe('down');
  });

  it('stays ok when a registered check passes', async () => {
    registerHealthCheck('fake-dependency', async () => ({ status: 'ok', latencyMs: 3 }));

    const app = createApp();
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks['fake-dependency'].status).toBe('ok');
  });
});

describe('unknown routes', () => {
  it('returns a 404 JSON error body', async () => {
    const app = createApp();
    const res = await request(app).get('/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain('/does-not-exist');
    expect(res.body.error.requestId).toBeTruthy();
  });
});
