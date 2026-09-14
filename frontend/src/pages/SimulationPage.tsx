import { useState, type FormEvent } from 'react';
import { listServices } from '../api/services';
import { askAssistant } from '../api/assistant';
import { useApiQuery } from '../api/useApiQuery';
import { AsyncBoundary } from '../components/AsyncBoundary';
import { ExecutionTrace } from '../components/ExecutionTrace';
import { Markdown } from '../components/Markdown';
import { Sources } from '../components/Sources';
import { HealthBadge } from '../components/StatusBadge';
import { PageHeader, SectionHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { IconArrowRight } from '../components/icons';
import { ApiError } from '../api/client';
import type { AgentExecutionRecord, HealthStatus, ServiceRecord } from '../api/types';

/**
 * There is no dedicated "run a what-if simulation" REST endpoint the
 * frontend can call. The simulation tools (simulate_service_failure,
 * simulate_traffic_increase, simulate_database_failure,
 * simulate_cache_failure, simulate_high_latency, simulate_high_error_rate,
 * calculate_blast_radius) live behind ai-service/app/tools/executor.py and
 * are only reachable from the AI service's own manually-built agent loop,
 * which calls them through /internal/tools/* -- a deliberate,
 * non-JWT-authenticated service-to-service trust boundary
 * (docs/architecture.md §15) that React must never cross directly ("React
 * never talks to ... Qdrant" and, by the same boundary, never talks to
 * /internal/tools either).
 *
 * So this page is a guided form that composes a natural-language what-if
 * question and submits it through the same POST /api/assistant/ask the
 * AI Assistant page uses. The agent loop decides which simulate_* tool to
 * call and with what arguments -- this page never invents or guesses a
 * simulation result itself. Once the answer comes back, `SimulationResultView`
 * looks for a step whose real, structured tool result matches the
 * backend's own `SimulationResult` shape (`scenario`/`summary`/
 * `affectedServices`/`unaffectedServiceNames` --
 * backend/src/services/simulation/types.ts) and renders it as before/after
 * metric cards and an impact table built ONLY from those real fields,
 * paired with each service's real current health (already fetched for the
 * form's dropdown) as the "before" side. If the agent didn't call a
 * recognizable simulation tool (e.g. it answered from `search_knowledge_base`
 * instead), this falls back to the plain rendered answer + activity trace
 * rather than pretending to have structured data it doesn't.
 */
type ScenarioType =
  | 'service_failure'
  | 'traffic_increase'
  | 'database_failure'
  | 'cache_failure'
  | 'high_latency'
  | 'high_error_rate'
  | 'blast_radius';

const SCENARIOS: { value: ScenarioType; label: string; needsService: boolean; needsMultiplier?: string }[] = [
  { value: 'service_failure', label: 'A service fails completely', needsService: true },
  { value: 'traffic_increase', label: 'Traffic increases on a service', needsService: true, needsMultiplier: 'Traffic multiplier' },
  { value: 'database_failure', label: 'The shared database fails', needsService: false },
  { value: 'cache_failure', label: 'The shared cache fails', needsService: false },
  { value: 'high_latency', label: 'A service becomes slow', needsService: true, needsMultiplier: 'Latency multiplier' },
  { value: 'high_error_rate', label: 'A service starts erroring more', needsService: true, needsMultiplier: 'Error-rate multiplier' },
  { value: 'blast_radius', label: 'What would be affected if a service went down?', needsService: true },
];

const SCENARIO_LABEL: Record<string, string> = {
  service_failure: 'Service failure',
  traffic_increase: 'Traffic increase',
  database_failure: 'Database failure',
  cache_failure: 'Cache failure',
  high_latency: 'High latency',
  high_error_rate: 'High error rate',
};

function composeQuestion(scenario: ScenarioType, serviceName: string, multiplier: string): string {
  switch (scenario) {
    case 'service_failure':
      return `What happens if ${serviceName} fails completely?`;
    case 'traffic_increase':
      return `What happens if traffic to ${serviceName} increases by ${multiplier || '3'}x?`;
    case 'database_failure':
      return 'What happens if the shared database fails?';
    case 'cache_failure':
      return 'What happens if the shared cache fails?';
    case 'high_latency':
      return `What happens if ${serviceName}'s latency increases by ${multiplier || '5'}x?`;
    case 'high_error_rate':
      return `What happens if ${serviceName}'s error rate increases by ${multiplier || '10'}x?`;
    case 'blast_radius':
      return `What is the blast radius of ${serviceName} -- which services would be affected if it went down?`;
  }
}

interface SimulatedServiceImpact {
  name: string;
  distance: number;
  projectedStatus: HealthStatus;
  projectedLatencyMsP50: number;
  projectedLatencyMsP99: number;
  projectedErrorRatePercent: number;
  reason: string;
}
interface SimulationResultShape {
  scenario: string;
  summary: string;
  affectedServices: SimulatedServiceImpact[];
  unaffectedServiceNames: string[];
}

function isSimulationResult(value: unknown): value is SimulationResultShape {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.scenario === 'string' &&
    typeof v.summary === 'string' &&
    Array.isArray(v.affectedServices) &&
    Array.isArray(v.unaffectedServiceNames)
  );
}

