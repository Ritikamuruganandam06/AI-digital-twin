import { AgentExecution, type AgentExecutionDocument } from '../models/agentExecution.model';

export type ExecutionStatus = 'completed' | 'incomplete' | 'error';

export interface AgentExecutionStepRecord {
  toolName: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown>;
  isRagQuery: boolean;
  timestamp: Date;
}

export interface RetrievedDocumentRecord {
  documentId: string;
  title: string;
  relatedService: string;
  score: number;
}

export interface AgentExecutionRecord {
  id: string;
  userId?: string;
  question: string;
  finalResponse: string;
  status: ExecutionStatus;
  stoppedReason: string;
  iterations: number;
  steps: AgentExecutionStepRecord[];
  retrievedDocuments: RetrievedDocumentRecord[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAgentExecutionInput {
  userId?: string;
  question: string;
  finalResponse: string;
  status: ExecutionStatus;
  stoppedReason: string;
  iterations: number;
  steps: AgentExecutionStepRecord[];
  retrievedDocuments: RetrievedDocumentRecord[];
}

function toRecord(doc: AgentExecutionDocument): AgentExecutionRecord {
  return {
    id: doc._id.toString(),
    userId: doc.userId ?? undefined,
    question: doc.question,
    finalResponse: doc.finalResponse,
    status: doc.status as ExecutionStatus,
    stoppedReason: doc.stoppedReason,
    iterations: doc.iterations,
    steps: doc.steps.map((s) => ({
      toolName: s.toolName,
      arguments: (s.arguments ?? {}) as Record<string, unknown>,
      result: (s.result ?? {}) as Record<string, unknown>,
      isRagQuery: s.isRagQuery,
      timestamp: s.timestamp,
    })),
    retrievedDocuments: doc.retrievedDocuments.map((d) => ({
      documentId: d.documentId,
      title: d.title,
      relatedService: d.relatedService,
      score: d.score,
    })),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}


export const agentExecutionRepository = {
  async create(input: CreateAgentExecutionInput): Promise<AgentExecutionRecord> {
    const doc = await AgentExecution.create(input);
    return toRecord(doc);
  },

  async findById(id: string): Promise<AgentExecutionRecord | null> {
    const doc = await AgentExecution.findById(id).exec();
    return doc ? toRecord(doc) : null;
  },

  async findAll(limit: number): Promise<AgentExecutionRecord[]> {
    const docs = await AgentExecution.find().sort({ createdAt: -1 }).limit(limit).exec();
    return docs.map(toRecord);
  },

  /** Test/seed-only: wipes the collection so a test run starts clean. */
  async deleteAll(): Promise<void> {
    await AgentExecution.deleteMany({});
  },
};
