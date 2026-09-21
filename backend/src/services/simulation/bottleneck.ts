import { calculateBlastRadius } from './blastRadius';
import type { SimulationServiceState, HealthStatus } from './types';

export interface BottleneckRanking {
  name: string;
  blastRadiusSize: number;
  currentStatus: HealthStatus;
}

export interface BottleneckResult {
  ranked: BottleneckRanking[];
  topBottleneck: BottleneckRanking | null;
}

const STATUS_SEVERITY: Record<HealthStatus, number> = { down: 2, degraded: 1, healthy: 0 };


export function findBottleneck(services: SimulationServiceState[]): BottleneckResult {
  const ranked: BottleneckRanking[] = services
    .map((svc) => ({
      name: svc.name,
      blastRadiusSize: calculateBlastRadius(services, svc.name).length,
      currentStatus: svc.health.status,
    }))
    .sort((a, b) => {
      if (b.blastRadiusSize !== a.blastRadiusSize) return b.blastRadiusSize - a.blastRadiusSize;
      return STATUS_SEVERITY[b.currentStatus] - STATUS_SEVERITY[a.currentStatus];
    });

  return { ranked, topBottleneck: ranked[0] ?? null };
}
