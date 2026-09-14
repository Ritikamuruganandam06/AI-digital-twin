import type { ExecutionStatus, HealthStatus, IncidentSeverity, IncidentStatus } from '../api/types';

/**
 * Every status badge pairs a semantic color with a text label and a small
 * dot -- color is never the only signal (a colorblind operator, or a
 * black-and-white printout of a dashboard, still needs to read the
 * status). Label text stays the plain lowercase status value from the API
 * (`"healthy"`, `"degraded"`, ...); CSS `text-transform: uppercase` is
 * purely visual and doesn't change what's actually in the DOM.
 */
type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const HEALTH_TONE: Record<HealthStatus, Tone> = {
  healthy: 'success',
  degraded: 'warning',
  down: 'danger',
};

const SEVERITY_TONE: Record<IncidentSeverity, Tone> = {
  low: 'neutral',
  medium: 'info',
  high: 'warning',
  critical: 'danger',
};

const INCIDENT_STATUS_TONE: Record<IncidentStatus, Tone> = {
  open: 'danger',
  investigating: 'warning',
  resolved: 'success',
};

const EXECUTION_STATUS_TONE: Record<ExecutionStatus, Tone> = {
  completed: 'success',
  incomplete: 'warning',
  error: 'danger',
};

function Badge({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span className={`badge badge--${tone}`}>
      <span className="badge__dot" />
      {label}
    </span>
  );
}

export function HealthBadge({ status }: { status: HealthStatus }) {
  return <Badge label={status} tone={HEALTH_TONE[status]} />;
}

export function SeverityBadge({ severity }: { severity: IncidentSeverity }) {
  return <Badge label={severity} tone={SEVERITY_TONE[severity]} />;
}

export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  return <Badge label={status} tone={INCIDENT_STATUS_TONE[status]} />;
}

export function ExecutionStatusBadge({ status }: { status: ExecutionStatus }) {
  return <Badge label={status} tone={EXECUTION_STATUS_TONE[status]} />;
}
