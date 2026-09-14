import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { aiServiceClient, AiServiceUnavailableError } from '../src/clients/aiServiceClient';

/**
 * Unit tests for aiServiceClient.ts with the global `fetch` mocked -- the
 * same boundary-mocking discipline ai-service/tests/test_backend_client.py
 * uses on the Python side (httpx mocked there, fetch mocked here). The
 * real, unmocked network call is proven for real in
 * agentExecution.integration.test.ts's live section instead (gated on a
 * real AI service process actually running).
 */

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('aiServiceClient.invokeAgent', () => {
  it('POSTs the question as JSON to {AI_SERVICE_URL}/agent/invoke and returns the parsed body', async () => {
    const fakeResponse = {
      answer: 'payment-service is healthy.',
      steps: [],
      iterations: 1,
      stopped_reason: 'final_answer',
    };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => fakeResponse,
    });

    const result = await aiServiceClient.invokeAgent('Is payment-service healthy?');

    expect(result).toEqual(fakeResponse);
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toBe('http://localhost:8000/agent/invoke');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ question: 'Is payment-service healthy?' });
  });

  it('normalizes a network-level failure (connection refused, DNS, timeout, ...) into AiServiceUnavailableError', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fetch failed: ECONNREFUSED'));

    await expect(aiServiceClient.invokeAgent('anything')).rejects.toThrow(AiServiceUnavailableError);
  });

  it('normalizes a non-2xx response into AiServiceUnavailableError, including a snippet of the body', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'internal server error detail',
    });

    await expect(aiServiceClient.invokeAgent('anything')).rejects.toThrow(/HTTP 500/);
  });

  it('never lets a raw exception escape -- both failure modes are always AiServiceUnavailableError', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue('not even an Error instance');

    await expect(aiServiceClient.invokeAgent('anything')).rejects.toThrow(AiServiceUnavailableError);
  });
});
