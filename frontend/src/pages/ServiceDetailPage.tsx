import { Link, useParams } from 'react-router-dom';
import { getService, getServiceMetrics } from '../api/services';
import { listEvents } from '../api/events';
import { useApiQuery } from '../api/useApiQuery';
import { AsyncBoundary } from '../components/AsyncBoundary';
import { HealthBadge } from '../components/StatusBadge';
import { EmptyState } from '../components/ui/States';
import { MetricCard } from '../components/ui/MetricCard';
import { BackLink, SectionHeader } from '../components/ui/PageHeader';
import type { ServiceRecord } from '../api/types';

function DependencyList({ title, services, emptyText }: { title: string; services: ServiceRecord[]; emptyText: string }) {
  return (
    <div className="card card--padded">
      <div className="section-header" style={{ margin: 0, marginBottom: 'var(--space-3)' }}>
        <h3 className="section-header__title" style={{ fontSize: 'var(--text-base)' }}>
          {title}
        </h3>
        <span className="section-header__meta">{services.length}</span>
      </div>
      {services.length === 0 ? (
        <p className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
          {emptyText}
        </p>
      ) : (
        <ul className="stack" style={{ gap: 'var(--space-2)' }}>
          {services.map((dep) => (
            <li key={dep.id} className="cluster" style={{ justifyContent: 'space-between' }}>
              <Link to={`/services/${dep.name}`} className="row-link">
                {dep.displayName}
              </Link>
              <HealthBadge status={dep.health.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ServiceDetailPage() {
  const { name = '' } = useParams<{ name: string }>();

  const serviceState = useApiQuery(() => getService(name), [name]);
  const metricsState = useApiQuery(() => getServiceMetrics(name, 10), [name]);
  const eventsState = useApiQuery(() => listEvents(name, 10), [name]);

  return (
    <div className="page">
      <BackLink to="/topology">Back to topology</BackLink>

      <AsyncBoundary state={serviceState} errorTitle="Unable to load this service">
        {(service) => (
          <>
            <div className="page-header">
              <div>
                <div className="cluster" style={{ gap: 'var(--space-3)' }}>
                  <h1 className="page-header__title">{service.displayName}</h1>
                  <HealthBadge status={service.health.status} />
                </div>
                <p className="page-header__subtitle">{service.description || 'No description.'}</p>
              </div>
            </div>

            <div className="card-grid" style={{ marginBottom: 'var(--space-8)' }}>
              <MetricCard label="P50 latency" value={`${service.health.latencyMsP50} ms`} size="sm" />
              <MetricCard label="P99 latency" value={`${service.health.latencyMsP99} ms`} size="sm" />
              <MetricCard
                label="Error rate"
                value={`${service.health.errorRatePercent}%`}
                tone={service.health.errorRatePercent > 0 ? 'warning' : 'default'}
                size="sm"
              />
              <MetricCard label="Traffic" value={`${service.health.trafficRps} rps`} size="sm" />
            </div>

            <div className="responsive-2col" style={{ marginBottom: 'var(--space-8)' }}>
              <DependencyList
                title="Depends on"
                services={service.resolvedDependencies}
                emptyText="Nothing — this is a root service."
              />
              <DependencyList
                title="Depended on by"
                services={service.resolvedDependents}
                emptyText="Nothing — no other service depends on this one."
              />
            </div>
          </>
        )}
      </AsyncBoundary>

      <SectionHeader title="Recent metrics" />
      <AsyncBoundary state={metricsState} errorTitle="Unable to load metrics">
        {(metrics) =>
          metrics.length === 0 ? (
            <EmptyState title="No metric samples yet" body="Metric history will appear here once the backend has recorded samples for this service." />
          ) : (
            <div className="table-wrap" style={{ marginBottom: 'var(--space-8)' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th className="num">P50</th>
                    <th className="num">P99</th>
                    <th className="num">Error rate</th>
                    <th className="num">Traffic</th>
                    <th className="num">Capacity</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((m) => (
                    <tr key={m.id}>
                      <td className="text-secondary">{new Date(m.timestamp).toLocaleString()}</td>
                      <td className="num">{m.latencyMsP50} ms</td>
                      <td className="num">{m.latencyMsP99} ms</td>
                      <td className="num">{m.errorRatePercent}%</td>
                      <td className="num">{m.trafficRps} rps</td>
                      <td className="num">{m.capacityPercent}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </AsyncBoundary>

      <SectionHeader title="Recent events" />
      <AsyncBoundary state={eventsState} errorTitle="Unable to load events">
        {(events) =>
          events.length === 0 ? (
            <EmptyState title="No recent events for this service" />
          ) : (
            <ul className="timeline card">
              {events.map((event) => (
                <li key={event.id} className="timeline-item">
                  <span className="timeline-item__marker badge--neutral" aria-hidden>
                    <span className="badge__dot" />
                  </span>
                  <div className="timeline-item__body">
                    <div className="timeline-item__title">{event.message}</div>
                    <div className="timeline-item__meta">{new Date(event.occurredAt).toLocaleString()}</div>
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      </AsyncBoundary>
    </div>
  );
}
