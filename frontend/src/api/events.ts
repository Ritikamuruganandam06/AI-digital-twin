import { apiFetch } from './client';
import type { EventRecord } from './types';

export function listEvents(serviceName?: string, limit = 20): Promise<EventRecord[]> {
  return apiFetch<EventRecord[]>('/api/events', {
    query: { service: serviceName, limit },
  });
}
