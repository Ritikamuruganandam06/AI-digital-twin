import { describe, it, expect } from 'vitest';
import { calculateBlastRadius } from '../../src/services/simulation/blastRadius';
import { fiveServiceTopology, chainTopology } from './fixtures';

describe('calculateBlastRadius', () => {
  it('order-service has no blast radius — nothing depends on it', () => {
    expect(calculateBlastRadius(fiveServiceTopology(), 'order-service')).toEqual([]);
  });

  it('each of the 4 leaf services has order-service as its sole, direct blast radius', () => {
    for (const name of ['user-service', 'inventory-service', 'payment-service', 'notification-service']) {
      const result = calculateBlastRadius(fiveServiceTopology(), name);
      expect(result).toEqual([{ name: 'order-service', distance: 1 }]);
    }
  });

  it('propagates transitively through a chain with increasing distance', () => {
    const result = calculateBlastRadius(chainTopology(), 'a');
    expect(result).toEqual([
      { name: 'b', distance: 1 },
      { name: 'c', distance: 2 },
      { name: 'd', distance: 3 },
    ]);
  });

  it('throws for an unknown service name', () => {
    expect(() => calculateBlastRadius(fiveServiceTopology(), 'does-not-exist')).toThrow(/Unknown service/);
  });
});
