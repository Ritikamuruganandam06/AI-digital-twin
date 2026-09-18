import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';


const serviceMetricSchema = new Schema(
  {
    serviceId: { type: Schema.Types.ObjectId, ref: 'Service', required: true },
    serviceName: { type: String, required: true, trim: true, lowercase: true },
    timestamp: { type: Date, required: true, default: () => new Date() },
    latencyMsP50: { type: Number, required: true, min: 0 },
    latencyMsP99: { type: Number, required: true, min: 0 },
    errorRatePercent: { type: Number, required: true, min: 0, max: 100 },
    trafficRps: { type: Number, required: true, min: 0 },
    capacityPercent: { type: Number, required: true, min: 0, max: 100 },
  },
  { timestamps: false }
);

serviceMetricSchema.index({ serviceId: 1, timestamp: -1 });

export type ServiceMetricAttrs = InferSchemaType<typeof serviceMetricSchema>;
export type ServiceMetricDocument = HydratedDocument<ServiceMetricAttrs>;

export const ServiceMetric = model<ServiceMetricAttrs>('ServiceMetric', serviceMetricSchema, 'servicemetrics');
