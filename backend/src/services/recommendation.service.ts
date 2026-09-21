import { serviceRepository, type ServiceHealthRecord } from '../repositories/service.repository';
import type { HealthStatus } from '../data/seedTopology';


export const DOWN_SCALE_REPLICA_MULTIPLIER = 2;
export const DEGRADED_SCALE_REPLICA_MULTIPLIER = 1.5;

export interface ScalingRecommendation {
  serviceName: string;
  currentStatus: HealthStatus;
  recommendation: 'scale_out' | 'no_action';
  suggestedReplicaMultiplier: number;
  reason: string;
}

/** Pure function, no I/O — unit-testable without a database, same discipline as topology.service.ts's computeDependents. */
export function computeScalingRecommendation(
  serviceName: string,
  health: Pick<ServiceHealthRecord, 'status' | 'errorRatePercent' | 'latencyMsP99'>
): ScalingRecommendation {
  if (health.status === 'down') {
    return {
      serviceName,
      currentStatus: health.status,
      recommendation: 'scale_out',
      suggestedReplicaMultiplier: DOWN_SCALE_REPLICA_MULTIPLIER,
      reason: `"${serviceName}" is currently down (errorRate ${health.errorRatePercent}%, p99 latency ${health.latencyMsP99}ms) — recommend doubling capacity as a first response.`,
    };
  }

  if (health.status === 'degraded') {
    return {
      serviceName,
      currentStatus: health.status,
      recommendation: 'scale_out',
      suggestedReplicaMultiplier: DEGRADED_SCALE_REPLICA_MULTIPLIER,
      reason: `"${serviceName}" is currently degraded (errorRate ${health.errorRatePercent}%, p99 latency ${health.latencyMsP99}ms) — recommend scaling out before it worsens.`,
    };
  }

  return {
    serviceName,
    currentStatus: health.status,
    recommendation: 'no_action',
    suggestedReplicaMultiplier: 1,
    reason: `"${serviceName}" is currently healthy — no scaling action recommended.`,
  };
}

/** Composes the pure rule above with a real repository lookup. Never mutates anything — this only ever returns a recommendation, matching §10's privilege note exactly. */
export async function recommendScalingForService(serviceName: string): Promise<ScalingRecommendation | null> {
  const service = await serviceRepository.findByName(serviceName);
  if (!service) return null;
  return computeScalingRecommendation(service.name, service.health);
}
