import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { authHeader } from './helpers/testAuth';

/**
 * HTTP-layer tests for GET /api/executions and GET /api/executions/:id
 * with agentExecutionRepository mocked -- proves docs/phases.md row 14's
 * "Trace retrievable via API" at the routing/validation level without
 * needing real MongoDB. The real, database-backed round trip (write via
 * POST /api/assistant/ask, then read back the exact same document) is
 * agentExecution.integration.test.ts.
 *
 * Phase 15: this route is mounted behind src/middleware/authenticate.ts
 * (see src/app.ts) -- plain authentication only, no authorize() -- so
 * every request here needs a Bearer token; see tests/helpers/testAuth.ts.
 */

vi.mock('../src/config/database', async () => {
  const actual = await vi.importActual<typeof import('../src/config/database')>('../src/config/database');
  return { ...actual, assertDatabaseConnected: vi.fn() };
});

vi.mock('../src/repositories/agentExecution.repository', () => ({
  agentExecutionRepository: { findAll: vi.fn(), findById: vi.fn() },
}));

import { createApp } from '../src/app';
import { agentExecutionRepository } from '../src/repositories/agentExecution.repository';

const app = createApp();
const mockedFindAll = vi.mocked(agentExecutionRepository.findAll);
const mockedFindById = vi.mocked(agentExecutionRepository.findById);

const SAMPLE_EXECUTION = {
  id: '507f1f77bcf86cd799439011',
  question: 'Is payment-service healthy?',
  finalResponse: 'Yes.',
  status: 'completed' as const,
  stoppedReason: 'final_answer',
  iterations: 1,
  steps: [],
  retrievedDocuments: [],
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/executions', () => {
  it('returns the list the repository provides', async () => {
    mockedFindAll.mockResolvedValue([SAMPLE_EXECUTION]);

    const response = await request(app).get('/api/executions').set(authHeader());

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(mockedFindAll).toHaveBeenCalledWith(20);
  });

  it('clamps an out-of-range limit to the 1-100 bounds', async () => {
    mockedFindAll.mockResolvedValue([]);

    await request(app).get('/api/executions?limit=500').set(authHeader());

    expect(mockedFindAll).toHaveBeenCalledWith(100);
  });

  it('rejects a request with no Authorization header with 401, without querying the repository', async () => {
    const response = await request(app).get('/api/executions');

    expect(response.status).toBe(401);
    expect(mockedFindAll).not.toHaveBeenCalled();
  });
});

describe('GET /api/executions/:id', () => {
  it('returns 200 with the execution when found', async () => {
    mockedFindById.mockResolvedValue(SAMPLE_EXECUTION);

    const response = await request(app).get(`/api/executions/${SAMPLE_EXECUTION.id}`).set(authHeader());

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(SAMPLE_EXECUTION.id);
  });

  it('returns 404 when the repository finds nothing', async () => {
    mockedFindById.mockResolvedValue(null);

    const response = await request(app).get(`/api/executions/${SAMPLE_EXECUTION.id}`).set(authHeader());

    expect(response.status).toBe(404);
  });

  it('returns 400 for a malformed id without querying the repository', async () => {
    const response = await request(app).get('/api/executions/not-a-valid-object-id').set(authHeader());

    expect(response.status).toBe(400);
    expect(mockedFindById).not.toHaveBeenCalled();
  });
});
