import type { ServiceRecord } from '../repositories/service.repository';
import type { SimulationServiceState } from '../services/simulation';

/**
 * Converts real, MongoDB-backed ServiceRecord(s) into the plain
 * SimulationServiceState shape the Phase 7 simulation engine expects.
 * This is the seam docs/architecture.md §4's comment on
 * services/simulation/index.ts anticipates: "a future phase's controller/
 * tool layer is what fetches the real topology from service.repository.ts
 * and passes it in." The engine itself stays I/O-free; this is the one
 * place that bridges live data into it.
 *
 * `dependsOnDatabase`/`dependsOnCache` aren't tracked per-service in
 * Phase 6's schema yet (SimulationServiceState.ts documents this as a
 * deliberate Phase 7 default), so every service maps to `true` for both
 * here too — consistent with the engine's own default, not a second,
 * possibly-drifting copy of it.
 */
export function toSimulationServiceState(record: ServiceRecord): SimulationServiceState {
  return {
    name: record.name,
    dependencies: record.dependencies,
    dependents: record.dependents,
    health: {
      status: record.health.status,
      latencyMsP50: record.health.latencyMsP50,
      latencyMsP99: record.health.latencyMsP99,
      errorRatePercent: record.health.errorRatePercent,
      trafficRps: record.health.trafficRps,
    },
  };
}

export function toSimulationServiceStates(records: ServiceRecord[]): SimulationServiceState[] {
  return records.map(toSimulationServiceState);
}
