import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';


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


diagnosticPingSchema.index({ createdAt: -1 });

export type DiagnosticPingAttrs = InferSchemaType<typeof diagnosticPingSchema>;
export type DiagnosticPingDocument = HydratedDocument<DiagnosticPingAttrs>;

export const DiagnosticPing = model<DiagnosticPingAttrs>(
  'DiagnosticPing',
  diagnosticPingSchema,
  'diagnostic_pings'
);
