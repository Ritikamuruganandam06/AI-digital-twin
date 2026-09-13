import { calculateBlastRadius } from './blastRadius';
import type { SimulationServiceState, SimulationResult, SimulatedServiceImpact } from './types';

/**
 * docs/architecture.md §10's `simulate_service_failure` tool: `serviceName`
 * fails outright, and — since every dependency in this topology is treated
 * as required, not optional (docs/architecture.md §1: this models a real
 * e-commerce checkout path, where a missing Payment Service genuinely means
 * no orders complete) — every service that depends on it, directly or
 * transitively, goes down too.
 */
export function simulateServiceFailure(services: SimulationServiceState[], serviceName: string): SimulationResult {
  const byName = new Map(services.map((s) => [s.name, s]));
  const origin = byName.get(serviceName);
  if (!origin) {
    throw new Error(`Unknown service "${serviceName}"`);
  }

  const blastRadius = calculateBlastRadius(services, serviceName).filter((entry) => byName.has(entry.name));

  const affectedServices: SimulatedServiceImpact[] = [
    {
      name: origin.name,
      distance: 0,
      projectedStatus: 'down',
      projectedLatencyMsP50: origin.health.latencyMsP50,
      projectedLatencyMsP99: origin.health.latencyMsP99,
      projectedErrorRatePercent: 100,
      reason: `${origin.name} has failed outright.`,
    },
    ...blastRadius.map(({ name, distance }): SimulatedServiceImpact => {
      const svc = byName.get(name)!;
      return {
        name,
        distance,
        projectedStatus: 'down',
        projectedLatencyMsP50: svc.health.latencyMsP50,
        projectedLatencyMsP99: svc.health.latencyMsP99,
        projectedErrorRatePercent: 100,
        reason:
          distance === 1
            ? `Depends directly on ${origin.name}, which has failed.`
            : `Depends transitively on ${origin.name} (${distance} hops away) through a service that has also failed.`,
      };
    }),
  ];

  const affectedNames = new Set(affectedServices.map((s) => s.name));
  const unaffectedServiceNames = services.map((s) => s.name).filter((name) => !affectedNames.has(name));

  const cascaded = blastRadius.map((b) => b.name);
  const summary =
    cascaded.length > 0
      ? `${origin.name} failing would also take down ${cascaded.length} dependent service(s): ${cascaded.join(', ')}.`
      : `${origin.name} failing would not cascade — no other seeded service depends on it.`;

  return { scenario: 'service_failure', summary, affectedServices, unaffectedServiceNames };
}
