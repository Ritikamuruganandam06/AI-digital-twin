import type { SimulationServiceState } from './types';

export interface GraphEdgeEntry {
  name: string;
  /** Hops from the origin; 1 = a direct edge. */
  distance: number;
}

/**
 * Generic BFS transitive closure over one direction of the topology graph.
 * `edge: 'dependents'` walks "who is affected if this service fails"
 * (calculateBlastRadius, simulateServiceFailure); `edge: 'dependencies'`
 * walks "what does this service call, and transitively rely on"
 * (simulateTrafficIncrease's upstream load propagation). Shared by both
 * directions instead of two near-duplicate traversal functions.
 *
 * Throws on an unknown origin name — this module has no HTTP/AppError
 * concept of its own (it stays framework-agnostic on purpose); a caller in
 * a later phase's controller/tool layer is responsible for validating the
 * name and translating this into a 400 before it ever reaches here.
 */
export function bfsClosure(
  services: SimulationServiceState[],
  originName: string,
  edge: 'dependencies' | 'dependents'
): GraphEdgeEntry[] {
  const byName = new Map(services.map((s) => [s.name, s]));
  const origin = byName.get(originName);
  if (!origin) {
    throw new Error(`Unknown service "${originName}"`);
  }

  const visited = new Map<string, number>();
  let frontier = origin[edge];
  let distance = 1;

  while (frontier.length > 0) {
    const next: string[] = [];
    for (const name of frontier) {
      if (visited.has(name)) continue;
      visited.set(name, distance);
      const svc = byName.get(name);
      // A dependency/dependent name not itself present in `services` (a
      // partially-seeded or hand-edited topology) simply has nothing
      // further to traverse from — it still gets an entry, same tolerance
      // as Phase 6's computeDependents().
      if (svc) next.push(...svc[edge]);
    }
    frontier = next;
    distance += 1;
  }

  return [...visited.entries()].map(([name, dist]) => ({ name, distance: dist }));
}

/**
 * Merges the "dependents" closures of several simultaneous origins (e.g.
 * every service directly knocked out by a database failure) into one
 * ranked cascade: the shortest distance from ANY origin wins, and any
 * service that is itself one of the origins is excluded (it's already
 * accounted for directly, not "cascaded to"). Used by
 * simulateDatabaseFailure and simulateCacheFailure.
 */
export function cascadeFromOrigins(services: SimulationServiceState[], originNames: Set<string>): GraphEdgeEntry[] {
  const merged = new Map<string, number>();

  for (const name of originNames) {
    for (const entry of bfsClosure(services, name, 'dependents')) {
      if (originNames.has(entry.name)) continue;
      const existing = merged.get(entry.name);
      if (existing === undefined || entry.distance < existing) {
        merged.set(entry.name, entry.distance);
      }
    }
  }

  return [...merged.entries()].map(([name, distance]) => ({ name, distance }));
}
