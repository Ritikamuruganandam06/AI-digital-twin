import { aiServiceClient, AiServiceUnavailableError, type AgentInvokeResponse } from '../clients/aiServiceClient';
import {
  agentExecutionRepository,
  type AgentExecutionRecord,
  type AgentExecutionStepRecord,
  type ExecutionStatus,
  type RetrievedDocumentRecord,
} from '../repositories/agentExecution.repository';
import { AppError } from '../utils/AppError';



export interface AskAssistantInput {
  question: string;
  userId?: string;
}

export function mapStatus(stoppedReason: string): ExecutionStatus {
  switch (stoppedReason) {
    case 'final_answer':
      return 'completed';
    case 'iteration_limit':
      return 'incomplete';
    default:
      return 'error';
  }
}

export function extractRetrievedDocuments(response: AgentInvokeResponse): RetrievedDocumentRecord[] {
  const documents: RetrievedDocumentRecord[] = [];

  for (const step of response.steps) {
    if (!step.is_rag_query) continue;

    const rawResults = (step.result as { results?: unknown }).results;
    if (!Array.isArray(rawResults)) continue;

    for (const entry of rawResults) {
      if (typeof entry !== 'object' || entry === null) continue;
      const r = entry as Record<string, unknown>;
      documents.push({
        documentId: typeof r.documentId === 'string' ? r.documentId : '',
        title: typeof r.title === 'string' ? r.title : '',
        relatedService: typeof r.relatedService === 'string' ? r.relatedService : '',
        score: typeof r.score === 'number' ? r.score : Number(r.score ?? 0),
      });
    }
  }

  return documents;
}


export function toStepRecords(response: AgentInvokeResponse, receivedAt: Date): AgentExecutionStepRecord[] {
  return response.steps.map((step) => {
    const parsed = new Date(step.timestamp);
    return {
      toolName: step.tool_name,
      arguments: step.arguments,
      result: step.result,
      isRagQuery: step.is_rag_query,
      timestamp: Number.isNaN(parsed.getTime()) ? receivedAt : parsed,
    };
  });
}

export async function askAssistant(input: AskAssistantInput): Promise<AgentExecutionRecord> {
  const question = input.question.trim();
  if (!question) {
    throw new AppError('question must not be empty', 400);
  }

  let response: AgentInvokeResponse;
  try {
    response = await aiServiceClient.invokeAgent(question);
  } catch (err) {
    if (err instanceof AiServiceUnavailableError) {
      throw new AppError(`AI service is unavailable: ${err.message}`, 502);
    }
    throw err;
  }

  const receivedAt = new Date();

  return agentExecutionRepository.create({
    userId: input.userId,
    question,
    finalResponse: response.answer,
    status: mapStatus(response.stopped_reason),
    stoppedReason: response.stopped_reason,
    iterations: response.iterations,
    steps: toStepRecords(response, receivedAt),
    retrievedDocuments: extractRetrievedDocuments(response),
  });
}
