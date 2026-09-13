import { describe, it, expect } from 'vitest';
import { simulateDatabaseFailure } from '../../src/services/simulation/databaseFailure';
import { fiveServiceTopology, chainTopology } from './fixtures';
import type { SimulationServiceState } from '../../src/services/simulation/types';

describe('simulateDatabaseFailure', () => {
  it('with every service database-dependent by default, all 5 go down and nothing is a "cascade"', () => {
    const result = simulateDatabaseFailure(fiveServiceTopology());

    expect(result.affectedServices).toHaveLength(5);
    expect(result.affectedServices.every((s) => s.projectedStatus === 'down')).toBe(true);
    expect(result.affectedServices.every((s) => s.distance === 0)).toBe(true);
    expect(result.unaffectedServiceNames).toEqual([]);
  });

  it('only database-dependent services go down directly; the rest cascade through the dependency graph', () => {
    const chain: SimulationServiceState[] = chainTopology().map((svc) => ({
      ...svc,
      dependsOnDatabase: svc.name === 'a',
    }));

    const result = simulateDatabaseFailure(chain);

    const a = result.affectedServices.find((s) => s.name === 'a')!;
    expect(a.distance).toBe(0);
    const b = result.affectedServices.find((s) => s.name === 'b')!;
    expect(b.distance).toBe(1);
    const c = result.affectedServices.find((s) => s.name === 'c')!;
    expect(c.distance).toBe(2);
    expect(result.affectedServices.every((s) => s.projectedStatus === 'down')).toBe(true);
  });

  it('a service marked dependsOnDatabase: false and with no path to a database-dependent service is unaffected', () => {
    const topology: SimulationServiceState[] = [
      { name: 'db-dependent', dependencies: [], dependents: [], dependsOnDatabase: true, health: { status: 'healthy', latencyMsP50: 10, latencyMsP99: 20, errorRatePercent: 0.1, trafficRps: 10 } },
      { name: 'standalone', dependencies: [], dependents: [], dependsOnDatabase: false, health: { status: 'healthy', latencyMsP50: 10, latencyMsP99: 20, errorRatePercent: 0.1, trafficRps: 10 } },
    ];

    const result = simulateDatabaseFailure(topology);

    expect(result.affectedServices.map((s) => s.name)).toEqual(['db-dependent']);
    expect(result.unaffectedServiceNames).toEqual(['standalone']);
  });
});
