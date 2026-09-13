import { runConsumer, RunningConsumer } from '../consumerFactory';
import { TOPICS } from '../topics';
import { env } from '../../config/env';
import { recordConsumedMessage } from './store';

let running: RunningConsumer | null = null;

/**
 * The consumer half of Phase 5's producer -> Kafka -> consumer proof.
 * A message with an unparseable value throws JSON.parse's own error,
 * which the DLQ path in src/kafka/consumerFactory.ts genuinely exercises
 * rather than a contrived example.
 */
export async function startDiagnosticConsumer(): Promise<void> {
  running = await runConsumer({
    groupId: env.kafkaConsumerGroup,
    topic: TOPICS.DIAGNOSTICS_PING,
    dlqTopic: TOPICS.DIAGNOSTICS_PING_DLQ,
    onMessage: async ({ message, partition }) => {
      const raw = message.value?.toString('utf8');
      if (!raw) {
        throw new Error('empty message value');
      }

      const parsed = JSON.parse(raw) as { message: string; publishedAt: string };

      recordConsumedMessage({
        key: message.key?.toString('utf8') ?? null,
        message: parsed.message,
        publishedAt: parsed.publishedAt,
        consumedAt: new Date().toISOString(),
        partition,
        offset: message.offset,
      });
    },
  });
}

export async function stopDiagnosticConsumer(): Promise<void> {
  if (running) {
    await running.stop();
    running = null;
  }
}
