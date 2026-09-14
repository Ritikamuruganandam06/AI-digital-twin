import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { createIncident, listIncidents } from '../api/incidents';
import { listServices } from '../api/services';
import { useApiQuery } from '../api/useApiQuery';
import { AsyncBoundary } from '../components/AsyncBoundary';
import { SeverityBadge, IncidentStatusBadge } from '../components/StatusBadge';
import { EmptyState } from '../components/ui/States';
import { PageHeader, SectionHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import type { IncidentSeverity, IncidentStatus } from '../api/types';

const STATUS_OPTIONS: { value: IncidentStatus | ''; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'investigating', label: 'Investigating' },
  { value: 'resolved', label: 'Resolved' },
];

export function IncidentsPage() {
  const { hasRole } = useAuth();
  const [statusFilter, setStatusFilter] = useState<IncidentStatus | ''>('');
  const incidentsState = useApiQuery(() => listIncidents(statusFilter || undefined, 50), [statusFilter]);

  return (
    <div className="page">
      <PageHeader title="Incidents" subtitle="Track and triage incidents across every modeled service." />

      <div className="field" style={{ maxWidth: 260, marginBottom: 'var(--space-6)' }}>
        <label className="field__label" htmlFor="incident-status-filter">
          Filter by status
        </label>
        <select
          id="incident-status-filter"
          className="select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as IncidentStatus | '')}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <AsyncBoundary state={incidentsState} errorTitle="Unable to load incidents">
        {(incidents) =>
          incidents.length === 0 ? (
            <EmptyState icon="inbox" title="No incidents found" body="There are currently no incidents matching this filter." />
          ) : (
            <div className="table-wrap" style={{ marginBottom: 'var(--space-8)' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Service</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th>Source</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.map((incident) => (
                    <tr key={incident.id}>
                      <td>
                        <Link to={`/incidents/${incident.id}`} className="row-link">
                          {incident.title}
                        </Link>
                      </td>
                      <td className="text-secondary">{incident.serviceName}</td>
                      <td>
                        <SeverityBadge severity={incident.severity} />
                      </td>
                      <td>
                        <IncidentStatusBadge status={incident.status} />
                      </td>
                      <td className="text-secondary">{incident.source}</td>
                      <td className="text-secondary">{new Date(incident.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </AsyncBoundary>

      {hasRole('OPERATOR') ? (
        <CreateIncidentForm onCreated={() => incidentsState.refetch()} />
      ) : (
        <div className="card card--padded">
          <p className="text-secondary">Filing an incident requires an OPERATOR or ADMIN account.</p>
        </div>
      )}
    </div>
  );
}

/**
 * Only rendered for OPERATOR/ADMIN by the parent -- but that's a UX
 * convenience, not the real access check (see auth/decodeToken.ts): the
 * actual enforcement is the backend rejecting POST /api/incidents with a
 * 403 for a USER token, which `createIncident()`/`ApiError` surface here
 * as a normal error if this form's gating is ever bypassed.
 */
function CreateIncidentForm({ onCreated }: { onCreated: () => void }) {
  const servicesState = useApiQuery(() => listServices(), []);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [serviceName, setServiceName] = useState('');
  const [severity, setSeverity] = useState<IncidentSeverity>('medium');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    setSubmitting(true);
    try {
      await createIncident({ title, description, serviceName, severity });
      setTitle('');
      setDescription('');
      setServiceName('');
      setSeverity('medium');
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not file the incident.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card card--padded">
      <SectionHeader title="File a new incident" />
      <AsyncBoundary state={servicesState}>
        {(services) => (
          <form onSubmit={handleSubmit} className="stack" style={{ gap: 'var(--space-4)', maxWidth: 460, marginTop: 'var(--space-4)' }}>
            <div className="field">
              <label className="field__label" htmlFor="incident-title">
                Title
              </label>
              <input
                id="incident-title"
                className="input"
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="incident-description">
                Description
              </label>
              <textarea
                id="incident-description"
                className="textarea"
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="incident-service">
                Service
              </label>
              <select id="incident-service" className="select" required value={serviceName} onChange={(e) => setServiceName(e.target.value)}>
                <option value="">Choose a service…</option>
                {services.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.displayName}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="incident-severity">
                Severity
              </label>
              <select
                id="incident-severity"
                className="select"
                value={severity}
                onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            {error && (
              <div role="alert" className="form-error">
                {error}
              </div>
            )}
            <Button type="submit" variant="primary" disabled={submitting} style={{ alignSelf: 'flex-start' }}>
              {submitting ? 'Filing…' : 'File incident'}
            </Button>
          </form>
        )}
      </AsyncBoundary>
    </div>
  );
}
