import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Proves the Phase 16 retry + circuit breaker behavior actually wired into
 * aiServiceClient.invokeAgent() (src/clients/aiServiceClient.ts), as
 * distinct from tests/aiServiceClient.unit.test.ts (Phase 14), which only
 * covers request shape and basic failure normalization.
 *
 * Every test does `vi.resetModules()` + a dynamic `await import(...)`
 * before touching aiServiceClient, so each test gets its own fresh
 * `aiServiceBreaker` module-level instance (CLOSED, 0 consecutive
 * failures) rather than inheriting state left behind by a previous test --
 * the breaker's whole point is remembering state across calls, so without
 * this the tests would be order-dependent on each other.
 */

const originalFetch = global.fetch;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(0);
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function freshClient() {
  const mod = await import('../src/clients/aiServiceClient');
  return mod;
}

function connectionFailure(): TypeError {
  // Node's fetch throws a TypeError for DNS/connection-refused/network
  // errors -- this is exactly what isConnectionFailure() in
  // aiServiceClient.ts checks for.
  return new TypeError('fetch failed: ECONNREFUSED');
}

function timeoutFailure(): DOMException {
  // AbortSignal.timeout(...) firing rejects fetch with a DOMException
  // named "TimeoutError" (or "AbortError" on some Node versions) -- never
  // a TypeError, so isConnectionFailure() must reject it.
  return new DOMException('The operation was aborted due to timeout', 'TimeoutError');
}

const okResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

describe('aiServiceClient.invokeAgent -- retry with backoff', () => {
  it('retries once after a connection failure and returns the eventual success', async () => {
    const { aiServiceClient } = await freshClient();
    const fakeResponse = { answer: 'ok', steps: [], iterations: 1, stopped_reason: 'final_answer' };
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(connectionFailure())
      .mockResolvedValueOnce(okResponse(fakeResponse));

    const promise = aiServiceClient.invokeAgent('anything');
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual(fakeResponse);
    expect(global.fetch).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
  });

  it('retries once after a connection failure, then still fails -> AiServiceUnavailableError', async () => {
    const { aiServiceClient, AiServiceUnavailableError } = await freshClient();
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(connectionFailure());

    const promise = aiServiceClient.invokeAgent('anything');
    const expectation = expect(promise).rejects.toThrow(AiServiceUnavailableError);
    await vi.runAllTimersAsync();
    await expectation;

    expect(global.fetch).toHaveBeenCalledTimes(2); // 1 initial + 1 retry, then gives up
  });

  it('does NOT retry a timeout -- retrying would just double an already-long wait', async () => {
    const { aiServiceClient, AiServiceUnavailableError } = await freshClient();
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(timeoutFailure());

    await expect(aiServiceClient.invokeAgent('anything')).rejects.toThrow(AiServiceUnavailableError);
    expect(global.fetch).toHaveBeenCalledTimes(1); // no retry at all
  });

  it('does NOT retry a non-2xx response -- the AI service DID respond', async () => {
    const { aiServiceClient, AiServiceUnavailableError } = await freshClient();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'agent crashed',
    });

    await expect(aiServiceClient.invokeAgent('anything')).rejects.toThrow(AiServiceUnavailableError);
    expect(global.fetch).toHaveBeenCalledTimes(1); // no retry at all
  });
});

describe('aiServiceClient.invokeAgent -- circuit breaker', () => {
  it('trips open after 3 consecutive failed calls, then fails fast without attempting a fetch', async () => {
    const { aiServiceClient, AiServiceUnavailableError } = await freshClient();
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(connectionFailure());

    // 3 consecutive failing invokeAgent() calls trips the shared breaker
    // (failureThreshold: 3). Each call itself retries once internally, so
    // this is 3 breaker-level failures, not 3 fetch attempts.
    for (let i = 0; i < 3; i += 1) {
      const promise = aiServiceClient.invokeAgent('anything');
      const expectation = expect(promise).rejects.toThrow(AiServiceUnavailableError);
      // eslint-disable-next-line no-await-in-loop
      await vi.runAllTimersAsync();
      // eslint-disable-next-line no-await-in-loop
      await expectation;
    }
    expect(global.fetch).toHaveBeenCalledTimes(6); // 3 calls x (1 initial + 1 retry)

    (global.fetch as ReturnType<typeof vi.fn>).mockClear();

    // 4th call: breaker is OPEN -- no fetch attempt at all, fails immediately.
    await expect(aiServiceClient.invokeAgent('anything')).rejects.toThrow(AiServiceUnavailableError);
    await expect(aiServiceClient.invokeAgent('anything')).rejects.toThrow(/circuit breaker is open/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('a non-2xx response does not count as a breaker failure (the service is up, just said no)', async () => {
    const { aiServiceClient, AiServiceUnavailableError } = await freshClient();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'busy',
    });

    // 5 non-2xx responses -- well past failureThreshold: 3 -- must never
    // trip the breaker, since fetch itself resolved every time.
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await expect(aiServiceClient.invokeAgent('anything')).rejects.toThrow(AiServiceUnavailableError);
    }
    expect(global.fetch).toHaveBeenCalledTimes(5); // never short-circuited

    // Prove the breaker is still CLOSED: a subsequent success goes through cleanly.
    const fakeResponse = { answer: 'ok', steps: [], iterations: 1, stopped_reason: 'final_answer' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(okResponse(fakeResponse));
    await expect(aiServiceClient.invokeAgent('anything')).resolves.toEqual(fakeResponse);
  });
});
