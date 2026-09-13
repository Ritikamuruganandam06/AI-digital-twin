import { describe, it, expect } from 'vitest';
import { simulateTrafficIncrease } from '../../src/services/simulation/trafficIncrease';
import { fiveServiceTopology } from './fixtures';

describe('simulateTrafficIncrease', () => {
  it('a small multiplier (1x) leaves every affected service healthy', () => {
    const result = simulateTrafficIncrease(fiveServiceTopology(), 'order-service', 1);
    expect(result.affectedServices.every((s) => s.projectedStatus === 'healthy')).toBe(true);
  });

  it('a 2.5x multiplier degrades order-service and all 4 of its dependencies (67% capacity utilization)', () => {
    const result = simulateTrafficIncrease(fiveServiceTopology(), 'order-service', 2.5);

    expect(result.affectedServices).toHaveLength(5);
    expect(result.affectedServices.every((s) => s.projectedStatus === 'degraded')).toBe(true);
    expect(result.unaffectedServiceNames).toEqual([]);
  });

  it('a 4x multiplier overloads (marks "down") order-service and every dependency', () => {
    const result = simulateTrafficIncrease(fiveServiceTopology(), 'order-service', 4);
    expect(result.affectedServices.every((s) => s.projectedStatus === 'down')).toBe(true);
  });

  it('projected latency increases monotonically with the multiplier', () => {
    const low = simulateTrafficIncrease(fiveServiceTopology(), 'order-service', 1);
    const high = simulateTrafficIncrease(fiveServiceTopology(), 'order-service', 4);

    const lowOrigin = low.affectedServices.find((s) => s.name === 'order-service')!;
    const highOrigin = high.affectedServices.find((s) => s.name === 'order-service')!;
    expect(highOrigin.projectedLatencyMsP50).toBeGreaterThan(lowOrigin.projectedLatencyMsP50);
  });

  it('traffic increase on a leaf service does not affect services that depend on it (propagation is downstream-only)', () => {
    const result = simulateTrafficIncrease(fiveServiceTopology(), 'user-service', 4);

    expect(result.affectedServices).toHaveLength(1);
    expect(result.affectedServices[0].name).toBe('user-service');
    expect(result.unaffectedServiceNames.sort()).toEqual(
      ['inventory-service', 'notification-service', 'order-service', 'payment-service'].sort()
    );
  });

  it('rejects a multiplier of 0 or below', () => {
    expect(() => simulateTrafficIncrease(fiveServiceTopology(), 'order-service', 0)).toThrow(/greater than 0/);
    expect(() => simulateTrafficIncrease(fiveServiceTopology(), 'order-service', -2)).toThrow(/greater than 0/);
  });

  it('throws for an unknown service name', () => {
    expect(() => simulateTrafficIncrease(fiveServiceTopology(), 'does-not-exist', 2)).toThrow(/Unknown service/);
  });
});
