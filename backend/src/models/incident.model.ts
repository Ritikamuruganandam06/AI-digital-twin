import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';


const incidentSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, minlength: 1, maxlength: 200 },
    description: { type: String, required: true, trim: true, minlength: 1, maxlength: 2000 },
    serviceId: { type: Schema.Types.ObjectId, ref: 'Service', required: true },
    serviceName: { type: String, required: true, trim: true, lowercase: true },
    affectedServiceNames: { type: [String], default: [] },
    severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], required: true },
    status: { type: String, enum: ['open', 'investigating', 'resolved'], required: true, default: 'open' },
    source: { type: String, enum: ['manual', 'agent'], required: true, default: 'manual' },
    resolvedAt: { type: Date },
  },
  { timestamps: true }
);


incidentSchema.index({ status: 1, createdAt: -1 });
incidentSchema.index({ serviceId: 1, createdAt: -1 });

export type IncidentAttrs = InferSchemaType<typeof incidentSchema>;
export type IncidentDocument = HydratedDocument<IncidentAttrs>;

export const Incident = model<IncidentAttrs>('Incident', incidentSchema, 'incidents');
