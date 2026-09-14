/**
 * Generic retry-with-backoff helper (docs/phases.md row 16 / docs/architecture.md
 * §17: "retries with backoff"). Deliberately narrow by default: retrying a
 * call that already returned a real answer (even an error response) is
 * usually wrong — only a genuine transient failure (the callee never
 * responded at all) is worth paying for a second attempt. Callers pass
 * `isRetryable` to say exactly which failures qualify; the default treats
 * everything as non-retryable so a caller must opt in deliberately rather
 * than accidentally retrying something unsafe to retry.
 *
 * No new dependency — this is one small, generic function, the same
 * "hand-roll it, don't reach for a library" choice this project has made
 * for aiServiceClient.ts's fetch usage and the agent loop itself.
 */

export interface RetryOptions {
  /** Number of ADDITIONAL attempts after the first (so retries: 1 means at most 2 attempts total). */
  retries: number;
  /** Delay before the first retry. Doubles on each subsequent attempt. */
  baseDelayMs: number;
  /** Backoff never grows past this, so a large `retries` can't lead to an unreasonably long wait. */
  maxDelayMs?: number;
  /** Only failures this returns true for are retried; anything else is re-thrown immediately. */
  isRetryable?: (err: unknown) => boolean;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const { retries, baseDelayMs, maxDelayMs = Infinity, isRetryable = () => false } = options;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err) {
      const canRetry = attempt < retries && isRetryable(err);
      if (!canRetry) {
        throw err;
      }
      const waitMs = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      attempt += 1;
      await delay(waitMs);
    }
  }
}
