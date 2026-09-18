import { Service, type ServiceDocument } from '../models/service.model';
import type { HealthStatus } from '../data/seedTopology';

export interface ServiceHealthRecord {
  status: HealthStatus;
  latencyMsP50: number;
  latencyMsP99: number;
  errorRatePercent: number;
  trafficRps: number;
  updatedAt: Date;
}

export interface ServiceRecord {
  id: string;
  name: string;
  displayName: string;
  type: string;
  description: string;
  dependencies: string[];
  dependents: string[];
  health: ServiceHealthRecord;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertServiceInput {
  name: string;
  displayName: string;
  type: string;
  description: string;
  dependencies: string[];
  dependents: string[];
  health: ServiceHealthRecord;
}

function toRecord(doc: ServiceDocument): ServiceRecord {
  return {
    id: doc._id.toString(),
    name: doc.name,
    displayName: doc.displayName,
    type: doc.type,
    description: doc.description ?? '',
    dependencies: doc.dependencies,
    dependents: doc.dependents,
    health: {
      status: doc.health.status as HealthStatus,
      latencyMsP50: doc.health.latencyMsP50,
      latencyMsP99: doc.health.latencyMsP99,
      errorRatePercent: doc.health.errorRatePercent,
      trafficRps: doc.health.trafficRps,
      updatedAt: doc.health.updatedAt,
    },
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}


export const serviceRepository = {
  async upsertByName(input: UpsertServiceInput): Promise<ServiceRecord> {
    const doc = await Service.findOneAndUpdate(
      { name: input.name },
      { $set: input },
      { upsert: true, new: true, runValidators: true }
    ).exec();
    return toRecord(doc!);
  },

  async findAll(): Promise<ServiceRecord[]> {
    const docs = await Service.find().sort({ name: 1 }).exec();
    return docs.map(toRecord);
  },

  async findByName(name: string): Promise<ServiceRecord | null> {
    const doc = await Service.findOne({ name: name.toLowerCase().trim() }).exec();
    return doc ? toRecord(doc) : null;
  },

  async findByNames(names: string[]): Promise<ServiceRecord[]> {
    if (names.length === 0) return [];
    const docs = await Service.find({ name: { $in: names } }).exec();
    return docs.map(toRecord);
  },

  async deleteAll(): Promise<void> {
    await Service.deleteMany({});
  },
};
