import { ServiceMetric, type ServiceMetricDocument } from '../models/serviceMetric.model';

export interface ServiceMetricRecord {
  id: string;
  serviceId: string;
  serviceName: string;
  timestamp: Date;
  latencyMsP50: number;
  latencyMsP99: number;
  errorRatePercent: number;
  trafficRps: number;
  capacityPercent: number;
}

export interface CreateServiceMetricInput {
  serviceId: string;
  serviceName: string;
  timestamp: Date;
  latencyMsP50: number;
  latencyMsP99: number;
  errorRatePercent: number;
  trafficRps: number;
  capacityPercent: number;
}

function toRecord(doc: ServiceMetricDocument): ServiceMetricRecord {
  return {
    id: doc._id.toString(),
    serviceId: doc.serviceId.toString(),
    serviceName: doc.serviceName,
    timestamp: doc.timestamp,
    latencyMsP50: doc.latencyMsP50,
    latencyMsP99: doc.latencyMsP99,
    errorRatePercent: doc.errorRatePercent,
    trafficRps: doc.trafficRps,
    capacityPercent: doc.capacityPercent,
  };
}

export const serviceMetricRepository = {
  async insertMany(inputs: CreateServiceMetricInput[]): Promise<void> {
    if (inputs.length === 0) return;
    await ServiceMetric.insertMany(inputs);
  },

  async findRecentByServiceId(serviceId: string, limit: number): Promise<ServiceMetricRecord[]> {
    const docs = await ServiceMetric.find({ serviceId }).sort({ timestamp: -1 }).limit(limit).exec();
    return docs.map(toRecord);
  },

  async deleteAll(): Promise<void> {
    await ServiceMetric.deleteMany({});
  },
};
