import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { SystemOverviewPage } from '../../src/pages/SystemOverviewPage';
import * as servicesApi from '../../src/api/services';
import * as eventsApi from '../../src/api/events';
import type { EventRecord, ServiceRecord } from '../../src/api/types';

vi.mock('../../src/api/services');
vi.mock('../../src/api/events');

function healthyService(overrides: Partial<ServiceRecord> & { name: string }): ServiceRecord {
  return {
    id: overrides.name,
    displayName: overrides.name,
    type: 'service',
    description: '',
    dependencies: [],
    dependents: [],
    health: { status: 'healthy', latencyMsP50: 10, latencyMsP99: 20, errorRatePercent: 0, trafficRps: 5, updatedAt: '2026-01-01T00:00:00Z' },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('SystemOverviewPage', () => {
  it('renders per-status counts and a service table row per service', async () => {
    vi.mocked(servicesApi.listServices).mockResolvedValue([
      healthyService({ name: 'checkout' }),
      healthyService({ name: 'payments', health: { status: 'down', latencyMsP50: 0, latencyMsP99: 0, errorRatePercent: 100, trafficRps: 0, updatedAt: '2026-01-01T00:00:00Z' } }),
    ]);
    vi.mocked(eventsApi.listEvents).mockResolvedValue([
      { id: 'e1', serviceId: 'payments', serviceName: 'payments', type: 'status_change', message: 'went down', occurredAt: '2026-01-01T00:00:00Z' } as EventRecord,
    ]);

    render(
      <MemoryRouter>
        <SystemOverviewPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('checkout')).toBeInTheDocument();
    expect(screen.getAllByText('payments').length).toBeGreaterThan(0);
    expect(screen.getByText(/went down/)).toBeInTheDocument();
  });

  it('shows the real error and a retry button when the services request fails', async () => {
    const { ApiError } = await import('../../src/api/client');
    vi.mocked(servicesApi.listServices).mockRejectedValue(new ApiError('Backend unreachable', 0));
    vi.mocked(eventsApi.listEvents).mockResolvedValue([]);

    render(
      <MemoryRouter>
        <SystemOverviewPage />
      </MemoryRouter>
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Backend unreachable');
  });
});
