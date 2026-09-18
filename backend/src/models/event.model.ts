import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

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

eventSchema.index({ occurredAt: -1 });
eventSchema.index({ serviceId: 1, occurredAt: -1 });

export type EventAttrs = InferSchemaType<typeof eventSchema>;
export type EventDocument = HydratedDocument<EventAttrs>;

export const Event = model<EventAttrs>('Event', eventSchema, 'events');
