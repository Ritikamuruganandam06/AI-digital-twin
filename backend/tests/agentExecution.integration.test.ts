import { describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app';
import { connectToDatabase, disconnectFromDatabase } from '../src/config/database';
import { AgentExecution } from '../src/models/agentExecution.model';
import { authHeader } from './helpers/testAuth';

/**
 * Real MongoDB proof for docs/phases.md row 14: "Trace retrievable via
 * API, matches what actually happened". Same PRODUCTION-vs-TEST database
 * split as every other *.integration.test.ts (always mongodb-memory-server,
 * never env.mongodbUri) -- needs outbound access to fastdl.mongodb.org for
 * the in-memory binary's one-time download, same limitation Phase 3/6/10
 * already documented for this project.
 *
 * The AI service boundary is mocked here (global fetch), the same scope
 * split tools.integration.test.ts uses on the other side of this
 * project's HTTP boundary (real Mongo, mocked upstream) -- this file's
 * job is proving the backend's OWN persistence/retrieval works for real,
 * not re-proving aiServiceClient.ts's HTTP mechanics (aiServiceClient.unit.test.ts's
 * job) or a real Groq call (ai-service's own job). A real end-to-end
 * proof against a genuinely running AI service process is
 * agentExecution.live.test.ts.
 */
describe('Agent execution traces: persist via POST /api/assistant/ask, read back via GET /api/executions (real MongoDB, in-memory)', () => {
  let mongod: MongoMemoryServer;
  const app = createApp();

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await connectToDatabase(mongod.getUri());
  }, 60_000);

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(async () => {
    await AgentExecution.deleteMany({});
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await disconnectFromDatabase();
    await mongod.stop();
  });

  function mockAiServiceResponse(body: unknown) {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => body,
    });
  }

  it('persists a tool+RAG execution exactly as returned, and GET /api/executions/:id returns the same document', async () => {
    mockAiServiceResponse({
      answer: 'payment-service is currently degraded. Per the recovery runbook: confirm health first, then...',
      iterations: 2,
      stopped_reason: 'final_answer',
      steps: [
        {
          tool_name: 'get_service',
          arguments: { serviceName: 'payment-service' },
          result: { name: 'payment-service', health: 'degraded' },
          is_rag_query: false,
          timestamp: '2026-01-01T00:00:00Z',
        },
        {
          tool_name: 'search_knowledge_base',
          arguments: { query: 'payment service recovery' },
          result: {
            query: 'payment service recovery',
            resultCount: 1,
            results: [
              {
                documentId: 'runbooks/payment-service-recovery',
                title: 'Payment Service Recovery Runbook',
                documentType: 'runbooks',
                relatedService: 'payment-service',
                score: 0.83,
                text: 'Step 1: confirm health...',
              },
            ],
          },
          is_rag_query: true,
          timestamp: '2026-01-01T00:00:01Z',
        },
      ],
    });

    const postResponse = await request(app)
      .post('/api/assistant/ask')
      .set(authHeader('USER', { id: 'asking-user-1' }))
      .send({ question: 'Payment service is down. What should I do?' });

    expect(postResponse.status).toBe(201);
    const created = postResponse.body.data;
    expect(created.status).toBe('completed');
    // Phase 15: userId (optional since Phase 14) is now populated from the
    // real JWT authenticate.ts attached to the request.
    expect(created.userId).toBe('asking-user-1');
    expect(created.steps).toHaveLength(2);
    expect(created.steps[0].toolName).toBe('get_service');
    expect(created.steps[0].isRagQuery).toBe(false);
    expect(created.steps[1].toolName).toBe('search_knowledge_base');
    expect(created.steps[1].isRagQuery).toBe(true);
    expect(created.retrievedDocuments).toHaveLength(1);
    expect(created.retrievedDocuments[0].documentId).toBe('runbooks/payment-service-recovery');

    // It's really in MongoDB, not just echoed back from memory.
    const storedCount = await AgentExecution.countDocuments({});
    expect(storedCount).toBe(1);

    // "matches what actually happened": what GET returns for this id must
    // be byte-for-byte what POST just persisted, not a re-derived summary.
    const getResponse = await request(app).get(`/api/executions/${created.id}`).set(authHeader());
    expect(getResponse.status).toBe(200);
    expect(getResponse.body.data).toEqual(created);
  });

  it('persists an iteration_limit run as status "incomplete", not "completed"', async () => {
    mockAiServiceResponse({
      answer: 'Reached the 6-iteration limit before producing a final answer. 6 tool call(s) were made.',
      iterations: 6,
      stopped_reason: 'iteration_limit',
      steps: Array.from({ length: 6 }, (_, i) => ({
        tool_name: 'get_service_metrics',
        arguments: { serviceName: `service-${i}` },
        result: { latencyMs: 100 },
        is_rag_query: false,
        timestamp: `2026-01-01T00:00:0${i}Z`,
      })),
    });

    const response = await request(app)
      .post('/api/assistant/ask')
      .set(authHeader())
      .send({ question: 'Investigate everything.' });

    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('incomplete');
    expect(response.body.data.steps).toHaveLength(6);
  });

  it('persists a groq_error run as status "error" with an empty steps array', async () => {
    mockAiServiceResponse({
      answer: 'The AI service could not reach Groq: 403 Forbidden',
      iterations: 1,
      stopped_reason: 'groq_error',
      steps: [],
    });

    const response = await request(app)
      .post('/api/assistant/ask')
      .set(authHeader())
      .send({ question: 'Is everything healthy?' });

    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('error');
    expect(response.body.data.steps).toEqual([]);
  });

  it('does NOT persist anything when the AI service is completely unreachable', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNREFUSED'));

    const response = await request(app).post('/api/assistant/ask').set(authHeader()).send({ question: 'anything' });

    expect(response.status).toBe(502);
    expect(await AgentExecution.countDocuments({})).toBe(0);
  });

  it('GET /api/executions lists recent executions newest first', async () => {
    mockAiServiceResponse({ answer: 'first', iterations: 1, stopped_reason: 'final_answer', steps: [] });
    await request(app).post('/api/assistant/ask').set(authHeader()).send({ question: 'first question' });

    mockAiServiceResponse({ answer: 'second', iterations: 1, stopped_reason: 'final_answer', steps: [] });
    await request(app).post('/api/assistant/ask').set(authHeader()).send({ question: 'second question' });

    const response = await request(app).get('/api/executions').set(authHeader());

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data[0].question).toBe('second question');
    expect(response.body.data[1].question).toBe('first question');
  });

  it('GET /api/executions/:id returns 404 for a well-formed id that does not exist', async () => {
    const response = await request(app).get('/api/executions/507f1f77bcf86cd799439011').set(authHeader());
    expect(response.status).toBe(404);
  });

  it('rejects POST /api/assistant/ask with no Authorization header with 401, before calling the AI service', async () => {
    const response = await request(app).post('/api/assistant/ask').send({ question: 'anything' });

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
