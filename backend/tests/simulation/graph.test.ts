import { describe, it, expect } from 'vitest';
import { cascadeFromOrigins } from '../../src/services/simulation/graph';
import { chainTopology } from './fixtures';
import type { SimulationServiceState } from '../../src/services/simulation/types';

describe('cascadeFromOrigins', () => {
  it('merges two origins and keeps the shortest distance when a service is reachable from both', () => {
    // diamond: top -> {left, right} -> bottom
    const topology: SimulationServiceState[] = [
      { name: 'top', dependencies: [], dependents: ['left', 'right'], health: { status: 'healthy', latencyMsP50: 1, latencyMsP99: 2, errorRatePercent: 0, trafficRps: 1 } },
      { name: 'left', dependencies: ['top'], dependents: ['bottom'], health: { status: 'healthy', latencyMsP50: 1, latencyMsP99: 2, errorRatePercent: 0, trafficRps: 1 } },
      { name: 'right', dependencies: ['top'], dependents: ['bottom'], health: { status: 'healthy', latencyMsP50: 1, latencyMsP99: 2, errorRatePercent: 0, trafficRps: 1 } },
      { name: 'bottom', dependencies: ['left', 'right'], dependents: [], health: { status: 'healthy', latencyMsP50: 1, latencyMsP99: 2, errorRatePercent: 0, trafficRps: 1 } },
    ];

    // Origins are 'left' and 'right' directly (simulating both being database-dependent) — 'bottom' is reachable at distance 1 from each.
    const result = cascadeFromOrigins(topology, new Set(['left', 'right']));

    expect(result).toEqual([{ name: 'bottom', distance: 1 }]);
  });

  it('excludes services that are themselves origins', () => {
    const chain = chainTopology();
    const result = cascadeFromOrigins(chain, new Set(['a', 'b']));
    // b is an origin, so it's excluded even though it's also a's direct dependent.
    expect(result.map((r) => r.name)).toEqual(['c', 'd']);
  });

  it('returns an empty array when no origin has any dependents', () => {
    const chain = chainTopology();
    const result = cascadeFromOrigins(chain, new Set(['d']));
    expect(result).toEqual([]);
  });
});