export function SimulationPage() {
  const servicesState = useApiQuery(() => listServices(), []);

  const [scenario, setScenario] = useState<ScenarioType>('service_failure');
  const [serviceName, setServiceName] = useState('');
  const [multiplier, setMultiplier] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<AgentExecutionRecord>();

  const definition = SCENARIOS.find((s) => s.value === scenario)!;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (definition.needsService && !serviceName) {
      setError('Choose a service for this scenario.');
      return;
    }
    setError(undefined);
    setSubmitting(true);
    setResult(undefined);
    try {
      const question = composeQuestion(scenario, serviceName, multiplier);
      const execution = await askAssistant(question);
      setResult(execution);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The simulation could not be run.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="What-If Simulation"
        subtitle="Choose a scenario. The AI assistant runs a deterministic simulation tool against the real topology and metrics — it never guesses or invents an outcome."
      />

      <AsyncBoundary state={servicesState} errorTitle="Unable to load services">
        {(services) => (
          <form onSubmit={handleSubmit} className="card card--padded simulation-form">
            <div className="field">
              <label className="field__label" htmlFor="sim-scenario">
                Scenario
              </label>
              <select
                id="sim-scenario"
                className="select"
                value={scenario}
                onChange={(e) => setScenario(e.target.value as ScenarioType)}
              >
                {SCENARIOS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            {definition.needsService && (
              <div className="field">
                <label className="field__label" htmlFor="sim-service">
                  Service
                </label>
                <select id="sim-service" className="select" value={serviceName} onChange={(e) => setServiceName(e.target.value)}>
                  <option value="">Choose a service…</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.displayName}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {definition.needsMultiplier && (
              <div className="field">
                <label className="field__label" htmlFor="sim-multiplier">
                  {definition.needsMultiplier}
                </label>
                <input
                  id="sim-multiplier"
                  className="input"
                  type="number"
                  min="1"
                  step="any"
                  value={multiplier}
                  onChange={(e) => setMultiplier(e.target.value)}
                  placeholder="e.g. 3"
                />
              </div>
            )}

            {error && (
              <div role="alert" className="form-error">
                {error}
              </div>
            )}

            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? 'Running simulation…' : 'Run simulation'}
            </Button>
          </form>
        )}
      </AsyncBoundary>

      {result && (
        <div style={{ marginTop: 'var(--space-8)' }}>
          <SimulationResultView execution={result} services={servicesState.data ?? []} />
        </div>
      )}
    </div>
  );
}

function SimulationResultView({ execution, services }: { execution: AgentExecutionRecord; services: ServiceRecord[] }) {
  const currentByName = new Map(services.map((s) => [s.name, s]));
  const simStep = [...execution.steps].reverse().find((s) => isSimulationResult(s.result));

  if (!simStep) {
    return (
      <div className="stack" style={{ gap: 'var(--space-4)' }}>
        <SectionHeader title="Result" />
        <div className="card card--padded">
          <Markdown text={execution.finalResponse} />
        </div>
        <Sources documents={execution.retrievedDocuments} />
        <ExecutionTrace execution={execution} />
      </div>
    );
  }

  const sim = simStep.result as unknown as SimulationResultShape;
  const origin = sim.affectedServices.find((s) => s.distance === 0) ?? sim.affectedServices[0];
  const cascaded = sim.affectedServices.filter((s) => s !== origin);
  const currentOrigin = origin ? currentByName.get(origin.name) : undefined;

  return (
    <div className="stack" style={{ gap: 'var(--space-6)' }}>
      <div className="card card--padded simulation-result">
        <span className="badge badge--info">{SCENARIO_LABEL[sim.scenario] ?? sim.scenario.replace(/_/g, ' ')}</span>

        {origin && (
          <>
            <h2 className="simulation-result__service">{currentOrigin?.displayName ?? origin.name}</h2>
            <div className="cluster simulation-result__transition">
              {currentOrigin && <HealthBadge status={currentOrigin.health.status} />}
              <IconArrowRight className="text-tertiary" />
              <HealthBadge status={origin.projectedStatus} />
            </div>

            <div className="card-grid simulation-result__metrics">
              <BeforeAfter label="P50 latency" before={currentOrigin && `${currentOrigin.health.latencyMsP50} ms`} after={`${origin.projectedLatencyMsP50} ms`} />
              <BeforeAfter label="P99 latency" before={currentOrigin && `${currentOrigin.health.latencyMsP99} ms`} after={`${origin.projectedLatencyMsP99} ms`} />
              <BeforeAfter
                label="Error rate"
                before={currentOrigin && `${currentOrigin.health.errorRatePercent}%`}
                after={`${origin.projectedErrorRatePercent}%`}
              />
            </div>

            <p className="text-secondary simulation-result__reason">{origin.reason}</p>
          </>
        )}

        <p className="text-secondary simulation-result__summary">{sim.summary}</p>
      </div>

      {(cascaded.length > 0 || sim.unaffectedServiceNames.length > 0) && (
        <div>
          <SectionHeader title="Impact analysis" />
          <div className="table-wrap">
            <table className="data-table">
              <tbody>
                {cascaded.map((s) => (
                  <tr key={s.name}>
                    <td className="row-link">{currentByName.get(s.name)?.displayName ?? s.name}</td>
                    <td>
                      <HealthBadge status={s.projectedStatus} />
                    </td>
                    <td className="text-secondary">{s.reason}</td>
                  </tr>
                ))}
                {sim.unaffectedServiceNames.map((name) => (
                  <tr key={name}>
                    <td>{currentByName.get(name)?.displayName ?? name}</td>
                    <td>
                      <span className="badge badge--neutral">
                        <span className="badge__dot" />
                        unaffected
                      </span>
                    </td>
                    <td className="text-tertiary">No change projected.</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <SectionHeader title="Assistant summary" />
        <div className="card card--padded">
          <Markdown text={execution.finalResponse} />
        </div>
      </div>

      <Sources documents={execution.retrievedDocuments} />
      <ExecutionTrace execution={execution} />
    </div>
  );
}

function BeforeAfter({ label, before, after }: { label: string; before?: string; after: string }) {
  return (
    <div className="metric-card">
      <div className="metric-card__label">{label}</div>
      <div className="cluster before-after__value">
        {before && (
          <>
            <span className="text-tertiary">{before}</span>
            <IconArrowRight size={12} className="text-tertiary" />
          </>
        )}
        <span>{after}</span>
      </div>
    </div>
  );
}
