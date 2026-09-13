import { randomUUID } from 'crypto';
import { getProducer } from '../../config/kafka';
import { TOPICS } from '../topics';

export interface PublishedDiagnosticMessage {
  key: string;
  message: string;
  publishedAt: string;
}

/**
 * Every message gets an explicit key (docs/architecture.md §7: "message
 * keys"). Kafka routes all messages with the same key to the same
 * partition, which is what guarantees per-key ordering — here the key is
 * random per message purely to demonstrate that keyed messages spread
 * across DIAGNOSTICS_PING's 3 partitions; a real producer (e.g. Phase 6's
 * service.events) would key by something meaningful like serviceId so all
 * events for one service stay in order.
 */
export async function publishDiagnosticMessage(message: string): Promise<PublishedDiagnosticMessage> {
  const key = randomUUID();
  const publishedAt = new Date().toISOString();

  const producer = getProducer();
  await producer.send({
    topic: TOPICS.DIAGNOSTICS_PING,
    messages: [
      {
        key,
        value: JSON.stringify({ message, publishedAt }),
      },
    ],
  });

  return { key, message, publishedAt };
}
