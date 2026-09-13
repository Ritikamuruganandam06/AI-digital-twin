import { Incident, type IncidentDocument } from '../models/incident.model';

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'open' | 'investigating' | 'resolved';
export type IncidentSource = 'manual' | 'agent';

export interface IncidentRecord {
  id: string;
  title: string;
  description: string;
  serviceId: string;
  serviceName: string;
  affectedServiceNames: string[];
  severity: IncidentSeverity;
  status: IncidentStatus;
  source: IncidentSource;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateIncidentInput {
  title: string;
  description: string;
  serviceId: string;
  serviceName: string;
  affectedServiceNames: string[];
  severity: IncidentSeverity;
  status?: IncidentStatus;
  source?: IncidentSource;
}

function toRecord(doc: IncidentDocument): IncidentRecord {
  return {
    id: doc._id.toString(),
    title: doc.title,
    description: doc.description,
    serviceId: doc.serviceId.toString(),
    serviceName: doc.serviceName,
    affectedServiceNames: doc.affectedServiceNames,
    severity: doc.severity as IncidentSeverity,
    status: doc.status as IncidentStatus,
    source: doc.source as IncidentSource,
    resolvedAt: doc.resolvedAt ?? undefined,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export const incidentRepository = {
  async create(input: CreateIncidentInput): Promise<IncidentRecord> {
    const doc = await Incident.create(input);
    return toRecord(doc);
  },

  async findAll(status: IncidentStatus | undefined, limit: number): Promise<IncidentRecord[]> {
    const filter = status ? { status } : {};
    const docs = await Incident.find(filter).sort({ createdAt: -1 }).limit(limit).exec();
    return docs.map(toRecord);
  },

  async findById(id: string): Promise<IncidentRecord | null> {
    const doc = await Incident.findById(id).exec();
    return doc ? toRecord(doc) : null;
  },

  /** Test/seed-only: wipes the collection so a re-seed starts clean. */
  async deleteAll(): Promise<void> {
    await Incident.deleteMany({});
  },
};
