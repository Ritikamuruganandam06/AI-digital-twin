import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

const healthSnapshotSchema = new Schema(
  {
    status: { type: String, enum: ['healthy', 'degraded', 'down'], required: true, default: 'healthy' },
    latencyMsP50: { type: Number, required: true, min: 0 },
    latencyMsP99: { type: Number, required: true, min: 0 },
    errorRatePercent: { type: Number, required: true, min: 0, max: 100 },
    trafficRps: { type: Number, required: true, min: 0 },
    updatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { _id: false }
);

const serviceSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, lowercase: true },
    displayName: { type: String, required: true, trim: true },
    type: { type: String, required: true, trim: true, default: 'microservice' },
    description: { type: String, trim: true, default: '' },
    dependencies: { type: [String], default: [] },
    dependents: { type: [String], default: [] },
    health: { type: healthSnapshotSchema, required: true },
  },
  { timestamps: true }
);


serviceSchema.index({ name: 1 }, { unique: true });

export type ServiceAttrs = InferSchemaType<typeof serviceSchema>;
export type ServiceDocument = HydratedDocument<ServiceAttrs>;

export const Service = model<ServiceAttrs>('Service', serviceSchema, 'services');
