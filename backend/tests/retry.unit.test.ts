import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry } from '../src/utils/retry';

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the result on the first try without waiting, when it succeeds', async () => {
    const fn = vi.fn().mockResolvedValue('ok');

    const result = await withRetry(fn, { retries: 3, baseDelayMs: 100 });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('retries a retryable failure and eventually succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValueOnce('ok');

    const promise = withRetry(fn, { retries: 2, baseDelayMs: 100, isRetryable: () => true });
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('never retries when isRetryable returns false (the default)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('not transient'));

    await expect(withRetry(fn, { retries: 5, baseDelayMs: 100 })).rejects.toThrow('not transient');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('gives up after exhausting `retries` and throws the last error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));

    const promise = withRetry(fn, { retries: 2, baseDelayMs: 10, isRetryable: () => true });
    const expectation = expect(promise).rejects.toThrow('always fails');
    await vi.runAllTimersAsync();
    await expectation;

    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('only retries failures isRetryable actually approves, per error', async () => {
    class TransientError extends Error {}
    const fn = vi.fn().mockRejectedValue(new Error('permanent, not a TransientError'));

    await expect(
      withRetry(fn, { retries: 3, baseDelayMs: 10, isRetryable: (err) => err instanceof TransientError })
    ).rejects.toThrow('permanent, not a TransientError');
    expect(fn).toHaveBeenCalledOnce(); // never matched isRetryable, so no retry at all
  });

  it('backs off exponentially, doubling the delay each attempt, capped at maxDelayMs', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('1'))
      .mockRejectedValueOnce(new Error('2'))
      .mockRejectedValueOnce(new Error('3'))
      .mockResolvedValueOnce('ok');

    const promise = withRetry(fn, { retries: 3, baseDelayMs: 100, maxDelayMs: 250, isRetryable: () => true });

    // 1st retry after 100ms
    await vi.advanceTimersByTimeAsync(99);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2);

    // 2nd retry after 200ms (100 * 2^1)
    await vi.advanceTimersByTimeAsync(199);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(3);

    // 3rd retry after min(100 * 2^2, 250) = 250ms, not 400ms
    await vi.advanceTimersByTimeAsync(249);
    expect(fn).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(4);

    await expect(promise).resolves.toBe('ok');
  });
});
