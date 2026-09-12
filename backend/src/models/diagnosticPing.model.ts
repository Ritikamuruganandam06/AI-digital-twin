import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * This is a deliberately generic model that exists only to prove the
 * Mongoose connection performs real CRUD end to end. It is NOT part of the
 * digital twin's domain model — that arrives in Phase 6 (services, topology,
 * metrics, incidents). Keeping this one small and clearly named
 * "diagnostic" avoids it being mistaken for real application data later.
 */
const diagnosticPingSchema = new Schema(
  {
    message: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 500,
    },
  },
  { timestamps: true }
);

// Every read this phase ships (findRecent) sorts by createdAt descending —
// index it now rather than waiting for it to show up slow in production.
diagnosticPingSchema.index({ createdAt: -1 });

export type DiagnosticPingAttrs = InferSchemaType<typeof diagnosticPingSchema>;
export type DiagnosticPingDocument = HydratedDocument<DiagnosticPingAttrs>;

export const DiagnosticPing = model<DiagnosticPingAttrs>(
  'DiagnosticPing',
  diagnosticPingSchema,
  'diagnostic_pings'
);
