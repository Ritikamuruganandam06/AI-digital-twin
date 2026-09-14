import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ServiceDetailPage } from '../../src/pages/ServiceDetailPage';
import * as servicesApi from '../../src/api/services';
import * as eventsApi from '../../src/api/events';
import type { ServiceTopologyView } from '../../src/api/types';

vi.mock('../../src/api/services');
vi.mock('../../src/api/events');

const HEALTH = { status: 'healthy' as const, latencyMsP50: 12, latencyMsP99: 40, errorRatePercent: 0.5, trafficRps: 20, updatedAt: '2026-01-01T00:00:00Z' };

function baseService(name: string) {
  return {
    id: name,
    name,
    displayName: name,
    type: 'service',
    description: `${name} description`,
    dependencies: [],
    dependents: [],
    health: HEALTH,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/services/:name" element={<ServiceDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ServiceDetailPage', () => {
  it('renders the service, its resolved dependencies/dependents, metrics, and events', async () => {
    const view: ServiceTopologyView = {
      ...baseService('checkout'),
      resolvedDependencies: [baseService('payments')],
      resolvedDependents: [baseService('web')],
    };
    vi.mocked(servicesApi.getService).mockResolvedValue(view);
    vi.mocked(servicesApi.getServiceMetrics).mockResolvedValue([
      { id: 'm1', serviceId: 'checkout', serviceName: 'checkout', timestamp: '2026-01-01T00:00:00Z', latencyMsP50: 12, latencyMsP99: 40, errorRatePercent: 0.5, trafficRps: 20, capacityPercent: 60 },
    ]);
    vi.mocked(eventsApi.listEvents).mockResolvedValue([
      { id: 'e1', serviceId: 'checkout', serviceName: 'checkout', type: 'deployment', message: 'deployed v2', occurredAt: '2026-01-01T00:00:00Z' },
    ]);

    renderAt('/services/checkout');

    expect(await screen.findByRole('heading', { name: /checkout/ })).toBeInTheDocument();
    expect(servicesApi.getService).toHaveBeenCalledWith('checkout');
    expect(screen.getByText('payments')).toBeInTheDocument();
    expect(screen.getByText('web')).toBeInTheDocument();
    expect(screen.getByText('deployed v2')).toBeInTheDocument();
  });

  it("shows a friendly message instead of an empty list for a root service with no dependencies", async () => {
    vi.mocked(servicesApi.getService).mockResolvedValue({
      ...baseService('database'),
      resolvedDependencies: [],
      resolvedDependents: [],
    });
    vi.mocked(servicesApi.getServiceMetrics).mockResolvedValue([]);
    vi.mocked(eventsApi.listEvents).mockResolvedValue([]);

    renderAt('/services/database');

    expect(await screen.findByText(/root service/i)).toBeInTheDocument();
    expect(screen.getByText(/no metric samples yet/i)).toBeInTheDocument();
  });
});
