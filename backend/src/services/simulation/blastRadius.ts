import { bfsClosure, type GraphEdgeEntry } from './graph';
import type { SimulationServiceState } from './types';

/**
 * docs/architecture.md §10's `calculate_blast_radius` tool: the set of
 * services that would be impacted, directly or transitively, if
 * `serviceName` failed — without computing a full failure scenario's
 * projected metrics (that's simulateServiceFailure, which calls this and
 * builds on top of it). Useful standalone for a quick "how much does this
 * service matter" question.
 */
export function calculateBlastRadius(services: SimulationServiceState[], serviceName: string): GraphEdgeEntry[] {
  return bfsClosure(services, serviceName, 'dependents');
}
