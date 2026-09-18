import { Event, type EventDocument } from '../models/event.model';

export type EventType = 'status_change' | 'deployment' | 'scaling' | 'generic';
export type EventHealthStatus = 'healthy' | 'degraded' | 'down';

export interface EventRecord {
  id: string;
  serviceId: string;
  serviceName: string;
  type: EventType;
  message: string;
  previousStatus?: EventHealthStatus;
  newStatus?: EventHealthStatus;
  occurredAt: Date;
}

export interface CreateEventInput {
  serviceId: string;
  serviceName: string;
  type: EventType;
  message: string;
  previousStatus?: EventHealthStatus;
  newStatus?: EventHealthStatus;
  occurredAt?: Date;
}

function toRecord(doc: EventDocument): EventRecord {
  return {
    id: doc._id.toString(),
    serviceId: doc.serviceId.toString(),
    serviceName: doc.serviceName,
    type: doc.type as EventType,
    message: doc.message,
    previousStatus: doc.previousStatus as EventHealthStatus | undefined,
    newStatus: doc.newStatus as EventHealthStatus | undefined,
    occurredAt: doc.occurredAt,
  };
}

export const eventRepository = {
  async insertMany(inputs: CreateEventInput[]): Promise<void> {
    if (inputs.length === 0) return;
    await Event.insertMany(inputs);
  },

  async findRecent(limit: number, serviceId?: string): Promise<EventRecord[]> {
    const filter = serviceId ? { serviceId } : {};
    const docs = await Event.find(filter).sort({ occurredAt: -1 }).limit(limit).exec();
    return docs.map(toRecord);
  },

  async deleteAll(): Promise<void> {
    await Event.deleteMany({});
  },
};
