import { useState } from 'react';
import { ExecutionStatusBadge } from './StatusBadge';
import { IconAlertTriangle, IconCheck } from './icons';
import type { AgentExecutionRecord, AgentExecutionStep } from '../api/types';

/**
 * Renders the full trace of one agent execution: the manually-built ReAct
 * loop's tool calls (docs/architecture.md §16 -- "The frontend's 'Agent
 * Execution Trace' view (Phase 17) renders this as a timeline"). Shared by
 * AssistantPage (as a collapsible "View agent activity" section under a
 * fresh answer), SimulationPage (same collapsible, so a what-if answer's
 * underlying simulate_service_failure/etc. tool call and result are
 * visible, not just prose) and ExecutionDetailPage (always expanded, as
 * the page's own subject) -- one rendering of "what the agent actually
 * did" instead of three drifting copies.
 *
 * This deliberately shows tool ACTIVITY only -- the tool called, the
 * arguments passed, and the real structured result -- never the model's
 * hidden chain-of-thought (which this app never receives from the backend
 * in the first place; `AgentExecutionStep` has no such field). Labeled
 * "View agent activity" rather than "Show reasoning" for exactly that
 * reason: it's an audit log of actions, not an exposed thought process.
 *
 * The RAG documents an execution retrieved used to be a second sub-section
 * inside this same collapsible ("Retrieved documents"). Phase 17's RAG
 * response-structuring fix pulled that out into its own top-level
 * `<Sources>` component instead, rendered by each page between the answer
 * and this trace -- so provenance ("what the answer is grounded in") and
 * activity ("what the agent did to get there") read as two distinct
 * things instead of one collapsible mixing both.
 */
export function ExecutionTrace({
  execution,
  defaultExpanded = false,
}: {
  execution: AgentExecutionRecord;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="card execution-trace">
      <div className="execution-trace__summary">
        <ExecutionStatusBadge status={execution.status} />
        <span className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
          {execution.iterations} iteration{execution.iterations === 1 ? '' : 's'} · stopped: {execution.stoppedReason}
        </span>
        {!defaultExpanded && (
          <button type="button" className="btn btn-ghost btn-sm execution-trace__toggle" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Hide agent activity' : 'View agent activity'}
          </button>
        )}
      </div>

      {expanded && (
        <div className="execution-trace__body">
          <div className="section-header" style={{ margin: 0, marginBottom: 'var(--space-2)' }}>
            <h4 className="section-header__title" style={{ fontSize: 'var(--text-sm)', textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--color-text-tertiary)' }}>
              Agent activity
            </h4>
          </div>
          {execution.steps.length === 0 ? (
            <p className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>The agent answered without calling any tools.</p>
          ) : (
            <ol className="activity-list">
              {execution.steps.map((step, index) => (
                <ActivityItem key={`${step.toolName}-${index}`} step={step} />
              ))}
              {execution.status === 'completed' && (
                <li className="activity-item">
                  <span className="activity-item__icon activity-item__icon--success">
                    <IconCheck size={13} />
                  </span>
                  <div className="activity-item__body">
                    <div className="activity-item__title">final answer</div>
                  </div>
                </li>
              )}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function summarizeArgs(args: Record<string, unknown>): string | null {
  if (typeof args.serviceName === 'string') return args.serviceName;
  if (typeof args.query === 'string') return args.query;
  const values = Object.values(args);
  if (values.length === 1 && (typeof values[0] === 'string' || typeof values[0] === 'number')) {
    return String(values[0]);
  }
  return null;
}

/** A one-line, honest summary of a tool's real result -- never a fabricated description. Falls back to a couple of real field values, or "completed" if the result carries nothing summarizable. */
function summarizeResult(result: Record<string, unknown>): string {
  if (typeof result.error === 'string') return result.error;
  if (typeof result.resultCount === 'number') {
    return `${result.resultCount} document${result.resultCount === 1 ? '' : 's'} retrieved`;
  }
  if (Array.isArray((result as { results?: unknown }).results)) {
    const arr = (result as { results: unknown[] }).results;
    return `${arr.length} result${arr.length === 1 ? '' : 's'}`;
  }
  if (typeof result.summary === 'string') return result.summary;
  if (typeof result.status === 'string') return `status: ${result.status}`;

  const primitiveEntries = Object.entries(result).filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean');
  if (primitiveEntries.length > 0) {
    return primitiveEntries
      .slice(0, 2)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' · ');
  }
  return Object.keys(result).length > 0 ? `${Object.keys(result).length} field(s) returned` : 'completed';
}

function ActivityItem({ step }: { step: AgentExecutionStep }) {
  const failed = typeof step.result?.error === 'string';
  const argSummary = summarizeArgs(step.arguments);

  return (
    <li className="activity-item">
      <span className={`activity-item__icon ${failed ? 'activity-item__icon--danger' : 'activity-item__icon--success'}`}>
        {failed ? <IconAlertTriangle size={13} /> : <IconCheck size={13} />}
      </span>
      <div className="activity-item__body">
        <div className="activity-item__title">
          <span className="text-mono">{step.toolName}</span>
          {step.isRagQuery && <span className="badge badge--info activity-item__badge">retrieval</span>}
        </div>
        {argSummary && <div className="activity-item__arg">{argSummary}</div>}
        <div className="activity-item__result">{summarizeResult(step.result)}</div>
        <div className="activity-item__meta">{new Date(step.timestamp).toLocaleTimeString()}</div>
        <details className="activity-item__raw">
          <summary>Raw tool call</summary>
          <pre className="code-block">{JSON.stringify({ arguments: step.arguments, result: step.result }, null, 2)}</pre>
        </details>
      </div>
    </li>
  );
}
