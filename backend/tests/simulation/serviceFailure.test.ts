import { describe, it, expect } from 'vitest';
import { simulateServiceFailure } from '../../src/services/simulation/serviceFailure';
import { fiveServiceTopology, chainTopology } from './fixtures';

describe('simulateServiceFailure', () => {
  it('payment-service failing takes down itself and order-service, leaves the other 3 unaffected', () => {
    const result = simulateServiceFailure(fiveServiceTopology(), 'payment-service');

    expect(result.scenario).toBe('service_failure');
    expect(result.affectedServices.map((s) => s.name).sort()).toEqual(['order-service', 'payment-service']);
    expect(result.affectedServices.every((s) => s.projectedStatus === 'down')).toBe(true);
    expect(result.affectedServices.every((s) => s.projectedErrorRatePercent === 100)).toBe(true);
    expect(result.unaffectedServiceNames.sort()).toEqual(['inventory-service', 'notification-service', 'user-service']);

    const origin = result.affectedServices.find((s) => s.name === 'payment-service')!;
    expect(origin.distance).toBe(0);
    const cascaded = result.affectedServices.find((s) => s.name === 'order-service')!;
    expect(cascaded.distance).toBe(1);
  });

  it('order-service failing has zero blast radius — nothing depends on it', () => {
    const result = simulateServiceFailure(fiveServiceTopology(), 'order-service');

    expect(result.affectedServices).toHaveLength(1);
    expect(result.affectedServices[0].name).toBe('order-service');
    expect(result.unaffectedServiceNames).toHaveLength(4);
  });

  it('cascades through a multi-hop chain with increasing distance', () => {
    const result = simulateServiceFailure(chainTopology(), 'a');

    expect(result.affectedServices.map((s) => s.name)).toEqual(['a', 'b', 'c', 'd']);
    expect(result.affectedServices.map((s) => s.distance)).toEqual([0, 1, 2, 3]);
  });

  it('throws for an unknown service name', () => {
    expect(() => simulateServiceFailure(fiveServiceTopology(), 'does-not-exist')).toThrow(/Unknown service/);
  });
});
