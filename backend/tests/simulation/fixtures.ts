import type { SimulationServiceState } from '../../src/services/simulation/types';

/**
 * The same 5-service shape as src/data/seedTopology.ts (User/Order/Payment/
 * Inventory/Notification, with order-service as the hub depending on the
 * other four) but hand-built here in the SimulationServiceState shape so
 * these tests don't couple to Phase 6's seed data changing independently.
 */
export function fiveServiceTopology(): SimulationServiceState[] {
  return [
    {
      name: 'user-service',
      dependencies: [],
      dependents: ['order-service'],
      health: { status: 'healthy', latencyMsP50: 30, latencyMsP99: 90, errorRatePercent: 0.1, trafficRps: 120 },
    },
    {
      name: 'inventory-service',
      dependencies: [],
      dependents: ['order-service'],
      health: { status: 'healthy', latencyMsP50: 40, latencyMsP99: 110, errorRatePercent: 0.2, trafficRps: 90 },
    },
    {
      name: 'payment-service',
      dependencies: [],
      dependents: ['order-service'],
      health: { status: 'degraded', latencyMsP50: 180, latencyMsP99: 640, errorRatePercent: 2.4, trafficRps: 60 },
    },
    {
      name: 'notification-service',
      dependencies: [],
      dependents: ['order-service'],
      health: { status: 'healthy', latencyMsP50: 55, latencyMsP99: 150, errorRatePercent: 0.3, trafficRps: 70 },
    },
    {
      name: 'order-service',
      dependencies: ['user-service', 'inventory-service', 'payment-service', 'notification-service'],
      dependents: [],
      health: { status: 'healthy', latencyMsP50: 90, latencyMsP99: 310, errorRatePercent: 0.8, trafficRps: 65 },
    },
  ];
}

/** A 3-hop chain (a -> b -> c -> d) for exercising transitive/multi-hop propagation distinctly from the fan-in shape above. */
export function chainTopology(): SimulationServiceState[] {
  return [
    { name: 'a', dependencies: [], dependents: ['b'], health: { status: 'healthy', latencyMsP50: 10, latencyMsP99: 20, errorRatePercent: 0.1, trafficRps: 50 } },
    { name: 'b', dependencies: ['a'], dependents: ['c'], health: { status: 'healthy', latencyMsP50: 15, latencyMsP99: 30, errorRatePercent: 0.1, trafficRps: 40 } },
    { name: 'c', dependencies: ['b'], dependents: ['d'], health: { status: 'healthy', latencyMsP50: 20, latencyMsP99: 40, errorRatePercent: 0.1, trafficRps: 30 } },
    { name: 'd', dependencies: ['c'], dependents: [], health: { status: 'healthy', latencyMsP50: 25, latencyMsP99: 50, errorRatePercent: 0.1, trafficRps: 20 } },
  ];
}
