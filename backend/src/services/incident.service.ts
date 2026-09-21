import { serviceRepository } from '../repositories/service.repository';
import { incidentRepository, type IncidentRecord, type IncidentSeverity } from '../repositories/incident.repository';
import { AppError } from '../utils/AppError';

export interface CreateIncidentInput {
  title: string;
  description: string;
  serviceName: string;
  affectedServiceNames?: string[];
  severity: IncidentSeverity;
}


export async function createIncident(input: CreateIncidentInput): Promise<IncidentRecord> {
  const service = await serviceRepository.findByName(input.serviceName);
  if (!service) {
    throw new AppError(`Unknown service "${input.serviceName}"`, 400);
  }

  const affectedServiceNames = (input.affectedServiceNames ?? []).map((n) => n.toLowerCase().trim());
  if (affectedServiceNames.length > 0) {
    const resolved = await serviceRepository.findByNames(affectedServiceNames);
    const resolvedNames = new Set(resolved.map((s) => s.name));
    const unknown = affectedServiceNames.filter((n) => !resolvedNames.has(n));
    if (unknown.length > 0) {
      throw new AppError(`Unknown affected service(s): ${unknown.join(', ')}`, 400);
    }
  }

  return incidentRepository.create({
    title: input.title,
    description: input.description,
    serviceId: service.id,
    serviceName: service.name,
    affectedServiceNames,
    severity: input.severity,
    status: 'open',
    source: 'manual',
  });
}
