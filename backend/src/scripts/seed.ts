/**
 * Phase 6 verification tool (docs/phases.md: "Seed script + query endpoints
 * return the modeled topology"). Run with `npm run seed`.
 *
 * DESTRUCTIVE by design: it fully replaces the contents of the services,
 * servicemetrics, events, and incidents collections in whatever database
 * MONGODB_URI points at (production always reads env, same as
 * connectToDatabase() everywhere else in this codebase — see
 * src/config/database.ts) with the fixed demo topology in
 * src/data/seedTopology.ts. Re-running it is safe and idempotent — it
 * always produces the same topology, and the delete-then-insert order
 * means there's never a duplicate. Do not point it at a database whose
 * data you want to keep.
 */
import { connectToDatabase, disconnectFromDatabase } from '../config/database';
import { logger } from '../config/logger';
import { env } from '../config/env';
import { SEED_SERVICES } from '../data/seedTopology';
import { computeDependents } from '../services/topology.service';
import { serviceRepository } from '../repositories/service.repository';
import { serviceMetricRepository, type CreateServiceMetricInput } from '../repositories/serviceMetric.repository';
import { eventRepository, type CreateEventInput } from '../repositories/event.repository';
import { incidentRepository } from '../repositories/incident.repository';

const METRIC_SAMPLES_PER_SERVICE = 12;
const METRIC_SAMPLE_INTERVAL_MINUTES = 5;

/** +/-10% jitter around a seeded baseline — realistic-looking history, not a claim of real traffic. */
function jitter(base: number, pct = 0.1): number {
  const delta = base * pct;
  return Math.max(0, Math.round((base + (Math.random() * 2 - 1) * delta) * 100) / 100);
}

async function seed(): Promise<void> {
  logger.info({ mongodbUri: env.mongodbUri }, 'seed: connecting to MongoDB');
  await connectToDatabase();

  logger.warn('seed: clearing services, servicemetrics, events, incidents collections');
  await Promise.all([
    serviceRepository.deleteAll(),
    serviceMetricRepository.deleteAll(),
    eventRepository.deleteAll(),
    incidentRepository.deleteAll(),
  ]);

  const dependentsByName = computeDependents(SEED_SERVICES);

  const services = [];
  for (const def of SEED_SERVICES) {
    // eslint-disable-next-line no-await-in-loop
    const record = await serviceRepository.upsertByName({
      name: def.name,
      displayName: def.displayName,
      type: def.type,
      description: def.description,
      dependencies: def.dependencies,
      dependents: dependentsByName[def.name] ?? [],
      health: { ...def.health, updatedAt: new Date() },
    });
    services.push({ def, record });
  }
  logger.info({ count: services.length }, 'seed: upserted services');

  const now = Date.now();
  const metricInputs: CreateServiceMetricInput[] = [];
  for (const { def, record } of services) {
    for (let i = METRIC_SAMPLES_PER_SERVICE - 1; i >= 0; i -= 1) {
      metricInputs.push({
        serviceId: record.id,
        serviceName: record.name,
        timestamp: new Date(now - i * METRIC_SAMPLE_INTERVAL_MINUTES * 60_000),
        latencyMsP50: jitter(def.health.latencyMsP50),
        latencyMsP99: jitter(def.health.latencyMsP99),
        errorRatePercent: jitter(def.health.errorRatePercent, 0.2),
        trafficRps: jitter(def.health.trafficRps),
        capacityPercent: jitter(50, 0.4),
      });
    }
  }
  await serviceMetricRepository.insertMany(metricInputs);
  logger.info({ count: metricInputs.length }, 'seed: inserted service metric samples');

  const eventInputs: CreateEventInput[] = [];
  for (const { record } of services) {
    eventInputs.push({
      serviceId: record.id,
      serviceName: record.name,
      type: 'deployment',
      message: `Deployed ${record.displayName} v1.0.0`,
      occurredAt: new Date(now - 2 * 60 * 60_000),
    });
  }
  const paymentService = services.find((s) => s.record.name === 'payment-service')!;
  eventInputs.push({
    serviceId: paymentService.record.id,
    serviceName: paymentService.record.name,
    type: 'status_change',
    message: 'Latency to the external payment gateway increased; marked degraded.',
    previousStatus: 'healthy',
    newStatus: 'degraded',
    occurredAt: new Date(now - 15 * 60_000),
  });
  await eventRepository.insertMany(eventInputs);
  logger.info({ count: eventInputs.length }, 'seed: inserted events');

  const incident = await incidentRepository.create({
    title: 'Elevated payment gateway latency',
    description:
      'payment-service p99 latency has climbed well above baseline against the external payment gateway. ' +
      'order-service depends on payment-service, so checkout is slower than normal but not yet failing.',
    serviceId: paymentService.record.id,
    serviceName: paymentService.record.name,
    affectedServiceNames: ['order-service'],
    severity: 'medium',
    status: 'investigating',
    source: 'manual',
  });
  logger.info({ incidentId: incident.id }, 'seed: created sample incident');

  await disconnectFromDatabase();
  logger.info('seed: done');
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'seed: failed');
    process.exit(1);
  });
