export interface ConsumedDiagnosticMessage {
  key: string | null;
  message: string;
  publishedAt: string;
  consumedAt: string;
  partition: number;
  offset: string;
}

/**
 * Deliberately in-memory, not persisted to MongoDB: this store exists only
 * to make "did the consumer actually receive what the producer sent"
 * observable over HTTP for Phase 5's verification, the same role
 * DiagnosticPing (Phase 3) plays for MongoDB. It resets on restart — that's
 * expected, not a bug.
 */
const MAX_ENTRIES = 50;
let messages: ConsumedDiagnosticMessage[] = [];

export function recordConsumedMessage(entry: ConsumedDiagnosticMessage): void {
  messages = [entry, ...messages].slice(0, MAX_ENTRIES);
}

export function getConsumedMessages(limit = 10): ConsumedDiagnosticMessage[] {
  return messages.slice(0, limit);
}

/** Test-only: lets each test suite start from a clean store. */
export function clearConsumedMessages(): void {
  messages = [];
}
