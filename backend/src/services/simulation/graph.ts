import type { SimulationServiceState } from './types';

export interface GraphEdgeEntry {
  name: string;
  distance: number;
}


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
      if (svc) next.push(...svc[edge]);
    }
    frontier = next;
    distance += 1;
  }

  return [...visited.entries()].map(([name, dist]) => ({ name, distance: dist }));
}

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
