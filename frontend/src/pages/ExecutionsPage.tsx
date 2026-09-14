import { Link } from 'react-router-dom';
import { listExecutions } from '../api/executions';
import { useApiQuery } from '../api/useApiQuery';
import { AsyncBoundary } from '../components/AsyncBoundary';
import { ExecutionStatusBadge } from '../components/StatusBadge';
import { EmptyState } from '../components/ui/States';
import { PageHeader } from '../components/ui/PageHeader';

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function ExecutionsPage() {
  const executionsState = useApiQuery(() => listExecutions(50), []);

  return (
    <div className="page">
      <PageHeader
        title="Agent Execution Traces"
        subtitle="Every question asked of the AI assistant — including What-If Simulation, which asks on your behalf — is persisted here as a full execution record."
      />

      <AsyncBoundary state={executionsState} errorTitle="Unable to load executions">
        {(executions) =>
          executions.length === 0 ? (
            <EmptyState title="No agent executions yet" body="Ask the AI assistant a question, or run a what-if simulation, to see its execution trace here." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Question</th>
                    <th>Answer</th>
                    <th>Status</th>
                    <th className="num">Tool calls</th>
                    <th className="num">Iterations</th>
                    <th>Asked</th>
                  </tr>
                </thead>
                <tbody>
                  {executions.map((execution) => (
                    <tr key={execution.id}>
                      <td>
                        <Link to={`/executions/${execution.id}`} className="row-link">
                          {truncate(execution.question, 64)}
                        </Link>
                      </td>
                      <td className="text-secondary">{truncate(execution.finalResponse, 56)}</td>
                      <td>
                        <ExecutionStatusBadge status={execution.status} />
                      </td>
                      <td className="num">{execution.steps.length}</td>
                      <td className="num">{execution.iterations}</td>
                      <td className="text-secondary">{new Date(execution.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </AsyncBoundary>
    </div>
  );
}
