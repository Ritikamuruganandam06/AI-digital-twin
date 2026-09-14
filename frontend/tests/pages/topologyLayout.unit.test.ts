import { describe, expect, it } from 'vitest';
import { computeTopologyLayout } from '../../src/pages/topologyLayout';
import type { ServiceRecord } from '../../src/api/types';

function service(overrides: Partial<ServiceRecord> & { name: string }): ServiceRecord {
  return {
    id: overrides.name,
    displayName: overrides.name,
    type: 'service',
    description: '',
    dependencies: [],
    dependents: [],
    health: {
      status: 'healthy',
      latencyMsP50: 10,
      latencyMsP99: 20,
      errorRatePercent: 0,
      trafficRps: 1,
      updatedAt: new Date().toISOString(),
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('computeTopologyLayout', () => {
  it('places a service with no dependencies in layer 0', () => {
    const layout = computeTopologyLayout([service({ name: 'db' })]);
    expect(layout.nodes[0].layer).toBe(0);
  });

  it('places a dependent one layer after its deepest dependency', () => {
    const services = [
      service({ name: 'db' }),
      service({ name: 'cache' }),
      service({ name: 'api', dependencies: ['db', 'cache'] }),
      service({ name: 'web', dependencies: ['api'] }),
    ];
    const layout = computeTopologyLayout(services);
    const byName = new Map(layout.nodes.map((n) => [n.name, n.layer]));

    expect(byName.get('db')).toBe(0);
    expect(byName.get('cache')).toBe(0);
    expect(byName.get('api')).toBe(1);
    expect(byName.get('web')).toBe(2);
  });

  it('produces one edge per known dependency and skips dangling names', () => {
    const services = [service({ name: 'db' }), service({ name: 'api', dependencies: ['db', 'ghost-service'] })];
    const layout = computeTopologyLayout(services);

    expect(layout.edges).toEqual([{ from: 'api', to: 'db' }]);
  });

  it('does not infinite-loop on a dependency cycle', () => {
    const services = [service({ name: 'a', dependencies: ['b'] }), service({ name: 'b', dependencies: ['a'] })];
    expect(() => computeTopologyLayout(services)).not.toThrow();
    expect(computeTopologyLayout(services).nodes).toHaveLength(2);
  });

  it('returns a zero-node layout for an empty service list without throwing', () => {
    const layout = computeTopologyLayout([]);
    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
  });

  it('stacks same-layer nodes into distinct rows, sorted by name', () => {
    const services = [service({ name: 'zeta' }), service({ name: 'alpha' })];
    const layout = computeTopologyLayout(services);
    const sorted = [...layout.nodes].sort((a, b) => a.y - b.y);
    expect(sorted.map((n) => n.name)).toEqual(['alpha', 'zeta']);
  });
});
