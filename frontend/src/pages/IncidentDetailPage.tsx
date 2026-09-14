import { Link, useParams } from 'react-router-dom';
import { getIncident } from '../api/incidents';
import { useApiQuery } from '../api/useApiQuery';
import { AsyncBoundary } from '../components/AsyncBoundary';
import { SeverityBadge, IncidentStatusBadge } from '../components/StatusBadge';
import { BackLink, SectionHeader } from '../components/ui/PageHeader';
import { MetricCard } from '../components/ui/MetricCard';

export function IncidentDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const incidentState = useApiQuery(() => getIncident(id), [id]);

  return (
    <div className="page">
      <BackLink to="/incidents">Back to incidents</BackLink>

      <AsyncBoundary state={incidentState} errorTitle="Unable to load this incident">
        {(incident) => (
          <>
            <div className="page-header">
              <div>
                <h1 className="page-header__title">{incident.title}</h1>
                <div className="cluster" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                  <SeverityBadge severity={incident.severity} />
                  <IncidentStatusBadge status={incident.status} />
                  <span className="text-tertiary text-mono" style={{ fontSize: 'var(--text-sm)' }}>
                    source: {incident.source}
                  </span>
                </div>
              </div>
            </div>

            <p className="text-secondary" style={{ maxWidth: 720, marginBottom: 'var(--space-6)' }}>
              {incident.description}
            </p>

            <div className="card-grid" style={{ marginBottom: 'var(--space-8)' }}>
              <MetricCard label="Primary service" value={<Link to={`/services/${incident.serviceName}`}>{incident.serviceName}</Link>} size="sm" />
              <MetricCard label="Created" value={new Date(incident.createdAt).toLocaleString()} size="sm" />
              <MetricCard label="Updated" value={new Date(incident.updatedAt).toLocaleString()} size="sm" />
              {incident.resolvedAt && <MetricCard label="Resolved" value={new Date(incident.resolvedAt).toLocaleString()} size="sm" tone="success" />}
            </div>

            {incident.affectedServiceNames.length > 0 && (
              <div>
                <SectionHeader title="Affected services" />
                <ul className="stack" style={{ gap: 'var(--space-2)' }}>
                  {incident.affectedServiceNames.map((name) => (
                    <li key={name} className="card" style={{ padding: 'var(--space-3) var(--space-4)' }}>
                      <Link to={`/services/${name}`} className="row-link">
                        {name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </AsyncBoundary>
    </div>
  );
}
