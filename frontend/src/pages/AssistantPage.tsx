import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { askAssistant } from '../api/assistant';
import { ApiError } from '../api/client';
import { ExecutionTrace } from '../components/ExecutionTrace';
import { Markdown } from '../components/Markdown';
import { Sources } from '../components/Sources';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/States';
import { Button } from '../components/ui/Button';
import { IconAssistant } from '../components/icons';
import type { AgentExecutionRecord } from '../api/types';

interface Turn {
  question: string;
  execution?: AgentExecutionRecord;
  error?: string;
}

/**
 * A chat-style UI over `POST /api/assistant/ask` (docs/architecture.md
 * §3's sequence diagram: "FE-->>U: rendered answer + 'show reasoning'
 * trace"). Each question the user asks becomes one `Turn`, rendered in
 * the response hierarchy Phase 17's RAG-structuring fix settled on:
 * the question, then the agent's `finalResponse` (through `Markdown`,
 * so full Markdown -- tables, checklists, code fences, not just
 * `**bold**`/lists -- renders properly instead of showing raw syntax),
 * then `Sources` (the real `retrievedDocuments` this execution's
 * `search_knowledge_base` calls, if any -- renders nothing when there
 * are none, never a fake "no sources" line), then a collapsible
 * `ExecutionTrace` -- the same trace component `ExecutionDetailPage`
 * uses, so "View agent activity" here is the real, persisted
 * `AgentExecutionRecord`, not a re-summary -- and finally a link to
 * that execution's own detail page for the full picture.
 */
export function AssistantPage() {
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [lastQuestion, setLastQuestion] = useState('');

  async function submit(asked: string) {
    if (!asked || submitting) return;
    setSubmitting(true);
    setLastQuestion(asked);
    try {
      const execution = await askAssistant(asked);
      setTurns((prev) => [...prev, { question: asked, execution }]);
    } catch (err) {
      setTurns((prev) => [
        ...prev,
        { question: asked, error: err instanceof ApiError ? err.message : 'The AI service could not complete this request.' },
      ]);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const asked = question.trim();
    setQuestion('');
    await submit(asked);
  }

  return (
    <div className="page">
      <PageHeader
        title="AI Assistant"
        subtitle="Ask about the system's current state — health, incidents, dependencies. Every answer is grounded in real data the agent looked up through its tools."
      />

      <div className="assistant-thread">
        {turns.length === 0 ? (
          <EmptyState
            icon="search"
            title="No questions asked yet"
            body='Try asking something like "What is the current health of the checkout service?"'
          />
        ) : (
          turns.map((turn, index) => <AssistantTurn key={index} turn={turn} onRetry={() => submit(turn.question)} />)
        )}
      </div>

      <form onSubmit={handleSubmit} className="assistant-composer card">
        <IconAssistant size={18} className="text-tertiary" />
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. What is the current health of the checkout service?"
          className="assistant-composer__input"
          disabled={submitting}
          aria-label="Ask the AI assistant a question"
        />
        <Button type="submit" variant="primary" disabled={submitting || !question.trim()}>
          {submitting ? 'Asking…' : 'Ask'}
        </Button>
      </form>
      {submitting && <p className="text-tertiary assistant-composer__status">Asking about “{lastQuestion}”…</p>}
    </div>
  );
}

function AssistantTurn({ turn, onRetry }: { turn: Turn; onRetry: () => void }) {
  return (
    <div className="assistant-turn">
      <div className="assistant-turn__question">
        <span className="assistant-turn__question-label">You</span>
        {turn.question}
      </div>

      {turn.error && (
        <div role="alert" className="card card--padded assistant-turn__error">
          <div className="state-panel__title">AI assistant temporarily unavailable</div>
          <div className="state-panel__body" style={{ margin: '4px 0 0' }}>
            {turn.error}
          </div>
          <Button variant="secondary" size="sm" onClick={onRetry} style={{ marginTop: 'var(--space-3)' }}>
            Try again
          </Button>
        </div>
      )}

      {turn.execution && (
        <div className="stack" style={{ gap: 'var(--space-3)' }}>
          <div className="card card--padded assistant-turn__answer">
            <span className="assistant-turn__answer-label">
              <IconAssistant size={13} />
              Assistant
            </span>
            <Markdown text={turn.execution.finalResponse} />
          </div>
          <Sources documents={turn.execution.retrievedDocuments} />
          <ExecutionTrace execution={turn.execution} />
          <Link to={`/executions/${turn.execution.id}`} className="assistant-turn__trace-link">
            View full execution details
          </Link>
        </div>
      )}
    </div>
  );
}
