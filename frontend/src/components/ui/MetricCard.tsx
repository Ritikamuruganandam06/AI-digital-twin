import type { ReactNode } from 'react';

interface MetricCardProps {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger';
  size?: 'md' | 'sm';
}

const TONE_COLOR: Record<NonNullable<MetricCardProps['tone']>, string> = {
  default: 'var(--color-text-primary)',
  success: 'var(--color-success-text)',
  warning: 'var(--color-warning-text)',
  danger: 'var(--color-danger-text)',
};

/** A single labeled stat -- total services, P50 latency, error rate, and so on. Used both in dashboard summary rows and metric strips on detail pages. */
export function MetricCard({ label, value, icon, tone = 'default', size = 'md' }: MetricCardProps) {
  return (
    <div className="metric-card">
      <div className="metric-card__label">
        {icon}
        {label}
      </div>
      <div className={`metric-card__value ${size === 'sm' ? 'metric-card__value--sm' : ''}`} style={{ color: TONE_COLOR[tone] }}>
        {value}
      </div>
    </div>
  );
}
