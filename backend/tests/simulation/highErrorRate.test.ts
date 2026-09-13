import { describe, it, expect } from 'vitest';
import { simulateHighErrorRate } from '../../src/services/simulation/highErrorRate';
import { fiveServiceTopology } from './fixtures';
import type { SimulationServiceState } from '../../src/services/simulation/types';

describe('simulateHighErrorRate', () => {
  it('a 1x multiplier leaves the origin healthy', () => {
    const result = simulateHighErrorRate(fiveServiceTopology(), 'payment-service', 1);
    const origin = result.affectedServices.find((s) => s.name === 'payment-service')!;
    expect(origin.projectedStatus).toBe('healthy');
  });

  it('a moderate multiplier degrades the origin and propagates a smaller bump to order-service', () => {
    const result = simulateHighErrorRate(fiveServiceTopology(), 'payment-service', 2);

    const origin = result.affectedServices.find((s) => s.name === 'payment-service')!;
    expect(origin.projectedStatus).toBe('degraded');
    expect(origin.projectedErrorRatePercent).toBeCloseTo(4.8, 5);

    const dependent = result.affectedServices.find((s) => s.name === 'order-service')!;
    expect(dependent.projectedErrorRatePercent).toBeGreaterThan(0.8); // baseline
  });

  it('a large multiplier marks the origin "down" once it crosses the outage threshold', () => {
    const result = simulateHighErrorRate(fiveServiceTopology(), 'payment-service', 15);
    const origin = result.affectedServices.find((s) => s.name === 'payment-service')!;
    expect(origin.projectedErrorRatePercent).toBeGreaterThanOrEqual(25);
    expect(origin.projectedStatus).toBe('down');
  });

  it('applies a floor to a 0% baseline so the multiplier still has a visible effect', () => {
    const topology: SimulationServiceState[] = [
      { name: 'perfect', dependencies: [], dependents: [], health: { status: 'healthy', latencyMsP50: 10, latencyMsP99: 20, errorRatePercent: 0, trafficRps: 10 } },
    ];
    const result = simulateHighErrorRate(topology, 'perfect', 3);
    const origin = result.affectedServices[0];
    expect(origin.projectedErrorRatePercent).toBeGreaterThan(0);
  });

  it('rejects a multiplier of 0 or below', () => {
    expect(() => simulateHighErrorRate(fiveServiceTopology(), 'payment-service', 0)).toThrow(/greater than 0/);
  });

  it('throws for an unknown service name', () => {
    expect(() => simulateHighErrorRate(fiveServiceTopology(), 'does-not-exist', 2)).toThrow(/Unknown service/);
  });
});
