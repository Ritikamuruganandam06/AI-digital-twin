import { describe, it, expect } from 'vitest';
import { simulateHighLatency } from '../../src/services/simulation/highLatency';
import { fiveServiceTopology } from './fixtures';

describe('simulateHighLatency', () => {
  it('a 1x multiplier leaves the origin healthy', () => {
    const result = simulateHighLatency(fiveServiceTopology(), 'payment-service', 1);
    const origin = result.affectedServices.find((s) => s.name === 'payment-service')!;
    expect(origin.projectedStatus).toBe('healthy');
  });

  it('a moderate multiplier (2x) degrades the origin and propagates a smaller bump to order-service', () => {
    const result = simulateHighLatency(fiveServiceTopology(), 'payment-service', 2);

    const origin = result.affectedServices.find((s) => s.name === 'payment-service')!;
    expect(origin.projectedStatus).toBe('degraded');
    expect(origin.projectedLatencyMsP50).toBe(360); // 180 * 2

    const dependent = result.affectedServices.find((s) => s.name === 'order-service')!;
    expect(dependent.projectedLatencyMsP50).toBeGreaterThan(90); // baseline
    expect(dependent.distance).toBe(1);
  });

  it('a multiplier at or above the outage threshold (5x) marks the origin "down"', () => {
    const result = simulateHighLatency(fiveServiceTopology(), 'payment-service', 5);
    const origin = result.affectedServices.find((s) => s.name === 'payment-service')!;
    expect(origin.projectedStatus).toBe('down');
  });

  it('a leaf service with no dependents affects only itself', () => {
    const result = simulateHighLatency(fiveServiceTopology(), 'order-service', 3);
    expect(result.affectedServices).toHaveLength(1);
    expect(result.unaffectedServiceNames).toHaveLength(4);
  });

  it('rejects a multiplier of 0 or below', () => {
    expect(() => simulateHighLatency(fiveServiceTopology(), 'payment-service', 0)).toThrow(/greater than 0/);
  });

  it('throws for an unknown service name', () => {
    expect(() => simulateHighLatency(fiveServiceTopology(), 'does-not-exist', 2)).toThrow(/Unknown service/);
  });
});
