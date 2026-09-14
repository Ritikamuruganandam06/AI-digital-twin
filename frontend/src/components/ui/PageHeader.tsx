import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { IconArrowLeft } from '../icons';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-header__title">{title}</h1>
        {subtitle && <p className="page-header__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </div>
  );
}

export function SectionHeader({ title, meta }: { title: ReactNode; meta?: ReactNode }) {
  return (
    <div className="section-header">
      <h2 className="section-header__title">{title}</h2>
      {meta && <span className="section-header__meta">{meta}</span>}
    </div>
  );
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="back-link">
      <IconArrowLeft size={15} />
      {children}
    </Link>
  );
}
