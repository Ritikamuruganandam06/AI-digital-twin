import { bfsClosure } from './graph';
import { LATENCY_OUTAGE_MULTIPLIER, PROPAGATION_DECAY_FACTOR } from './constants';
import type { SimulationServiceState, SimulationResult, SimulatedServiceImpact } from './types';


export function simulateHighLatency(
  services: SimulationServiceState[],
  serviceName: string,
  latencyMultiplier: number
): SimulationResult {
  if (!(latencyMultiplier > 0)) {
    throw new Error('latencyMultiplier must be greater than 0 (use a value below 1 to model a latency improvement)');
  }

  const byName = new Map(services.map((s) => [s.name, s]));
  const origin = byName.get(serviceName);
  if (!origin) {
    throw new Error(`Unknown service "${serviceName}"`);
  }

  const projectedLatencyMsP50 = Math.round(origin.health.latencyMsP50 * latencyMultiplier);
  const projectedLatencyMsP99 = Math.round(origin.health.latencyMsP99 * latencyMultiplier);
  const originStatus = latencyMultiplier >= LATENCY_OUTAGE_MULTIPLIER ? 'down' : latencyMultiplier > 1 ? 'degraded' : 'healthy';
  const originErrorRatePercent =
    originStatus === 'down' ? Math.min(100, Math.round(origin.health.errorRatePercent * 2 * 100) / 100) : origin.health.errorRatePercent;

  const addedLatencyP50 = projectedLatencyMsP50 - origin.health.latencyMsP50;
  const addedLatencyP99 = projectedLatencyMsP99 - origin.health.latencyMsP99;

  const dependents = bfsClosure(services, serviceName, 'dependents').filter((entry) => byName.has(entry.name));

  const affectedServices: SimulatedServiceImpact[] = [
    {
      name: origin.name,
      distance: 0,
      projectedStatus: originStatus,
      projectedLatencyMsP50,
      projectedLatencyMsP99,
      projectedErrorRatePercent: originErrorRatePercent,
      reason: `${origin.name}'s latency increased ${latencyMultiplier}x (p50 ${origin.health.latencyMsP50} -> ${projectedLatencyMsP50}ms).`,
    },
    ...dependents.map(({ name, distance }): SimulatedServiceImpact => {
      const svc = byName.get(name)!;
      const decay = PROPAGATION_DECAY_FACTOR ** (distance - 1);
      const extraP50 = Math.round(addedLatencyP50 * decay);
      const extraP99 = Math.round(addedLatencyP99 * decay);
      const newP50 = svc.health.latencyMsP50 + Math.max(0, extraP50);
      const status = extraP50 > svc.health.latencyMsP50 * 0.5 ? 'degraded' : 'healthy';
      return {
        name,
        distance,
        projectedStatus: status,
        projectedLatencyMsP50: newP50,
        projectedLatencyMsP99: svc.health.latencyMsP99 + Math.max(0, extraP99),
        projectedErrorRatePercent: svc.health.errorRatePercent,
        reason: `Waits on ${origin.name} (${distance} hop(s) away), inheriting a decayed share of its added latency.`,
      };
    }),
  ];

  const affectedNames = new Set(affectedServices.map((s) => s.name));
  const unaffectedServiceNames = services.map((s) => s.name).filter((name) => !affectedNames.has(name));

  const summary = `${origin.name} running ${latencyMultiplier}x slower propagates measurable latency to ${dependents.length} dependent service(s).`;

  return { scenario: 'high_latency', summary, affectedServices, unaffectedServiceNames };
}
