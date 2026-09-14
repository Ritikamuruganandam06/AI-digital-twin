import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { authHeader } from './helpers/testAuth';

/**
 * HTTP-layer tests for POST /api/assistant/ask with assistant.service.ts
 * and the database-connected check both mocked -- the same
 * "HTTP layer only" discipline ai-service/tests/test_agent_endpoint.py
 * uses for POST /agent/invoke (run_agent mocked there). The real,
 * database-backed version of this same request is
 * agentExecution.integration.test.ts.
 *
 * Phase 15: this route is mounted behind src/middleware/authenticate.ts
 * (see src/app.ts), so every request here needs a real (if
 * test-fixture-id'd) Bearer token -- see tests/helpers/testAuth.ts.
 */

vi.mock('../src/config/database', async () => {
  const actual = await vi.importActual<typeof import('../src/config/database')>('../src/config/database');
  return { ...actual, assertDatabaseConnected: vi.fn() };
});

vi.mock('../src/services/assistant.service', () => ({
  askAssistant: vi.fn(),
}));

import { createApp } from '../src/app';
import { assertDatabaseConnected } from '../src/config/database';
import { askAssistant } from '../src/services/assistant.service';
import { AppError } from '../src/utils/AppError';

const app = createApp();
const mockedAssertDatabaseConnected = vi.mocked(assertDatabaseConnected);
const mockedAskAssistant = vi.mocked(askAssistant);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/assistant/ask', () => {
  it('returns 201 with the persisted execution on success', async () => {
    mockedAskAssistant.mockResolvedValue({
      id: 'exec-1',
      question: 'Is payment-service healthy?',
      finalResponse: 'Yes, it is healthy.',
      status: 'completed',
      stoppedReason: 'final_answer',
      iterations: 1,
      steps: [],
      retrievedDocuments: [],
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    const response = await request(app)
      .post('/api/assistant/ask')
      .set(authHeader('USER', { id: 'user-42' }))
      .send({ question: 'Is payment-service healthy?' });

    expect(response.status).toBe(201);
    expect(response.body.data.id).toBe('exec-1');
    expect(response.body.data.status).toBe('completed');
    expect(mockedAskAssistant).toHaveBeenCalledWith({ question: 'Is payment-service healthy?', userId: 'user-42' });
  });

  it('rejects a request with no Authorization header at all with 401, before ever calling the service', async () => {
    const response = await request(app).post('/api/assistant/ask').send({ question: 'anything' });

    expect(response.status).toBe(401);
    expect(mockedAskAssistant).not.toHaveBeenCalled();
  });

  it('rejects an empty question with 400 without calling the service', async () => {
    const response = await request(app).post('/api/assistant/ask').set(authHeader()).send({ question: '   ' });

    expect(response.status).toBe(400);
    expect(mockedAskAssistant).not.toHaveBeenCalled();
  });

  it('rejects a missing question field with 400', async () => {
    const response = await request(app).post('/api/assistant/ask').set(authHeader()).send({});
    expect(response.status).toBe(400);
  });

  it('propagates a 502 from askAssistant when the AI service is unavailable', async () => {
    mockedAskAssistant.mockRejectedValue(new AppError('AI service is unavailable: ...', 502));

    const response = await request(app).post('/api/assistant/ask').set(authHeader()).send({ question: 'anything' });

    expect(response.status).toBe(502);
  });

  it('checks the database is connected before ever calling the AI service', async () => {
    mockedAssertDatabaseConnected.mockImplementation(() => {
      throw new AppError('Database is currently unavailable', 503);
    });

    const response = await request(app).post('/api/assistant/ask').set(authHeader()).send({ question: 'anything' });

    expect(response.status).toBe(503);
    expect(mockedAskAssistant).not.toHaveBeenCalled();
  });
});
