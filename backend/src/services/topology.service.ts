import { serviceRepository, type ServiceRecord } from '../repositories/service.repository';

export interface DependencyGraphInput {
  name: string;
  dependencies: string[];
}

/**
 * Pure function, no I/O — deliberately kept free of any Mongoose/repository
 * dependency so it's unit-testable without a database
 * (tests/topology.unit.test.ts). `dependencies` is the graph's single
 * source of truth; this derives the reverse edges rather than trusting a
 * second hand-maintained array, which is what makes it structurally
 * impossible for `dependents` to drift out of sync with `dependencies`.
 *
 * Tolerates a dependency name that doesn't (yet) appear in `services` —
 * it still gets an entry in the result — so a partially-seeded or
 * hand-edited topology doesn't throw, just shows the gap.
 */
export function computeDependents(services: DependencyGraphInput[]): Record<string, string[]> {
  const dependents: Record<string, string[]> = {};

  for (const service of services) {
    if (!(service.name in dependents)) {
      dependents[service.name] = [];
    }
    for (const dependencyName of service.dependencies) {
      if (!(dependencyName in dependents)) {
        dependents[dependencyName] = [];
      }
      dependents[dependencyName].push(service.name);
    }
  }

  return dependents;
}

export interface ServiceTopologyView extends ServiceRecord {
  resolvedDependencies: ServiceRecord[];
  resolvedDependents: ServiceRecord[];
}

/**
 * The composed read Phase 6's "query endpoints return the modeled
 * topology" verification target is actually about: one service plus both
 * directions of its graph resolved to full records, not just names. This
 * is the kind of cross-repository composition docs/architecture.md §4
 * reserves for src/services/ rather than putting it in a controller or a
 * single repository.
 */
export async function getServiceTopology(name: string): Promise<ServiceTopologyView | null> {
  const service = await serviceRepository.findByName(name);
  if (!service) return null;

  const [resolvedDependencies, resolvedDependents] = await Promise.all([
    serviceRepository.findByNames(service.dependencies),
    serviceRepository.findByNames(service.dependents),
  ]);

  return { ...service, resolvedDependencies, resolvedDependents };
}

export async function listServices(): Promise<ServiceRecord[]> {
  return serviceRepository.findAll();
}
