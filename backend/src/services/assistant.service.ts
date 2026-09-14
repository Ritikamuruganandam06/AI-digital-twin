import { aiServiceClient, AiServiceUnavailableError, type AgentInvokeResponse } from '../clients/aiServiceClient';
import {
  agentExecutionRepository,
  type AgentExecutionRecord,
  type AgentExecutionStepRecord,
  type ExecutionStatus,
  type RetrievedDocumentRecord,
} from '../repositories/agentExecution.repository';
import { AppError } from '../utils/AppError';

/**
 * docs/architecture.md §3's sequence diagram, the middle arrow: FE -> BE
 * (POST /api/assistant/ask) -> AI (POST /agent/invoke) -> ... -> AI
 * returns answer + trace -> BE persists it -> BE returns to FE. This
 * function is "BE persists it": it calls the AI service for real, then
 * turns its response into exactly the record shape
 * agentExecution.model.ts defines, and writes it -- one execution record
 * per call, whether the agent finished cleanly, hit the iteration limit,
 * or couldn't reach Groq at all (all three are real, meaningful outcomes
 * worth a trace; only a totally unreachable AI service, below, produces
 * no trace at all, since nothing resembling an execution happened).
 */

export interface AskAssistantInput {
  question: string;
  userId?: string;
}

/**
 * Maps ai-service's raw `stopped_reason` (app/agent/loop.py) onto this
 * schema's `status` enum. Exhaustive over the three values that codebase
 * can currently produce ('final_answer', 'iteration_limit', 'groq_error'),
 * and defensively falls back to 'error' for anything else instead of
 * throwing -- an unrecognized stopped_reason (e.g. a future ai-service
 * change) should be recorded honestly as "something went wrong", never
 * misreported as 'completed'.
 */
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

/**
 * Flattens every RAG step's `result.results` (app/tools/executor.py's
 * _search_knowledge_base() shape) into the denormalized
 * `retrievedDocuments` list docs/architecture.md §16 asks for, so a
 * caller doesn't have to filter+parse `steps` just to see what grounded
 * this answer. Tolerant of a malformed/missing `results` shape (treats it
 * as "no documents from this step") rather than throwing -- a shape
 * mismatch in one step must never stop the whole execution from being
 * persisted.
 */
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

/**
 * Maps ai-service's steps onto this schema's step shape 1:1 -- camelCase
 * field names and a parsed Date instead of an ISO string are the only
 * differences, deliberately not a re-interpretation of the data.
 * `timestamp` falls back to `receivedAt` only if a step's timestamp is
 * missing or unparseable (e.g. an older ai-service build without Phase
 * 14's ToolCallStep.timestamp field) -- forward/backward tolerance, not
 * the expected path.
 */
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
      // Nothing resembling an execution happened -- the request never
      // reached ai-service's run_agent() at all -- so nothing is
      // persisted here, unlike the groq_error case below (which DID run
      // the agent loop, just failed inside it, and is a real trace).
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
