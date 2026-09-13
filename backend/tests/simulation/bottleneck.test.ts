import { describe, it, expect } from 'vitest';
import { findBottleneck } from '../../src/services/simulation/bottleneck';
import { fiveServiceTopology, chainTopology } from './fixtures';

describe('findBottleneck', () => {
  it('ranks the 4 leaf services above order-service (which nothing depends on)', () => {
    const result = findBottleneck(fiveServiceTopology());

    const orderRanking = result.ranked.find((r) => r.name === 'order-service')!;
    expect(orderRanking.blastRadiusSize).toBe(0);
    expect(result.ranked[result.ranked.length - 1].name).toBe('order-service');
  });

  it('breaks a tie in blast-radius size toward the currently-unhealthy service (payment-service is seeded "degraded")', () => {
    const result = findBottleneck(fiveServiceTopology());

    expect(result.topBottleneck).not.toBeNull();
    expect(result.topBottleneck!.name).toBe('payment-service');
    expect(result.topBottleneck!.blastRadiusSize).toBe(1);
    expect(result.topBottleneck!.currentStatus).toBe('degraded');
  });

  it('in a chain, the service furthest upstream is the biggest bottleneck', () => {
    const result = findBottleneck(chainTopology());
    expect(result.topBottleneck!.name).toBe('a');
    expect(result.topBottleneck!.blastRadiusSize).toBe(3);
  });

  it('returns a null topBottleneck for an empty topology', () => {
    const result = findBottleneck([]);
    expect(result.ranked).toEqual([]);
    expect(result.topBottleneck).toBeNull();
  });
});
