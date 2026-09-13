import { getKafka } from '../config/kafka';
import { logger } from '../config/logger';

/**
 * Explicitly creates topics with a chosen partition count instead of
 * relying on broker auto-creation (which most real clusters disable, and
 * which would otherwise hand every topic whatever `num.partitions` default
 * the broker happens to have). 3 partitions is enough to demonstrate
 * key-based partitioning for a diagnostic topic without over-provisioning
 * a topic that carries no real production traffic.
 */
export async function ensureTopics(topics: string[], numPartitions = 3): Promise<void> {
  const admin = getKafka().admin();
  await admin.connect();
  try {
    await admin.createTopics({
      waitForLeaders: true,
      topics: topics.map((topic) => ({ topic, numPartitions })),
    });
  } catch (err) {
    logger.warn({ mq: 'kafka', err, topics }, 'ensureTopics: createTopics reported an issue (often just "already exists")');
  } finally {
    await admin.disconnect().catch(() => {});
  }
}
