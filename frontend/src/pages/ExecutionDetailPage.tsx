import { useParams } from 'react-router-dom';
import { getExecution } from '../api/executions';
import { useApiQuery } from '../api/useApiQuery';
import { AsyncBoundary } from '../components/AsyncBoundary';
import { ExecutionTrace } from '../components/ExecutionTrace';
import { ExecutionStatusBadge } from '../components/StatusBadge';
import { Markdown } from '../components/Markdown';
import { Sources } from '../components/Sources';
import { BackLink, SectionHeader } from '../components/ui/PageHeader';

export function ExecutionDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const executionState = useApiQuery(() => getExecution(id), [id]);

  return (
    <div className="page">
      <BackLink to="/executions">Back to executions</BackLink>

      <AsyncBoundary state={executionState} errorTitle="Unable to load this execution">
        {(execution) => (
          <>
            <div className="page-header">
              <div>
                <h1 className="page-header__title">{execution.question}</h1>
                <div className="cluster" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                  <ExecutionStatusBadge status={execution.status} />
                  <span className="text-tertiary" style={{ fontSize: 'var(--text-sm)' }}>
                    {execution.iterations} iteration{execution.iterations === 1 ? '' : 's'} · {new Date(execution.createdAt).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            <div style={{ marginBottom: 'var(--space-6)' }}>
              <SectionHeader title="Final response" />
              <div className="card card--padded">
                <Markdown text={execution.finalResponse} />
              </div>
            </div>

            <div style={{ marginBottom: 'var(--space-6)' }}>
              <Sources documents={execution.retrievedDocuments} defaultExpanded />
            </div>

            <ExecutionTrace execution={execution} defaultExpanded />
          </>
        )}
      </AsyncBoundary>
    </div>
  );
}
