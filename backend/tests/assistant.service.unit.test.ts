import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Pure-logic tests for assistant.service.ts's own transformation logic --
 * no database, no real network, same discipline as recommendation.unit.test.ts
 * and every services/simulation/*.test.ts file. aiServiceClient and
 * agentExecutionRepository are both mocked at the module boundary, so
 * these tests exercise exactly the code this phase actually adds:
 * mapStatus()'s stopped_reason -> status mapping, retrieved-document
 * extraction from RAG steps, and step-shape translation -- the part of
 * docs/phases.md row 14's "matches what actually happened" claim this
 * repo can prove for real without a running AI service or MongoDB.
 */

vi.mock('../src/clients/aiServiceClient', async () => {
  const actual = await vi.importActual<typeof import('../src/clients/aiServiceClient')>(
    '../src/clients/aiServiceClient'
  );
  return {
    ...actual,
    aiServiceClient: { invokeAgent: vi.fn() },
  };
});

vi.mock('../src/repositories/agentExecution.repository', () => ({
  agentExecutionRepository: { create: vi.fn() },
}));

import { aiServiceClient, AiServiceUnavailableError, type AgentInvokeResponse } from '../src/clients/aiServiceClient';
import { agentExecutionRepository } from '../src/repositories/agentExecution.repository';
import { askAssistant, mapStatus, extractRetrievedDocuments, toStepRecords } from '../src/services/assistant.service';
import { AppError } from '../src/utils/AppError';

const mockedInvokeAgent = vi.mocked(aiServiceClient.invokeAgent);
const mockedCreate = vi.mocked(agentExecutionRepository.create);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('mapStatus', () => {
  it('maps final_answer to completed', () => {
    expect(mapStatus('final_answer')).toBe('completed');
  });

  it('maps iteration_limit to incomplete', () => {
    expect(mapStatus('iteration_limit')).toBe('incomplete');
  });

  it('maps groq_error to error', () => {
    expect(mapStatus('groq_error')).toBe('error');
  });

  it('maps any unrecognized stopped_reason to error rather than throwing', () => {
    expect(mapStatus('some_future_reason_this_code_does_not_know_about')).toBe('error');
  });
});

describe('extractRetrievedDocuments', () => {
  function response(steps: AgentInvokeResponse['steps']): AgentInvokeResponse {
    return { answer: 'irrelevant', steps, iterations: 1, stopped_reason: 'final_answer' };
  }

  it('flattens results out of every RAG step, in order', () => {
    const resp = response([
      {
        tool_name: 'get_service',
        arguments: {},
        result: { name: 'payment-service' },
        is_rag_query: false,
        timestamp: '2026-01-01T00:00:00Z',
      },
      {
        tool_name: 'search_knowledge_base',
        arguments: { query: 'payment recovery' },
        result: {
          query: 'payment recovery',
          resultCount: 2,
          results: [
            { documentId: 'runbooks/payment-service-recovery', title: 'Payment Recovery', relatedService: 'payment-service', score: 0.83, text: '...' },
            { documentId: 'troubleshooting/high-latency', title: 'High Latency', relatedService: 'payment-service', score: 0.61, text: '...' },
          ],
        },
        is_rag_query: true,
        timestamp: '2026-01-01T00:00:01Z',
      },
    ]);

    const docs = extractRetrievedDocuments(resp);

    expect(docs).toHaveLength(2);
    expect(docs[0]).toEqual({
      documentId: 'runbooks/payment-service-recovery',
      title: 'Payment Recovery',
      relatedService: 'payment-service',
      score: 0.83,
    });
    expect(docs[1].documentId).toBe('troubleshooting/high-latency');
  });

  it('ignores non-RAG steps entirely, even ones shaped like they might have results', () => {
    const resp = response([
      { tool_name: 'get_services', arguments: {}, result: { results: [{ documentId: 'not-real' }] }, is_rag_query: false, timestamp: '2026-01-01T00:00:00Z' },
    ]);

    expect(extractRetrievedDocuments(resp)).toEqual([]);
  });

  it('tolerates a RAG step with no results array instead of throwing', () => {
    const resp = response([
      { tool_name: 'search_knowledge_base', arguments: {}, result: { resultCount: 0 }, is_rag_query: true, timestamp: '2026-01-01T00:00:00Z' },
    ]);

    expect(extractRetrievedDocuments(resp)).toEqual([]);
  });

  it('returns an empty list when there are no steps at all', () => {
    expect(extractRetrievedDocuments(response([]))).toEqual([]);
  });
});

describe('toStepRecords', () => {
  it('parses each step timestamp and maps camelCase fields 1:1', () => {
    const resp: AgentInvokeResponse = {
      answer: 'ok',
      iterations: 1,
      stopped_reason: 'final_answer',
      steps: [
        {
          tool_name: 'get_service',
          arguments: { serviceName: 'payment-service' },
          result: { name: 'payment-service' },
          is_rag_query: false,
          timestamp: '2026-01-01T12:00:00+00:00',
        },
      ],
    };

    const [step] = toStepRecords(resp, new Date('2026-01-01T12:05:00Z'));

    expect(step.toolName).toBe('get_service');
    expect(step.isRagQuery).toBe(false);
    expect(step.timestamp.toISOString()).toBe('2026-01-01T12:00:00.000Z');
  });

  it('falls back to receivedAt when a step timestamp is missing or unparseable', () => {
    const receivedAt = new Date('2026-01-01T12:05:00Z');
    const resp: AgentInvokeResponse = {
      answer: 'ok',
      iterations: 1,
      stopped_reason: 'final_answer',
      steps: [
        { tool_name: 'get_services', arguments: {}, result: {}, is_rag_query: false, timestamp: 'not-a-real-timestamp' },
      ],
    };

    const [step] = toStepRecords(resp, receivedAt);

    expect(step.timestamp).toEqual(receivedAt);
  });
});

describe('askAssistant', () => {
  it('rejects an empty question without calling the AI service', async () => {
    await expect(askAssistant({ question: '   ' })).rejects.toThrow(AppError);
    expect(mockedInvokeAgent).not.toHaveBeenCalled();
  });

  it('persists a completed execution built from a real agent response', async () => {
    mockedInvokeAgent.mockResolvedValue({
      answer: 'payment-service is healthy.',
      iterations: 1,
      stopped_reason: 'final_answer',
      steps: [
        { tool_name: 'get_service', arguments: { serviceName: 'payment-service' }, result: { name: 'payment-service' }, is_rag_query: false, timestamp: '2026-01-01T00:00:00Z' },
      ],
    });
    mockedCreate.mockImplementation(async (input) => ({ id: 'exec-1', ...input }) as never);

    const result = await askAssistant({ question: 'Is payment-service healthy?' });

    expect(mockedCreate).toHaveBeenCalledTimes(1);
    const createInput = mockedCreate.mock.calls[0][0];
    expect(createInput.status).toBe('completed');
    expect(createInput.finalResponse).toBe('payment-service is healthy.');
    expect(createInput.steps).toHaveLength(1);
    expect(result.id).toBe('exec-1');
  });

  it('maps AiServiceUnavailableError to a 502 AppError and persists nothing', async () => {
    mockedInvokeAgent.mockRejectedValue(new AiServiceUnavailableError('Could not reach AI service'));

    await expect(askAssistant({ question: 'Is payment-service healthy?' })).rejects.toMatchObject({
      statusCode: 502,
    });
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});
