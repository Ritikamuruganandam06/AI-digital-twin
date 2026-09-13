import { describe, it, expect } from 'vitest';
import { simulateCacheFailure } from '../../src/services/simulation/cacheFailure';
import { fiveServiceTopology } from './fixtures';
import type { SimulationServiceState } from '../../src/services/simulation/types';

describe('simulateCacheFailure', () => {
  it('degrades every cache-dependent service but never marks anything "down" — mirrors the real fallback behavior', () => {
    const result = simulateCacheFailure(fiveServiceTopology());

    expect(result.affectedServices).toHaveLength(5);
    expect(result.affectedServices.every((s) => s.projectedStatus !== 'down')).toBe(true);
    const origin = result.affectedServices.find((s) => s.name === 'payment-service')!;
    expect(origin.projectedLatencyMsP50).toBeGreaterThan(180); // baseline latency
  });

  it('a service marked dependsOnCache: false is unaffected when nothing else cascades to it', () => {
    const topology: SimulationServiceState[] = [
      { name: 'cached', dependencies: [], dependents: [], dependsOnCache: true, health: { status: 'healthy', latencyMsP50: 10, latencyMsP99: 20, errorRatePercent: 0.1, trafficRps: 10 } },
      { name: 'no-cache', dependencies: [], dependents: [], dependsOnCache: false, health: { status: 'healthy', latencyMsP50: 10, latencyMsP99: 20, errorRatePercent: 0.1, trafficRps: 10 } },
    ];

    const result = simulateCacheFailure(topology);

    expect(result.affectedServices.map((s) => s.name)).toEqual(['cached']);
    expect(result.unaffectedServiceNames).toEqual(['no-cache']);
  });
});
