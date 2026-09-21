import { env } from '../config/env';
import { withRetry } from '../utils/retry';
import { CircuitBreaker, CircuitOpenError } from '../utils/circuitBreaker';


const REQUEST_TIMEOUT_MS = 45_000;


const RETRY_OPTIONS = { retries: 1, baseDelayMs: 300 };


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
      const body = await response.text().catch(() => '');
      throw new AiServiceUnavailableError(
        `AI service returned HTTP ${response.status} for ${url}: ${body.slice(0, 200)}`
      );
    }

    return (await response.json()) as AgentInvokeResponse;
  },
};
