import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * docs/architecture.md §16 ("Agent execution trace (concept)"): persisted
 * per invocation of POST /api/assistant/ask (see
 * src/services/assistant.service.ts). `userId` stays optional and unused
 * until Phase 15 adds real authentication -- the same "add the field now,
 * populate it for real later" pattern incident.model.ts's `source` field
 * used ahead of Phase 11/15, so this schema doesn't need a migration once
 * JWT auth exists.
 *
 * `steps` mirrors ai-service's own ToolCallStep shape (Phase 10/13/14)
 * field-for-field rather than inventing a second representation of the
 * same data: one tool call is one step, whether it hit the backend or (as
 * of Phase 13) the RAG retriever, and `isRagQuery` is how a reader tells
 * them apart. `timestamp` is copied from the AI service's own per-step
 * capture time (Phase 14 added it there specifically so this schema
 * wouldn't have to invent one). `retrievedDocuments` is a denormalized
 * summary extracted from any RAG steps at write time (see
 * assistant.service.ts's extractRetrievedDocuments()) so a caller doesn't
 * have to filter+flatten `steps` just to answer "what did this answer
 * cite" -- matches §16's own field list literally.
 */
const agentExecutionStepSchema = new Schema(
  {
    toolName: { type: String, required: true, trim: true },
    arguments: { type: Schema.Types.Mixed, default: {} },
    result: { type: Schema.Types.Mixed, default: {} },
    isRagQuery: { type: Boolean, required: true, default: false },
    timestamp: { type: Date, required: true },
  },
  { _id: false }
);

const retrievedDocumentSchema = new Schema(
  {
    documentId: { type: String, required: true },
    title: { type: String, required: true },
    relatedService: { type: String, required: true },
    score: { type: Number, required: true },
  },
  { _id: false }
);

const agentExecutionSchema = new Schema(
  {
    // Phase 15 populates this from a real JWT once auth exists; every
    // execution created before then is anonymous, not "owned" by a guess.
    userId: { type: String, required: false },
    question: { type: String, required: true, trim: true, minlength: 1, maxlength: 2000 },
    finalResponse: { type: String, required: true },
    // Derived once, at write time, from the AI service's own
    // `stopped_reason` (see assistant.service.ts's mapStatus()) --
    // 'completed' (a real final answer), 'incomplete' (hit
    // AGENT_MAX_ITERATIONS without one), or 'error' (couldn't reach/use
    // Groq). `stoppedReason` keeps the AI service's raw value alongside
    // it so this mapping is never the only place that information lives.
    status: { type: String, enum: ['completed', 'incomplete', 'error'], required: true },
    stoppedReason: { type: String, required: true },
    iterations: { type: Number, required: true },
    steps: { type: [agentExecutionStepSchema], default: [] },
    retrievedDocuments: { type: [retrievedDocumentSchema], default: [] },
  },
  { timestamps: true }
);

// Two real access patterns this phase ships: "recent executions overall"
// and, once Phase 15 populates userId, "one user's execution history" --
// same shape docs/architecture.md §5 names for this exact index.
agentExecutionSchema.index({ createdAt: -1 });
agentExecutionSchema.index({ userId: 1, createdAt: -1 });

export type AgentExecutionAttrs = InferSchemaType<typeof agentExecutionSchema>;
export type AgentExecutionDocument = HydratedDocument<AgentExecutionAttrs>;

export const AgentExecution = model<AgentExecutionAttrs>('AgentExecution', agentExecutionSchema, 'agentexecutions');
