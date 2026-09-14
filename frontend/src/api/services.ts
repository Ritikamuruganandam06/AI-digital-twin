import { apiFetch } from './client';
import type { ServiceMetricRecord, ServiceRecord, ServiceTopologyView } from './types';

export function listServices(): Promise<ServiceRecord[]> {
  return apiFetch<ServiceRecord[]>('/api/services');
}

export function getService(name: string): Promise<ServiceTopologyView> {
  return apiFetch<ServiceTopologyView>(`/api/services/${encodeURIComponent(name)}`);
}

export function getServiceMetrics(name: string, limit = 20): Promise<ServiceMetricRecord[]> {
  return apiFetch<ServiceMetricRecord[]>(`/api/services/${encodeURIComponent(name)}/metrics`, {
    query: { limit },
  });
}
