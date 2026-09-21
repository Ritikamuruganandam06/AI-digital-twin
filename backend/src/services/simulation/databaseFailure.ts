import { cascadeFromOrigins } from './graph';
import type { SimulationServiceState, SimulationResult, SimulatedServiceImpact } from './types';


export function simulateDatabaseFailure(services: SimulationServiceState[]): SimulationResult {
  const directlyAffected = services.filter((s) => s.dependsOnDatabase !== false);
  const directNames = new Set(directlyAffected.map((s) => s.name));

  const direct: SimulatedServiceImpact[] = directlyAffected.map((svc) => ({
    name: svc.name,
    distance: 0,
    projectedStatus: 'down',
    projectedLatencyMsP50: svc.health.latencyMsP50,
    projectedLatencyMsP99: svc.health.latencyMsP99,
    projectedErrorRatePercent: 100,
    reason: `${svc.name} depends directly on the database, which is unavailable.`,
  }));

  const byName = new Map(services.map((s) => [s.name, s]));
  const cascaded = cascadeFromOrigins(services, directNames).filter((entry) => byName.has(entry.name));

  const affectedServices: SimulatedServiceImpact[] = [
    ...direct,
    ...cascaded.map(({ name, distance }): SimulatedServiceImpact => {
      const svc = byName.get(name)!;
      return {
        name,
        distance,
        projectedStatus: 'down',
        projectedLatencyMsP50: svc.health.latencyMsP50,
        projectedLatencyMsP99: svc.health.latencyMsP99,
        projectedErrorRatePercent: 100,
        reason: `Depends on a database-dependent service that has gone down (${distance} hop(s) away).`,
      };
    }),
  ];

  const affectedNames = new Set(affectedServices.map((s) => s.name));
  const unaffectedServiceNames = services.map((s) => s.name).filter((name) => !affectedNames.has(name));

  const summary = `Database failure takes down ${direct.length} directly-dependent service(s) and cascades to ${cascaded.length} more.`;

  return { scenario: 'database_failure', summary, affectedServices, unaffectedServiceNames };
}
