import { bfsClosure } from './graph';
import {
  TRAFFIC_CAPACITY_MULTIPLIER,
  DEGRADED_UTILIZATION_RATIO,
  OVERLOAD_UTILIZATION_RATIO,
} from './constants';
import type { SimulationServiceState, SimulationResult, SimulatedServiceImpact, HealthStatus } from './types';

interface UtilizationImpact {
  status: HealthStatus;
  latencyMsP50: number;
  latencyMsP99: number;
  errorRatePercent: number;
}


function projectUtilizationImpact(
  baseline: SimulationServiceState['health'],
  projectedTrafficRps: number
): UtilizationImpact {
  const capacity = Math.max(baseline.trafficRps, 1) * TRAFFIC_CAPACITY_MULTIPLIER;
  const utilization = projectedTrafficRps / capacity;

  if (utilization <= DEGRADED_UTILIZATION_RATIO) {
    return {
      status: 'healthy',
      latencyMsP50: Math.round(baseline.latencyMsP50 * (1 + utilization * 0.1)),
      latencyMsP99: Math.round(baseline.latencyMsP99 * (1 + utilization * 0.1)),
      errorRatePercent: baseline.errorRatePercent,
    };
  }

  if (utilization <= OVERLOAD_UTILIZATION_RATIO) {
    const degradedFraction = (utilization - DEGRADED_UTILIZATION_RATIO) / (OVERLOAD_UTILIZATION_RATIO - DEGRADED_UTILIZATION_RATIO);
    return {
      status: 'degraded',
      latencyMsP50: Math.round(baseline.latencyMsP50 * (1 + degradedFraction * 2)),
      latencyMsP99: Math.round(baseline.latencyMsP99 * (1 + degradedFraction * 3)),
      errorRatePercent: Math.min(100, Math.round(baseline.errorRatePercent * (1 + degradedFraction * 3) * 100) / 100),
    };
  }

  const overloadFactor = utilization - OVERLOAD_UTILIZATION_RATIO;
  return {
    status: 'down',
    latencyMsP50: Math.round(baseline.latencyMsP50 * (5 + overloadFactor * 5)),
    latencyMsP99: Math.round(baseline.latencyMsP99 * (5 + overloadFactor * 5)),
    errorRatePercent: Math.min(100, Math.round((baseline.errorRatePercent + overloadFactor * 100) * 100) / 100),
  };
}


export function simulateTrafficIncrease(
  services: SimulationServiceState[],
  serviceName: string,
  multiplier: number
): SimulationResult {
  if (!(multiplier > 0)) {
    throw new Error('multiplier must be greater than 0 (use a value below 1 to model reduced traffic)');
  }

  const byName = new Map(services.map((s) => [s.name, s]));
  const origin = byName.get(serviceName);
  if (!origin) {
    throw new Error(`Unknown service "${serviceName}"`);
  }

  const upstream = bfsClosure(services, serviceName, 'dependencies').filter((entry) => byName.has(entry.name));
  const originName = origin.name;

  function toImpact(svc: SimulationServiceState, distance: number): SimulatedServiceImpact {
    const projectedTraffic = svc.health.trafficRps * multiplier;
    const impact = projectUtilizationImpact(svc.health, projectedTraffic);
    const verb = multiplier >= 1 ? 'increased' : 'reduced';
    return {
      name: svc.name,
      distance,
      projectedStatus: impact.status,
      projectedLatencyMsP50: impact.latencyMsP50,
      projectedLatencyMsP99: impact.latencyMsP99,
      projectedErrorRatePercent: impact.errorRatePercent,
      reason:
        distance === 0
          ? `Traffic to ${svc.name} ${verb} ${multiplier}x (${Math.round(svc.health.trafficRps)} -> ${Math.round(projectedTraffic)} rps).`
          : `Call volume to ${svc.name} scales with ${originName}'s traffic (${distance} hop(s) upstream).`,
    };
  }

  const affectedServices: SimulatedServiceImpact[] = [
    toImpact(origin, 0),
    ...upstream.map(({ name, distance }) => toImpact(byName.get(name)!, distance)),
  ];

  const affectedNames = new Set(affectedServices.map((s) => s.name));
  const unaffectedServiceNames = services.map((s) => s.name).filter((name) => !affectedNames.has(name));

  const statusRank: Record<HealthStatus, number> = { healthy: 0, degraded: 1, down: 2 };
  const worstStatus = affectedServices.reduce<HealthStatus>(
    (worst, s) => (statusRank[s.projectedStatus] > statusRank[worst] ? s.projectedStatus : worst),
    'healthy'
  );

  const summary = `${multiplier}x traffic on ${origin.name} projects to "${worstStatus}" at its worst point across ${affectedServices.length} affected service(s).`;

  return { scenario: 'traffic_increase', summary, affectedServices, unaffectedServiceNames };
}
