import { bfsClosure, type GraphEdgeEntry } from './graph';
import type { SimulationServiceState } from './types';


export function calculateBlastRadius(services: SimulationServiceState[], serviceName: string): GraphEdgeEntry[] {
  return bfsClosure(services, serviceName, 'dependents');
}
