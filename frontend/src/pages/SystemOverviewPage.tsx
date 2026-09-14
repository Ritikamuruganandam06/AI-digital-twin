import { Link } from 'react-router-dom';
import { listServices } from '../api/services';
import { listEvents } from '../api/events';
import { useApiQuery } from '../api/useApiQuery';
import { AsyncBoundary } from '../components/AsyncBoundary';
import { HealthBadge } from '../components/StatusBadge';
import { EmptyState } from '../components/ui/States';
import { MetricCard } from '../components/ui/MetricCard';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { IconClock, IconRefresh } from '../components/icons';
import type { EventRecord, EventType, HealthStatus, ServiceRecord } from '../api/types';

function summarizeHealth(services: ServiceRecord[]): Record<HealthStatus, number> {
  const counts: Record<HealthStatus, number> = { healthy: 0, degraded: 0, down: 0 };
  for (const service of services) {
    counts[service.health.status] += 1;
  }
  return counts;
}

/**
 * A single real, derived rollup of the services list already on screen --
 * never a separate "monitoring" concept and never invented. "Operational",
 * "degraded", "outage" are this page's own words for "0 down", "some
 * down/degraded but not all", "every service down" respectively.
 */
function systemStatus(counts: Record<HealthStatus, number>, total: number): { tone: 'success' | 'warning' | 'danger'; label: string } {
  if (total === 0) return { tone: 'success', label: 'No services yet' };
  if (counts.down === total) return { tone: 'danger', label: 'Outage' };
  if (counts.down > 0) return { tone: 'danger', label: 'Partial outage' };
  if (counts.degraded > 0) return { tone: 'warning', label: 'Operational with degradation' };
  return { tone: 'success', label: 'Operational' };
}

const EVENT_TYPE_LABEL: Record<EventType, string> = {
  status_change: 'Status change',
  deployment: 'Deployment',
  scaling: 'Scaling',
  generic: 'Event',
};

export function SystemOverviewPage() {
  const servicesState = useApiQuery(() => listServices(), []);
  const eventsState = useApiQuery(() => listEvents(undefined, 10), []);

  function refreshAll() {
    servicesState.refetch();
    eventsState.refetch();
  }

  return (
    <div className="page">
      <PageHeader
        title="System Overview"
        subtitle="Real-time health of every modeled service."
        actions={
          <Button variant="secondary" size="sm" onClick={refreshAll}>
            <IconRefresh size={14} />
            Refresh
          </Button>
        }
      />

      <AsyncBoundary state={servicesState} errorTitle="Unable to load services">
        {(services) => {
          const counts = summarizeHealth(services);
          const status = systemStatus(counts, services.length);
          return (
            <>
              <div className="card status-banner" style={{ marginBottom: 'var(--space-6)' }}>
                <div className="cluster" style={{ gap: 'var(--space-3)' }}>
                  <span className={`status-banner__dot status-banner__dot--${status.tone}`} aria-hidden />
                  <div>
                    <div className="status-banner__label">System status</div>
                    <div className="status-banner__value">{status.label}</div>
                  </div>
                </div>
                {servicesState.lastUpdated && (
                  <div className="status-banner__updated text-tertiary">
                    <IconClock />
                    Last updated {new Date(servicesState.lastUpdated).toLocaleTimeString()}
                  </div>
                )}
              </div>

              <div className="card-grid" style={{ marginBottom: 'var(--space-8)' }}>
                <MetricCard label="Total services" value={services.length} />
                <MetricCard label="Healthy" value={counts.healthy} tone="success" />
                <MetricCard label="Degraded" value={counts.degraded} tone={counts.degraded > 0 ? 'warning' : 'default'} />
                <MetricCard label="Down" value={counts.down} tone={counts.down > 0 ? 'danger' : 'default'} />
              </div>

              <div className="section-header">
                <h2 className="section-header__title">Services</h2>
                <span className="section-header__meta">{services.length} total</span>
              </div>
              {services.length === 0 ? (
                <EmptyState title="No services yet" body="Services will appear here once the backend's topology is seeded." />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Service</th>
                        <th>Status</th>
                        <th className="num">P50 latency</th>
                        <th className="num">P99 latency</th>
                        <th className="num">Error rate</th>
                        <th className="num">Traffic</th>
                      </tr>
                    </thead>
                    <tbody>
                      {services.map((service) => (
                        <tr key={service.id}>
                          <td>
                            <Link to={`/services/${service.name}`} className="row-link">
                              {service.displayName}
                            </Link>
                          </td>
                          <td>
                            <HealthBadge status={service.health.status} />
                          </td>
                          <td className="num">{service.health.latencyMsP50} ms</td>
                          <td className="num">{service.health.latencyMsP99} ms</td>
                          <td className="num">{service.health.errorRatePercent}%</td>
                          <td className="num">{service.health.trafficRps} rps</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          );
        }}
      </AsyncBoundary>

      <div className="section-header">
        <h2 className="section-header__title">Recent events</h2>
      </div>
      <AsyncBoundary state={eventsState} errorTitle="Unable to load recent events">
        {(events) =>
          events.length === 0 ? (
            <EmptyState title="No recent events" body="Deployments, scaling actions, and status changes will show up here." />
          ) : (
            <EventTimeline events={events} />
          )
        }
      </AsyncBoundary>
    </div>
  );
}

function EventTimeline({ events }: { events: EventRecord[] }) {
  return (
    <ul className="timeline card">
      {events.map((event) => (
        <li key={event.id} className="timeline-item">
          <span className="timeline-item__marker badge--neutral" aria-hidden>
            <span className="badge__dot" />
          </span>
          <div className="timeline-item__body">
            <div className="timeline-item__title">
              <strong>{event.serviceName}</strong> — {event.message}
            </div>
            <div className="timeline-item__meta">
              {EVENT_TYPE_LABEL[event.type]} · {new Date(event.occurredAt).toLocaleString()}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
