export type HealthStatus = 'healthy' | 'degraded' | 'down';

export interface SeedHealthSnapshot {
  status: HealthStatus;
  latencyMsP50: number;
  latencyMsP99: number;
  errorRatePercent: number;
  trafficRps: number;
}

export interface SeedServiceDefinition {
  name: string;
  displayName: string;
  type: string;
  description: string;
  /** Names of other seed services this one depends on. `dependents` is
   * never hand-written here — it's always derived from this field (see
   * src/services/topology.service.ts's computeDependents()) so the two
   * directions of the graph can't drift out of sync. */
  dependencies: string[];
  health: SeedHealthSnapshot;
}

/**
 * The five services named in docs/architecture.md §1 (User, Order, Payment,
 * Inventory, Notification), wired into a small but real dependency graph:
 * order-service is the hub that depends on the other four, which is exactly
 * the shape docs/architecture.md §3's example question needs ("What happens
 * if Payment Service goes down?") — Payment going down has somewhere to
 * cascade to. Payment is seeded already `degraded` so the topology has
 * realistic variety from the first query, not five identical "healthy" rows.
 */
export const SEED_SERVICES: SeedServiceDefinition[] = [
  {
    name: 'user-service',
    displayName: 'User Service',
    type: 'microservice',
    description: 'Owns user accounts, profiles, and authentication state.',
    dependencies: [],
    health: { status: 'healthy', latencyMsP50: 32, latencyMsP99: 88, errorRatePercent: 0.1, trafficRps: 120 },
  },
  {
    name: 'inventory-service',
    displayName: 'Inventory Service',
    type: 'microservice',
    description: 'Tracks product stock levels and reservations.',
    dependencies: [],
    health: { status: 'healthy', latencyMsP50: 40, latencyMsP99: 110, errorRatePercent: 0.2, trafficRps: 95 },
  },
  {
    name: 'payment-service',
    displayName: 'Payment Service',
    type: 'microservice',
    description: 'Processes payments through an external payment gateway.',
    dependencies: [],
    health: { status: 'degraded', latencyMsP50: 180, latencyMsP99: 640, errorRatePercent: 2.4, trafficRps: 60 },
  },
  {
    name: 'notification-service',
    displayName: 'Notification Service',
    type: 'microservice',
    description: 'Sends order and payment confirmation emails and SMS.',
    dependencies: [],
    health: { status: 'healthy', latencyMsP50: 55, latencyMsP99: 150, errorRatePercent: 0.3, trafficRps: 70 },
  },
  {
    name: 'order-service',
    displayName: 'Order Service',
    type: 'microservice',
    description: 'Coordinates order placement across user, inventory, payment, and notification services.',
    dependencies: ['user-service', 'inventory-service', 'payment-service', 'notification-service'],
    health: { status: 'healthy', latencyMsP50: 90, latencyMsP99: 310, errorRatePercent: 0.8, trafficRps: 65 },
  },
];
