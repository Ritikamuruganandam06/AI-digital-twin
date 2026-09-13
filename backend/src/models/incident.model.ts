import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * docs/architecture.md §5: "incidents — created incidents (including
 * agent-initiated ones, pending approval)". `source` is here now so Phase
 * 11 (the privileged create_incident tool) and Phase 15 (auth/RBAC/approval)
 * extend this schema instead of migrating it later, but this phase can only
 * ever write `source: 'manual'` — there is no agent and no approval
 * workflow yet, and POST /api/incidents is unauthenticated (Phase 15 adds
 * that).
 */
const incidentSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, minlength: 1, maxlength: 200 },
    description: { type: String, required: true, trim: true, minlength: 1, maxlength: 2000 },
    serviceId: { type: Schema.Types.ObjectId, ref: 'Service', required: true },
    serviceName: { type: String, required: true, trim: true, lowercase: true },
    // Other services this incident is known to have cascaded to. Populated
    // by whoever files the incident (a human today; the agent's
    // recommend-only tool once Phase 11 lands) — not computed automatically
    // from the topology graph, since a real incident's actual blast radius
    // can differ from the graph's theoretical one.
    affectedServiceNames: { type: [String], default: [] },
    severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], required: true },
    status: { type: String, enum: ['open', 'investigating', 'resolved'], required: true, default: 'open' },
    source: { type: String, enum: ['manual', 'agent'], required: true, default: 'manual' },
    resolvedAt: { type: Date },
  },
  { timestamps: true }
);

// Real access patterns this phase ships: "open incidents first" (status
// filter) and "history for one service".
incidentSchema.index({ status: 1, createdAt: -1 });
incidentSchema.index({ serviceId: 1, createdAt: -1 });

export type IncidentAttrs = InferSchemaType<typeof incidentSchema>;
export type IncidentDocument = HydratedDocument<IncidentAttrs>;

export const Incident = model<IncidentAttrs>('Incident', incidentSchema, 'incidents');
