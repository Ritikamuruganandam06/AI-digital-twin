import { apiFetch } from './client';
import type { AgentExecutionRecord } from './types';

/**
 * `POST /api/assistant/ask` -- the one endpoint that reaches the AI
 * service (through the backend; see `docs/architecture.md` §3's sequence
 * diagram). Returns the full, freshly-persisted `AgentExecutionRecord`,
 * the same object `GET /api/executions/:id` would return for it
 * afterward -- so a caller gets the complete trace (steps, retrieved
 * documents, `stoppedReason`) immediately, not just the final text.
 */
export function askAssistant(question: string): Promise<AgentExecutionRecord> {
  return apiFetch<AgentExecutionRecord>('/api/assistant/ask', {
    method: 'POST',
    body: { question },
  });
}
