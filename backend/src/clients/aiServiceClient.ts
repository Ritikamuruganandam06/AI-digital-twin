import { env } from '../config/env';
import { withRetry } from '../utils/retry';
import { CircuitBreaker, CircuitOpenError } from '../utils/circuitBreaker';

/**
 * HTTP boundary from the Node backend to the Python AI service -- the
 * mirror image of ai-service/app/clients/backend_client.py (Phase 8), and
 * the first code anywhere in this project that calls in this direction.
 * AI_SERVICE_URL has sat unused in backend/.env since Phase 1, waiting
 * for docs/architecture.md §3's sequence diagram ("BE->>AI: POST
 * /agent/invoke") to actually get wired up -- that's Phase 14.
 *
 * Deliberately framework-agnostic (no Express req/res here), the same
 * style backend_client.py and backend/src/services/simulation use --
 * callers (assistant.service.ts) decide how to turn
 * AiServiceUnavailableError into an HTTP response.
 *
 * Uses Node's built-in `fetch` (global since Node 18, typed by @types/node
 * without any extra dependency) rather than adding axios/node-fetch --
 * this is one GET-shaped POST call, not enough surface to justify a new
 * dependency, the same reasoning Phase 11 used for choosing fastembed's
 * plain style on the Python side.
 *
 * Phase 16 adds two reliability patterns around the same underlying
 * fetch, both narrowly scoped to a real, identified failure mode rather
 * than applied blindly:
 *
 * - **Retry with backoff, but only for a connection that was never
 *   established at all** (ECONNREFUSED, DNS failure, ...) -- not for a
 *   timeout (a real agent run can legitimately take a while; retrying a
 *   timeout would just double an already-long wait) and not for a non-2xx
 *   response (the AI service DID respond -- see "What could and couldn't
 *   be verified here" in backend/README.md's Phase 16 section for why
 *   retrying that wouldn't help). This is exactly the case a brief
 *   restart of the AI service process produces.
 * - **A circuit breaker around the whole retrying call**, so that once
 *   the AI service has been unreachable for several consecutive requests,
 *   later requests fail immediately (no network attempt, no 45s wait)
 *   until a cooldown elapses and one probe call is allowed through. One
 *   module-level breaker instance is shared across every call, since its
 *   entire value is remembering state between them.
 */

// The agent loop can make several sequential Groq round trips plus tool
// calls (AGENT_MAX_ITERATIONS iterations, each up to AGENT_TOOL_TIMEOUT_MS
// per tool call, ai-service/.env) before returning -- a much longer
// timeout than a typical backend-to-backend call, or this client would
// abort real in-progress agent work.
const REQUEST_TIMEOUT_MS = 45_000;

// One retry, a short fixed backoff -- a second consecutive connection
// failure this close together means the process is actually down, not
// mid-restart, so a third attempt wouldn't help and would only add delay.
const RETRY_OPTIONS = { retries: 1, baseDelayMs: 300 };

// 3 consecutive failures (across retries -- see RETRY_OPTIONS) trips the
// breaker; 30s cooldown before the next probe. Both are plain constants,
// the same "not an env var" precedent every other timeout/threshold
// constant in this codebase already follows (e.g. REQUEST_TIMEOUT_MS
// above, ai-service/app/clients/backend_client.py's
// _REQUEST_TIMEOUT_SECONDS) -- docs/env-vars.md only grows when a phase
// starts reading a genuinely new *configured* value, not for every
// internal constant.
const aiServiceBreaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 30_000 });

export class AiServiceUnavailableError extends Error {}

/** A raw `fetch()` throw before any response was received -- never a timeout (AbortError) or a non-2xx response. */
function isConnectionFailure(err: unknown): boolean {
  return err instanceof TypeError; // Node's fetch throws TypeError for DNS/connection-refused/network errors
}

export interface ToolCallStepResponse {
  tool_name: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown>;
  is_rag_query: boolean;
  timestamp: string;
}

export interface AgentInvokeResponse {
  answer: string;
  steps: ToolCallStepResponse[];
  iterations: number;
  stopped_reason: string;
}

export const aiServiceClient = {
  /**
   * Calls the AI service's `POST /agent/invoke` (ai-service/app/api/agent.py)
   * and returns its parsed JSON body unchanged. Never lets a raw network
   * exception (connection refused, timeout, DNS failure, ...) or a
   * non-2xx response propagate past this function -- both are normalized
   * into AiServiceUnavailableError, the same "handle a downstream failure
   * cleanly" rule backend_client.py established for the reverse direction.
   */
  async invokeAgent(question: string): Promise<AgentInvokeResponse> {
    const url = `${env.aiServiceUrl}/agent/invoke`;

    let response: Response;
    try {
      response = await aiServiceBreaker.execute(() =>
        withRetry(
          () =>
            fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ question }),
              signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            }),
          { ...RETRY_OPTIONS, isRetryable: isConnectionFailure }
        )
      );
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        throw new AiServiceUnavailableError(
          `AI service circuit breaker is open for ${url} (too many recent failures) -- not attempting a network call`
        );
      }
      const reason = err instanceof Error ? err.message : String(err);
      throw new AiServiceUnavailableError(`Could not reach AI service at ${url}: ${reason}`);
    }

    if (!response.ok) {
      // A non-2xx response is a real answer from a live process, not a
      // connectivity problem -- it must not trip the breaker or be retried,
      // so this check runs *after* aiServiceBreaker.execute has already
      // recorded the call a success (the fetch resolved).
      const body = await response.text().catch(() => '');
      throw new AiServiceUnavailableError(
        `AI service returned HTTP ${response.status} for ${url}: ${body.slice(0, 200)}`
      );
    }

    return (await response.json()) as AgentInvokeResponse;
  },
};
