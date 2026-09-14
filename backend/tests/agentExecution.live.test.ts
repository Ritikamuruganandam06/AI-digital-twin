import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { connectToDatabase, disconnectFromDatabase } from '../src/config/database';
import { env } from '../src/config/env';
import { AgentExecution } from '../src/models/agentExecution.model';
import { authHeader } from './helpers/testAuth';

/**
 * The real, fully-live version of agentExecution.integration.test.ts's
 * proof: a real MongoDB (env.mongodbUri, NOT mongodb-memory-server) and a
 * REAL, already-running AI service process at AI_SERVICE_URL (no fetch
 * mocking anywhere in this file) -- the first genuinely end-to-end test
 * in this repo that exercises docs/architecture.md §3's full sequence
 * diagram: FE-shaped request -> BE -> AI (a real POST /agent/invoke,
 * which itself may or may not reach Groq) -> BE persists -> BE returns.
 *
 * Same convention every other real-infrastructure test in this project
 * uses (tests/redis.integration.test.ts, tests/kafka.negative.test.ts):
 * no conditional skip logic. If MongoDB or the AI service isn't running,
 * this file fails loudly at beforeAll/the first request — that's a
 * missing local dependency, not a bug here. Start both before running it:
 *
 *   cd ai-service && source .venv/bin/activate && uvicorn app.main:app --port 8000
 *   # a real local MongoDB reachable at MONGODB_URI
 *
 * A real GROQ_API_KEY in ai-service/.env is NOT required for this test to
 * pass -- even a clean "could not reach Groq" answer (ai-service's own
 * groq_error path) is a real execution the backend can persist and read
 * back, and this test only asserts on that always-true shape (some
 * status, some iterations count, retrievable by id) rather than on what
 * Groq specifically decided to do, the same restraint
 * ai-service/tests/test_agent_live.py uses when GROQ_API_KEY isn't set.
 */
describe('POST /api/assistant/ask -> GET /api/executions/:id against a real MongoDB and a real running AI service', () => {
  const app = createApp();

  beforeAll(async () => {
    await connectToDatabase(env.mongodbUri);
  }, 15_000);

  afterEach(async () => {
    await AgentExecution.deleteMany({});
  });

  afterAll(async () => {
    await disconnectFromDatabase();
  });

  it('persists a real agent execution and reads the same document back by id', async () => {
    const postResponse = await request(app)
      .post('/api/assistant/ask')
      .set(authHeader())
      .send({ question: 'How many services are currently in the system, and are any of them unhealthy?' })
      .timeout(60_000);

    expect(postResponse.status).toBe(201);
    const created = postResponse.body.data;
    expect(['completed', 'incomplete', 'error']).toContain(created.status);
    expect(typeof created.finalResponse).toBe('string');
    expect(created.finalResponse.length).toBeGreaterThan(0);
    expect(Array.isArray(created.steps)).toBe(true);

    const getResponse = await request(app).get(`/api/executions/${created.id}`).set(authHeader());
    expect(getResponse.status).toBe(200);
    expect(getResponse.body.data).toEqual(created);
  }, 65_000);
});
