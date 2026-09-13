import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * The digital twin's topology node (docs/architecture.md §5: "topology
 * nodes: id, name, type, dependencies, dependents, current health
 * snapshot"). This is the first Phase 6 model, and the first model in this
 * codebase that isn't a "diagnostic" throwaway (compare
 * models/diagnosticPing.model.ts) — real application data starts here.
 */
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
    // `dependencies` is the single source of truth an operator or the seed
    // script edits. `dependents` is always the derived reverse of every
    // other service's `dependencies` (src/services/topology.service.ts's
    // computeDependents()) and re-persisted, never hand-maintained — so the
    // two directions of the graph cannot drift out of sync with each other.
    dependencies: { type: [String], default: [] },
    dependents: { type: [String], default: [] },
    health: { type: healthSnapshotSchema, required: true },
  },
  { timestamps: true }
);

// Every query this phase ships looks a service up by name (topology reads,
// dependency/dependent resolution, metric/event/incident association).
serviceSchema.index({ name: 1 }, { unique: true });

export type ServiceAttrs = InferSchemaType<typeof serviceSchema>;
export type ServiceDocument = HydratedDocument<ServiceAttrs>;

export const Service = model<ServiceAttrs>('Service', serviceSchema, 'services');
