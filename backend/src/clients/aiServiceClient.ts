import { env } from '../config/env';

/**
 * HTTP boundary from the Node backend to the Python AI service -- the
 * mirror image of ai-service/app/clients/backend_client.py (Phase 8), and
 * the first code anywhere in this project that calls in this direction.
 * AI_SERVICE_URL has sat unused in backend/.env since Phase 1, waiting
 * for docs/architecture.md §3's sequence diagram ("BE->>AI: POST
 * /agent/invoke") to actually get wired up -- that's this phase.
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
 */

// The agent loop can make several sequential Groq round trips plus tool
// calls (AGENT_MAX_ITERATIONS iterations, each up to AGENT_TOOL_TIMEOUT_MS
// per tool call, ai-service/.env) before returning -- a much longer
// timeout than a typical backend-to-backend call, or this client would
// abort real in-progress agent work.
const REQUEST_TIMEOUT_MS = 45_000;

export class AiServiceUnavailableError extends Error {}

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
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
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
