import { describe, it, expect } from 'vitest';
import { computeDependents } from '../src/services/topology.service';
import { SEED_SERVICES } from '../src/data/seedTopology';

/**
 * Pure-function tests — no database, no mocking, nothing to skip in a
 * sandbox that can't reach MongoDB. This is the part of Phase 6's topology
 * logic that's actually verifiable without any infrastructure at all.
 */
describe('computeDependents', () => {
  it('derives the reverse edge for a simple two-node graph', () => {
    const result = computeDependents([
      { name: 'a', dependencies: [] },
      { name: 'b', dependencies: ['a'] },
    ]);

    expect(result.a).toEqual(['b']);
    expect(result.b).toEqual([]);
  });

  it('gives every service an entry, even one nothing depends on', () => {
    const result = computeDependents([
      { name: 'lonely', dependencies: [] },
      { name: 'also-lonely', dependencies: [] },
    ]);

    expect(result.lonely).toEqual([]);
    expect(result['also-lonely']).toEqual([]);
  });

  it('accumulates multiple dependents for one dependency', () => {
    const result = computeDependents([
      { name: 'db', dependencies: [] },
      { name: 'svc-a', dependencies: ['db'] },
      { name: 'svc-b', dependencies: ['db'] },
    ]);

    expect(result.db.sort()).toEqual(['svc-a', 'svc-b']);
  });

  it('tolerates a dependency name that is not itself in the service list', () => {
    const result = computeDependents([{ name: 'svc-a', dependencies: ['ghost-service'] }]);

    expect(result['ghost-service']).toEqual(['svc-a']);
    expect(result['svc-a']).toEqual([]);
  });

  it('matches the real seed topology: order-service is a dependent of all four other services', () => {
    const result = computeDependents(SEED_SERVICES);

    expect(result['user-service']).toEqual(['order-service']);
    expect(result['inventory-service']).toEqual(['order-service']);
    expect(result['payment-service']).toEqual(['order-service']);
    expect(result['notification-service']).toEqual(['order-service']);
    expect(result['order-service']).toEqual([]);
  });
});
