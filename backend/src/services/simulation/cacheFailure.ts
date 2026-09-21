import { cascadeFromOrigins } from './graph';
import { CACHE_FAILURE_LATENCY_MULTIPLIER, CACHE_FAILURE_ERROR_RATE_MULTIPLIER, PROPAGATION_DECAY_FACTOR } from './constants';
import type { SimulationServiceState, SimulationResult, SimulatedServiceImpact } from './types';


export function simulateCacheFailure(services: SimulationServiceState[]): SimulationResult {
  const directlyAffected = services.filter((s) => s.dependsOnCache !== false);
  const directNames = new Set(directlyAffected.map((s) => s.name));

  const direct: SimulatedServiceImpact[] = directlyAffected.map((svc) => ({
    name: svc.name,
    distance: 0,
    projectedStatus: 'degraded',
    projectedLatencyMsP50: Math.round(svc.health.latencyMsP50 * CACHE_FAILURE_LATENCY_MULTIPLIER),
    projectedLatencyMsP99: Math.round(svc.health.latencyMsP99 * CACHE_FAILURE_LATENCY_MULTIPLIER),
    projectedErrorRatePercent:
      Math.min(100, Math.round(Math.max(svc.health.errorRatePercent, 0.1) * CACHE_FAILURE_ERROR_RATE_MULTIPLIER * 100) / 100),
    reason: `${svc.name} loses its cache and falls back to querying the database directly on every request — slower, not broken.`,
  }));

  const byName = new Map(services.map((s) => [s.name, s]));
  const directByName = new Map(direct.map((d) => [d.name, d]));
  const cascaded = cascadeFromOrigins(services, directNames).filter((entry) => byName.has(entry.name));

  const affectedServices: SimulatedServiceImpact[] = [
    ...direct,
    ...cascaded.map(({ name, distance }): SimulatedServiceImpact => {
      const svc = byName.get(name)!;
      // Find the nearest directly-affected ancestor's added latency to decay from — approximated here by decaying the largest direct latency bump in the graph, since this simplified model doesn't track exact paths.
      const worstDirectAddedLatency = Math.max(
        0,
        ...[...directByName.values()].map((d) => d.projectedLatencyMsP50 - (byName.get(d.name)?.health.latencyMsP50 ?? 0))
      );
      const decay = PROPAGATION_DECAY_FACTOR ** distance;
      const extraLatency = Math.round(worstDirectAddedLatency * decay);
      const status = extraLatency > svc.health.latencyMsP50 * 0.3 ? 'degraded' : 'healthy';
      return {
        name,
        distance,
        projectedStatus: status,
        projectedLatencyMsP50: svc.health.latencyMsP50 + extraLatency,
        projectedLatencyMsP99: svc.health.latencyMsP99 + extraLatency,
        projectedErrorRatePercent: svc.health.errorRatePercent,
        reason: `Depends on a cache-degraded service (${distance} hop(s) away) — slower, not down.`,
      };
    }),
  ];

  const affectedNames = new Set(affectedServices.map((s) => s.name));
  const unaffectedServiceNames = services.map((s) => s.name).filter((name) => !affectedNames.has(name));

  const summary = `Cache failure slows ${direct.length} directly-dependent service(s) and ${cascaded.length} more downstream — none go fully down.`;

  return { scenario: 'cache_failure', summary, affectedServices, unaffectedServiceNames };
}
