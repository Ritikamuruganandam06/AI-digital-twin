import { bfsClosure } from './graph';
import { ERROR_RATE_OUTAGE_PERCENT, PROPAGATION_DECAY_FACTOR } from './constants';
import type { SimulationServiceState, SimulationResult, SimulatedServiceImpact } from './types';

/**
 * docs/architecture.md §11's "high error rate" simulation type:
 * `serviceName` starts failing a fraction of its requests, and every
 * service that depends on it inherits a decayed share of that excess error
 * rate (a request chain through two failing hops fails more than one, but
 * this model doesn't compound multiplicatively — it's a simple additive
 * decay, matching simulateHighLatency's propagation shape for consistency).
 */
export function simulateHighErrorRate(
  services: SimulationServiceState[],
  serviceName: string,
  errorRateMultiplier: number
): SimulationResult {
  if (!(errorRateMultiplier > 0)) {
    throw new Error('errorRateMultiplier must be greater than 0 (use a value below 1 to model an improvement)');
  }

  const byName = new Map(services.map((s) => [s.name, s]));
  const origin = byName.get(serviceName);
  if (!origin) {
    throw new Error(`Unknown service "${serviceName}"`);
  }

  // A 0% baseline error rate has nothing to multiply, so give it a small
  // floor first — otherwise errorRateMultiplier would have no effect at
  // all on an already-perfect service, which would be a misleading result
  // for a scenario that's specifically about error rate going up.
  const effectiveBaseline = Math.max(origin.health.errorRatePercent, 0.1);
  const projectedErrorRatePercent = Math.min(100, Math.round(effectiveBaseline * errorRateMultiplier * 100) / 100);
  const originStatus = projectedErrorRatePercent >= ERROR_RATE_OUTAGE_PERCENT ? 'down' : errorRateMultiplier > 1 ? 'degraded' : 'healthy';
  const addedErrorRate = projectedErrorRatePercent - origin.health.errorRatePercent;

  const dependents = bfsClosure(services, serviceName, 'dependents').filter((entry) => byName.has(entry.name));

  const affectedServices: SimulatedServiceImpact[] = [
    {
      name: origin.name,
      distance: 0,
      projectedStatus: originStatus,
      projectedLatencyMsP50: origin.health.latencyMsP50,
      projectedLatencyMsP99: origin.health.latencyMsP99,
      projectedErrorRatePercent,
      reason: `${origin.name}'s error rate increased ${errorRateMultiplier}x (${origin.health.errorRatePercent}% -> ${projectedErrorRatePercent}%).`,
    },
    ...dependents.map(({ name, distance }): SimulatedServiceImpact => {
      const svc = byName.get(name)!;
      const decay = PROPAGATION_DECAY_FACTOR ** (distance - 1);
      const extraErrorRate = Math.max(0, Math.round(addedErrorRate * decay * 100) / 100);
      const newErrorRate = Math.min(100, Math.round((svc.health.errorRatePercent + extraErrorRate) * 100) / 100);
      const status = newErrorRate >= ERROR_RATE_OUTAGE_PERCENT ? 'down' : extraErrorRate > 1 ? 'degraded' : 'healthy';
      return {
        name,
        distance,
        projectedStatus: status,
        projectedLatencyMsP50: svc.health.latencyMsP50,
        projectedLatencyMsP99: svc.health.latencyMsP99,
        projectedErrorRatePercent: newErrorRate,
        reason: `Calls ${origin.name} (${distance} hop(s) away) and inherits a decayed share of its failed requests.`,
      };
    }),
  ];

  const affectedNames = new Set(affectedServices.map((s) => s.name));
  const unaffectedServiceNames = services.map((s) => s.name).filter((name) => !affectedNames.has(name));

  const summary = `${origin.name}'s error rate rising to ${projectedErrorRatePercent}% propagates to ${dependents.length} dependent service(s).`;

  return { scenario: 'high_error_rate', summary, affectedServices, unaffectedServiceNames };
}
