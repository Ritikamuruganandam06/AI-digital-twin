import { describe, it, expect } from 'vitest';
import {
  computeScalingRecommendation,
  DOWN_SCALE_REPLICA_MULTIPLIER,
  DEGRADED_SCALE_REPLICA_MULTIPLIER,
} from '../src/services/recommendation.service';

/**
 * Pure-function tests for the recommend_scaling tool's decision rule — no
 * database needed, same discipline as topology.unit.test.ts and every
 * services/simulation/*.test.ts file.
 */
describe('computeScalingRecommendation', () => {
  it('recommends no action for a healthy service', () => {
    const result = computeScalingRecommendation('order-service', {
      status: 'healthy',
      errorRatePercent: 0.1,
      latencyMsP99: 50,
    });

    expect(result.recommendation).toBe('no_action');
    expect(result.suggestedReplicaMultiplier).toBe(1);
  });

  it('recommends scale_out with the degraded multiplier for a degraded service', () => {
    const result = computeScalingRecommendation('payment-service', {
      status: 'degraded',
      errorRatePercent: 8,
      latencyMsP99: 900,
    });

    expect(result.recommendation).toBe('scale_out');
    expect(result.suggestedReplicaMultiplier).toBe(DEGRADED_SCALE_REPLICA_MULTIPLIER);
    expect(result.reason).toContain('degraded');
  });

  it('recommends scale_out with the larger down multiplier for a down service', () => {
    const result = computeScalingRecommendation('payment-service', {
      status: 'down',
      errorRatePercent: 100,
      latencyMsP99: 5000,
    });

    expect(result.recommendation).toBe('scale_out');
    expect(result.suggestedReplicaMultiplier).toBe(DOWN_SCALE_REPLICA_MULTIPLIER);
    expect(result.suggestedReplicaMultiplier).toBeGreaterThan(DEGRADED_SCALE_REPLICA_MULTIPLIER);
  });

  it('echoes the service name and current status unchanged', () => {
    const result = computeScalingRecommendation('inventory-service', {
      status: 'healthy',
      errorRatePercent: 0,
      latencyMsP99: 10,
    });

    expect(result.serviceName).toBe('inventory-service');
    expect(result.currentStatus).toBe('healthy');
  });
});
