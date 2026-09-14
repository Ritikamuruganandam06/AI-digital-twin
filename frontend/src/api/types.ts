/**
 * Types mirroring the backend's actual repository/controller return
 * shapes (backend/src/repositories/*.ts, backend/src/controllers/*.ts),
 * read directly from source rather than guessed -- every field here has
 * a corresponding `toRecord()`/handler on the backend that produces
 * exactly this shape. Timestamps that are `Date` objects on the backend
 * arrive here as ISO 8601 strings (that's what `JSON.stringify` does to a
 * `Date`), so every one of those fields is typed `string`, not `Date`.
 */

export type UserRole = 'USER' | 'OPERATOR' | 'ADMIN';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface AuthResult {
  token: string;
  user: AuthUser;
}

export type HealthStatus = 'healthy' | 'degraded' | 'down';

export interface ServiceHealth {
  status: HealthStatus;
  latencyMsP50: number;
  latencyMsP99: number;
  errorRatePercent: number;
  trafficRps: number;
  updatedAt: string;
}

export interface ServiceRecord {
  id: string;
  name: string;
  displayName: string;
  type: string;
  description: string;
  dependencies: string[];
  dependents: string[];
  health: ServiceHealth;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceTopologyView extends ServiceRecord {
  resolvedDependencies: ServiceRecord[];
  resolvedDependents: ServiceRecord[];
}

export interface ServiceMetricRecord {
  id: string;
  serviceId: string;
  serviceName: string;
  timestamp: string;
  latencyMsP50: number;
  latencyMsP99: number;
  errorRatePercent: number;
  trafficRps: number;
  capacityPercent: number;
}

export type EventType = 'status_change' | 'deployment' | 'scaling' | 'generic';

export interface EventRecord {
  id: string;
  serviceId: string;
  serviceName: string;
  type: EventType;
  message: string;
  previousStatus?: HealthStatus;
  newStatus?: HealthStatus;
  occurredAt: string;
}

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'open' | 'investigating' | 'resolved';
export type IncidentSource = 'manual' | 'agent';

export interface IncidentRecord {
  id: string;
  title: string;
  description: string;
  serviceId: string;
  serviceName: string;
  affectedServiceNames: string[];
  severity: IncidentSeverity;
  status: IncidentStatus;
  source: IncidentSource;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateIncidentInput {
  title: string;
  description: string;
  serviceName: string;
  affectedServiceNames?: string[];
  severity: IncidentSeverity;
}

export type ExecutionStatus = 'completed' | 'incomplete' | 'error';

export interface AgentExecutionStep {
  toolName: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown>;
  isRagQuery: boolean;
  timestamp: string;
}

export interface RetrievedDocument {
  documentId: string;
  title: string;
  relatedService: string;
  score: number;
}

export interface AgentExecutionRecord {
  id: string;
  userId?: string;
  question: string;
  finalResponse: string;
  status: ExecutionStatus;
  stoppedReason: string;
  iterations: number;
  steps: AgentExecutionStep[];
  retrievedDocuments: RetrievedDocument[];
  createdAt: string;
  updatedAt: string;
}
