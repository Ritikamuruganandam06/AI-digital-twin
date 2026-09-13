/**
 * Shared types for the deterministic simulation engine (docs/architecture.md
 * §11). Every function under src/services/simulation/ is a pure function:
 * no Mongo, no Redis, no Kafka, no LLM — it takes a snapshot of the
 * topology graph (and current metrics, where relevant) and returns a
 * structured, deterministic result. A future phase's controller/tool layer
 * is what fetches the real topology from service.repository.ts and passes
 * it in; this engine has zero I/O of its own, which is what makes it
 * unit-testable without any database (docs/phases.md Phase 7 verification:
 * "Unit tests covering each scenario's calculated output").
 */

export type HealthStatus = 'healthy' | 'degraded' | 'down';

export interface SimulationServiceState {
  name: string;
  dependencies: string[];
  dependents: string[];
  health: {
    status: HealthStatus;
    latencyMsP50: number;
    latencyMsP99: number;
    errorRatePercent: number;
    trafficRps: number;
  };
  /**
   * Whether this service's own function depends on the shared database /
   * cache layer failing outright (simulateDatabaseFailure /
   * simulateCacheFailure). Phase 6's real topology doesn't set these yet —
   * they default to `true` here (every service in this twin is assumed to
   * touch both) rather than requiring a Phase 6 schema change just for this
   * engine; a future phase can set them per-service once that distinction
   * actually matters.
   */
  dependsOnDatabase?: boolean;
  dependsOnCache?: boolean;
}

/** One service's projected state under a simulated scenario. */
export interface SimulatedServiceImpact {
  name: string;
  /** Hops from the scenario's origin along the relevant graph edge. 0 = the service the scenario directly targets. */
  distance: number;
  projectedStatus: HealthStatus;
  projectedLatencyMsP50: number;
  projectedLatencyMsP99: number;
  projectedErrorRatePercent: number;
  /** Human-readable, not just a number — this is what a future agent explains to the user. */
  reason: string;
}

/** The common return shape for every "what happens if X" scenario function. */
export interface SimulationResult {
  scenario:
    | 'service_failure'
    | 'traffic_increase'
    | 'database_failure'
    | 'cache_failure'
    | 'high_latency'
    | 'high_error_rate';
  summary: string;
  /** Includes the origin service itself (distance 0) where the scenario targets one specific service. Never includes unaffected services. */
  affectedServices: SimulatedServiceImpact[];
  unaffectedServiceNames: string[];
}
