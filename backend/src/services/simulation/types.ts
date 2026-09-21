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

  dependsOnDatabase?: boolean;
  dependsOnCache?: boolean;
}

export interface SimulatedServiceImpact {
  name: string;
  distance: number;
  projectedStatus: HealthStatus;
  projectedLatencyMsP50: number;
  projectedLatencyMsP99: number;
  projectedErrorRatePercent: number;
  reason: string;
}

export interface SimulationResult {
  scenario:
    | 'service_failure'
    | 'traffic_increase'
    | 'database_failure'
    | 'cache_failure'
    | 'high_latency'
    | 'high_error_rate';
  summary: string;
  affectedServices: SimulatedServiceImpact[];
  unaffectedServiceNames: string[];
}
