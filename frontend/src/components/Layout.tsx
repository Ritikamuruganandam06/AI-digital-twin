import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  IconAssistant,
  IconExecutions,
  IconIncidents,
  IconLogout,
  IconOverview,
  IconSimulation,
  IconTopology,
} from './icons';

interface NavItem {
  to: string;
  label: string;
  icon: (props: { size?: number }) => ReactNode;
  end?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Grouped by operator workflow rather than a flat list -- OVERVIEW (what's
 * the state of the system), OPERATIONS (things you do about it),
 * INTELLIGENCE (the AI layer) -- the same three-way split an on-call
 * operator actually thinks in, mirroring how Datadog/Grafana group nav by
 * task rather than alphabetically.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { to: '/', label: 'System Overview', icon: IconOverview, end: true },
      { to: '/topology', label: 'Service Topology', icon: IconTopology },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/incidents', label: 'Incidents', icon: IconIncidents },
      { to: '/simulation', label: 'What-If Simulation', icon: IconSimulation },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { to: '/assistant', label: 'AI Assistant', icon: IconAssistant },
      { to: '/executions', label: 'Execution Traces', icon: IconExecutions },
    ],
  },
];

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <nav className="sidebar" aria-label="Primary">
        <div className="sidebar__brand">
          <span className="sidebar__brand-mark" aria-hidden>
            AI
          </span>
          <span>AI Digital Twin</span>
        </div>

        <div className="sidebar__nav">
          {NAV_GROUPS.map((group) => (
            <div className="sidebar__group" key={group.label}>
              <div className="sidebar__group-label">{group.label}</div>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) => `sidebar__link${isActive ? ' is-active' : ''}`}
                  >
                    <Icon size={17} />
                    {item.label}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </div>

        <div className="sidebar__footer">
          {user && (
            <div className="sidebar__user">
              <div className="sidebar__user-email">{user.email}</div>
              <span className="badge badge--neutral">{user.role}</span>
            </div>
          )}
          <button type="button" className="btn btn-ghost btn-sm sidebar__logout" onClick={logout}>
            <IconLogout size={15} />
            Log out
          </button>
        </div>
      </nav>
      <main className="app-main">{children}</main>
    </div>
  );
}
