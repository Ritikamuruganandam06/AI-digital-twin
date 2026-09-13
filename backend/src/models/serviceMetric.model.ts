import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * Time-series-ish metrics samples (docs/architecture.md §5: "latency, error
 * rate, traffic, capacity"). `serviceName` is denormalized alongside the
 * `serviceId` reference purely so list/debug queries don't need a $lookup
 * just to know which service a sample belongs to — `serviceId` remains the
 * real relationship every query actually filters/sorts by.
 */
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

// docs/architecture.md §5: "servicemetrics.{serviceId, timestamp} compound"
// — this is the index every query in this phase actually uses (fetch a
// service's most recent N samples, newest first).
serviceMetricSchema.index({ serviceId: 1, timestamp: -1 });

export type ServiceMetricAttrs = InferSchemaType<typeof serviceMetricSchema>;
export type ServiceMetricDocument = HydratedDocument<ServiceMetricAttrs>;

export const ServiceMetric = model<ServiceMetricAttrs>('ServiceMetric', serviceMetricSchema, 'servicemetrics');
