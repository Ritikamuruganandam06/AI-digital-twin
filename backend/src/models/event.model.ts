import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * Service lifecycle / operational events (docs/architecture.md §5:
 * "service lifecycle / operational events"). This is plain historical
 * record-keeping in Phase 6 — nothing produces these onto Kafka's
 * `service.events` topic yet, because the things architecture.md §7 names
 * as that topic's real producers (the simulation engine, a health monitor)
 * don't exist until Phase 7+. Wiring a Kafka producer here now would be
 * simulating a producer that doesn't have anything real to say yet.
 */
const eventSchema = new Schema(
  {
    serviceId: { type: Schema.Types.ObjectId, ref: 'Service', required: true },
    serviceName: { type: String, required: true, trim: true, lowercase: true },
    type: { type: String, enum: ['status_change', 'deployment', 'scaling', 'generic'], required: true },
    message: { type: String, required: true, trim: true, minlength: 1, maxlength: 500 },
    previousStatus: { type: String, enum: ['healthy', 'degraded', 'down'] },
    newStatus: { type: String, enum: ['healthy', 'degraded', 'down'] },
    occurredAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true }
);

// Two real access patterns this phase ships: "recent events across the
// whole system" and "recent events for one service".
eventSchema.index({ occurredAt: -1 });
eventSchema.index({ serviceId: 1, occurredAt: -1 });

export type EventAttrs = InferSchemaType<typeof eventSchema>;
export type EventDocument = HydratedDocument<EventAttrs>;

export const Event = model<EventAttrs>('Event', eventSchema, 'events');
