/**
 * Topic names for the whole platform (docs/architecture.md §7). Only
 * DIAGNOSTICS_PING and its DLQ have a producer/consumer wired up in this
 * phase — the other four are declared here now (so every later phase
 * imports the same constant instead of re-typing topic-name strings) but
 * are populated incrementally as the features that produce/consume them
 * are built: SERVICE_EVENTS and SYSTEM_METRICS in Phase 6 (digital twin),
 * SIMULATION_EVENTS in Phase 7, INCIDENTS once create_incident exists
 * (Phase 11's privileged-action tool), AGENT_EVENTS in Phases 13–14.
 */
export const TOPICS = {
  SERVICE_EVENTS: 'service.events',
  SYSTEM_METRICS: 'system.metrics',
  INCIDENTS: 'incidents',
  SIMULATION_EVENTS: 'simulation.events',
  AGENT_EVENTS: 'agent.events',

  /** Phase 5's own proof-of-Kafka topic — not a domain topic. */
  DIAGNOSTICS_PING: 'diagnostics.ping',
  /** Where DIAGNOSTICS_PING messages go if the consumer fails to process them. */
  DIAGNOSTICS_PING_DLQ: 'diagnostics.ping.dlq',
} as const;

export type TopicName = (typeof TOPICS)[keyof typeof TOPICS];
