/**
 * A small, generic circuit breaker (docs/phases.md row 16 / docs/architecture.md
 * §17: "circuit breaker"). Classic 3-state design (CLOSED -> OPEN ->
 * HALF_OPEN -> CLOSED), hand-implemented rather than a new dependency —
 * the state machine is small and this project has consistently
 * hand-implemented its other core mechanisms (the agent loop, cache-aside,
 * the Kafka dead-letter path) rather than reaching for a framework for
 * them.
 *
 * The concrete failure mode this solves: without a breaker, every call to
 * a genuinely-down dependency pays its full timeout before failing —
 * repeatedly, for as long as the dependency stays down. A breaker that has
 * seen enough consecutive failures starts failing fast instead (no network
 * attempt at all) until a cooldown elapses, then lets exactly one call
 * through as a probe. One instance is meant to be created per logical
 * downstream dependency (see src/clients/aiServiceClient.ts) and reused
 * across calls, not created fresh per call — its whole value is in
 * remembering state between calls.
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Consecutive failures (from CLOSED) needed to trip the breaker open. */
  failureThreshold: number;
  /** How long the breaker stays OPEN before allowing one HALF_OPEN probe call. */
  resetTimeoutMs: number;
}

export class CircuitOpenError extends Error {
  constructor(message = 'circuit breaker is open') {
    super(message);
    this.name = 'CircuitOpenError';
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private openedAt = 0;

  constructor(private readonly options: CircuitBreakerOptions) {}

  getState(): CircuitState {
    // Deriving OPEN -> HALF_OPEN lazily (on read/execute) rather than with
    // a timer means there's nothing to clean up and no timer to leak if a
    // breaker instance is discarded.
    if (this.state === 'OPEN' && Date.now() - this.openedAt >= this.options.resetTimeoutMs) {
      return 'HALF_OPEN';
    }
    return this.state;
  }

  /**
   * Runs `fn()` through the breaker. Throws CircuitOpenError without
   * calling `fn()` at all when the breaker is open and still cooling
   * down — that's the entire point: fail fast, don't even attempt the
   * call. When HALF_OPEN, exactly one call is allowed through as a probe;
   * its outcome decides whether the breaker closes again or reopens.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.getState();
    if (currentState === 'OPEN') {
      throw new CircuitOpenError();
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = 'CLOSED';
  }

  private onFailure(): void {
    this.consecutiveFailures += 1;
    const wasHalfOpenProbe = this.getState() === 'HALF_OPEN';
    if (wasHalfOpenProbe || this.consecutiveFailures >= this.options.failureThreshold) {
      this.state = 'OPEN';
      this.openedAt = Date.now();
    }
  }
}
