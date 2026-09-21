import { serviceRepository, type ServiceRecord } from '../repositories/service.repository';

export interface DependencyGraphInput {
  name: string;
  dependencies: string[];
}

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
