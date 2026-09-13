import { getKafka, isKafkaProducerConnected } from '../../config/kafka';
import { HealthCheckResult } from '../registry';

/**
 * Like the Mongo/Redis checks, this does a real round trip rather than
 * trusting a cached "connected" flag: describeCluster() asks the broker
 * for its current metadata, so a broker that's vanished since the producer
 * connected is still caught.
 */
export async function checkKafkaHealth(): Promise<HealthCheckResult> {
  if (!isKafkaProducerConnected()) {
    return { status: 'down', message: 'producer not connected' };
  }

  const startedAt = Date.now();
  const admin = getKafka().admin();

  try {
    await admin.connect();
    await admin.describeCluster();
    return { status: 'ok', latencyMs: Date.now() - startedAt };
  } catch (err) {
    return { status: 'down', message: err instanceof Error ? err.message : 'kafka check failed' };
  } finally {
    await admin.disconnect().catch(() => {});
  }
}
