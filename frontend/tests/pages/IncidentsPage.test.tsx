import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { IncidentsPage } from '../../src/pages/IncidentsPage';
import * as incidentsApi from '../../src/api/incidents';
import * as servicesApi from '../../src/api/services';
import * as authContext from '../../src/auth/AuthContext';
import type { IncidentRecord } from '../../src/api/types';

vi.mock('../../src/api/incidents');
vi.mock('../../src/api/services');
vi.mock('../../src/auth/AuthContext', async () => {
  const actual = await vi.importActual<typeof import('../../src/auth/AuthContext')>('../../src/auth/AuthContext');
  return { ...actual, useAuth: vi.fn() };
});

function incident(overrides: Partial<IncidentRecord> = {}): IncidentRecord {
  return {
    id: 'i1',
    title: 'Checkout errors spiking',
    description: 'Elevated 500s on checkout.',
    serviceId: 'checkout',
    serviceName: 'checkout',
    affectedServiceNames: [],
    severity: 'high',
    status: 'open',
    source: 'manual',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function mockAuth(hasRole: boolean) {
  vi.mocked(authContext.useAuth).mockReturnValue({
    user: { id: 'u1', email: 'op@example.com', role: 'OPERATOR' },
    isAuthenticated: true,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    hasRole: vi.fn().mockReturnValue(hasRole),
  });
}

describe('IncidentsPage', () => {
  it('lists incidents and hides the create form for a USER-level account', async () => {
    mockAuth(false);
    vi.mocked(incidentsApi.listIncidents).mockResolvedValue([incident()]);

    render(
      <MemoryRouter>
        <IncidentsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('Checkout errors spiking')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /file a new incident/i })).not.toBeInTheDocument();
    expect(screen.getByText(/requires an operator or admin account/i)).toBeInTheDocument();
  });

  it('lets an OPERATOR file a new incident and refreshes the list', async () => {
    mockAuth(true);
    vi.mocked(incidentsApi.listIncidents).mockResolvedValue([]);
    vi.mocked(servicesApi.listServices).mockResolvedValue([
      {
        id: 'checkout',
        name: 'checkout',
        displayName: 'Checkout',
        type: 'service',
        description: '',
        dependencies: [],
        dependents: [],
        health: { status: 'healthy', latencyMsP50: 1, latencyMsP99: 2, errorRatePercent: 0, trafficRps: 1, updatedAt: '2026-01-01T00:00:00Z' },
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ]);
    vi.mocked(incidentsApi.createIncident).mockResolvedValue(incident());

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <IncidentsPage />
      </MemoryRouter>
    );

    await screen.findByRole('heading', { name: /file a new incident/i });
    await user.type(screen.getByLabelText(/title/i), 'New incident');
    await user.type(screen.getByLabelText(/description/i), 'Something broke');
    await user.selectOptions(screen.getByLabelText(/^service$/i), 'checkout');
    await user.click(screen.getByRole('button', { name: /file incident/i }));

    expect(incidentsApi.createIncident).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'New incident', description: 'Something broke', serviceName: 'checkout', severity: 'medium' })
    );
    // The list is refetched after a successful submission.
    expect(incidentsApi.listIncidents).toHaveBeenCalledTimes(2);
  });
});
