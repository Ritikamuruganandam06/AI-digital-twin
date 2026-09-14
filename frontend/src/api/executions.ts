import { apiFetch } from './client';
import type { AgentExecutionRecord } from './types';

export function listExecutions(limit = 20): Promise<AgentExecutionRecord[]> {
  return apiFetch<AgentExecutionRecord[]>('/api/executions', { query: { limit } });
}

export function getExecution(id: string): Promise<AgentExecutionRecord> {
  return apiFetch<AgentExecutionRecord>(`/api/executions/${encodeURIComponent(id)}`);
}
