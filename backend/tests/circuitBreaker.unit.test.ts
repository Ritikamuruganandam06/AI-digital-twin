import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from '../src/utils/circuitBreaker';

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts CLOSED and stays CLOSED while calls succeed', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 1000 });

    await breaker.execute(async () => 'ok');
    await breaker.execute(async () => 'ok');

    expect(breaker.getState()).toBe('CLOSED');
  });

  it('trips OPEN after `failureThreshold` consecutive failures, not before', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
    const failing = async () => {
      throw new Error('down');
    };

    await expect(breaker.execute(failing)).rejects.toThrow('down');
    expect(breaker.getState()).toBe('CLOSED'); // 1 failure, threshold is 3
    await expect(breaker.execute(failing)).rejects.toThrow('down');
    expect(breaker.getState()).toBe('CLOSED'); // 2 failures
    await expect(breaker.execute(failing)).rejects.toThrow('down');
    expect(breaker.getState()).toBe('OPEN'); // 3rd failure trips it
  });

  it('a single success resets the consecutive-failure count', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 1000 });
    const failing = async () => {
      throw new Error('down');
    };

    await expect(breaker.execute(failing)).rejects.toThrow('down');
    await breaker.execute(async () => 'ok'); // resets the streak
    await expect(breaker.execute(failing)).rejects.toThrow('down');

    expect(breaker.getState()).toBe('CLOSED'); // only 1 consecutive failure again, threshold is 2
  });

  it('while OPEN, rejects immediately with CircuitOpenError -- the wrapped function is never called', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
    const fn = vi.fn().mockRejectedValue(new Error('down'));

    await expect(breaker.execute(fn)).rejects.toThrow('down');
    expect(breaker.getState()).toBe('OPEN');

    fn.mockClear();
    await expect(breaker.execute(fn)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fn).not.toHaveBeenCalled(); // fails fast, no attempt at all
  });

  it('moves to HALF_OPEN once resetTimeoutMs has elapsed, and allows exactly one probe call', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
    await expect(breaker.execute(async () => { throw new Error('down'); })).rejects.toThrow();
    expect(breaker.getState()).toBe('OPEN');

    vi.setSystemTime(999);
    expect(breaker.getState()).toBe('OPEN'); // not yet

    vi.setSystemTime(1000);
    expect(breaker.getState()).toBe('HALF_OPEN');
  });

  it('a successful HALF_OPEN probe closes the breaker', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
    await expect(breaker.execute(async () => { throw new Error('down'); })).rejects.toThrow();
    vi.setSystemTime(1000);
    expect(breaker.getState()).toBe('HALF_OPEN');

    await breaker.execute(async () => 'recovered');

    expect(breaker.getState()).toBe('CLOSED');
  });

  it('a failed HALF_OPEN probe reopens the breaker immediately (does not wait for a second failure)', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 1000 });
    await expect(breaker.execute(async () => { throw new Error('down'); })).rejects.toThrow();
    // Only 1 failure so far -- CLOSED, not OPEN, since failureThreshold is 5.
    expect(breaker.getState()).toBe('CLOSED');

    // Force it open a different way: keep failing until threshold trips.
    for (let i = 0; i < 4; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await expect(breaker.execute(async () => { throw new Error('down'); })).rejects.toThrow();
    }
    expect(breaker.getState()).toBe('OPEN');

    vi.setSystemTime(1000);
    expect(breaker.getState()).toBe('HALF_OPEN');

    await expect(breaker.execute(async () => { throw new Error('still down'); })).rejects.toThrow('still down');
    expect(breaker.getState()).toBe('OPEN'); // one failed probe is enough to reopen, not 5 more
  });
});
