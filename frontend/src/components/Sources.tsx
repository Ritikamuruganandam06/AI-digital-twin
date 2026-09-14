import { useState } from 'react';
import { IconDocument } from './icons';
import type { RetrievedDocument } from '../api/types';

/**
 * The RAG documents an execution actually retrieved (`AgentExecutionRecord
 * .retrievedDocuments`, populated only when the agent called
 * `search_knowledge_base` -- see `app/agent/loop.py`'s SYSTEM_PROMPT),
 * shown as its own section separate from both the main answer and the
 * tool-activity trace (Phase 17 "RAG Response Structuring Fix" response
 * hierarchy: answer, then sources, then agent activity). Visually
 * secondary and collapsed by default -- this is provenance, not the
 * point of the answer.
 *
 * Renders only `documentId`/`title`/`relatedService`/`score`, the real
 * fields the backend returns. Nothing here is invented: when
 * `retrievedDocuments` is empty (no RAG happened for this question) the
 * component renders nothing at all, rather than a fake "no sources"
 * placeholder implying RAG was attempted.
 */
export function Sources({ documents, defaultExpanded = false }: { documents: RetrievedDocument[]; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (documents.length === 0) return null;

  return (
    <div className="card sources">
      <div className="sources__summary">
        <IconDocument size={15} className="text-tertiary" />
        <span className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
          {documents.length} knowledge chunk{documents.length === 1 ? '' : 's'} retrieved
        </span>
        {!defaultExpanded && (
          <button type="button" className="btn btn-ghost btn-sm sources__toggle" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Hide sources' : 'View sources'}
          </button>
        )}
      </div>

      {expanded && (
        <ol className="sources__list">
          {documents.map((doc, index) => (
            <li key={`${doc.documentId}-${index}`} className="sources__item">
              <IconDocument size={14} className="text-tertiary" />
              <div className="sources__item-body">
                <div className="sources__item-title">{doc.title}</div>
                <div className="sources__item-meta text-tertiary">
                  {doc.relatedService} · relevance {doc.score.toFixed(2)}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
