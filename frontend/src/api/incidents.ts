import { apiFetch } from './client';
import type { CreateIncidentInput, IncidentRecord, IncidentStatus } from './types';

export function listIncidents(status?: IncidentStatus, limit = 20): Promise<IncidentRecord[]> {
  return apiFetch<IncidentRecord[]>('/api/incidents', { query: { status, limit } });
}

export function getIncident(id: string): Promise<IncidentRecord> {
  return apiFetch<IncidentRecord>(`/api/incidents/${encodeURIComponent(id)}`);
}

/**
 * Requires OPERATOR/ADMIN (backend/src/routes/incidents.route.ts) -- a
 * USER token gets a real 403 back from the backend, surfaced to the
 * caller as an `ApiError`, not hidden here.
 *
 * Always sends a real `Idempotency-Key` (backend/src/middleware/idempotency.ts,
 * Phase 16): a fresh, random one per call by default, so a slow network
 * causing this to be called twice for the same user action (e.g. a
 * double-click before the submit button disables) can't silently file the
 * same incident twice. Pass `idempotencyKey` explicitly only when the
 * caller is deliberately retrying a specific earlier attempt.
 */
export function createIncident(input: CreateIncidentInput, idempotencyKey?: string): Promise<IncidentRecord> {
  return apiFetch<IncidentRecord>('/api/incidents', {
    method: 'POST',
    body: input,
    idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
  });
}
