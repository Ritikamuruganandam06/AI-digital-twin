import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { connectKafkaProducer, disconnectKafkaProducer, getKafka, getProducer } from '../src/config/kafka';
import { ensureTopics } from '../src/kafka/ensureTopics';
import { TOPICS } from '../src/kafka/topics';
import { startDiagnosticConsumer, stopDiagnosticConsumer } from '../src/kafka/consumers/diagnosticConsumer';

/**
 * Requires a REAL Kafka broker reachable at KAFKA_BROKERS -- there is
 * deliberately no in-memory Kafka equivalent to mongodb-memory-server used
 * here, the same reasoning tests/redis.integration.test.ts gives for using
 * a real local Redis instead of a memory-server package. Phase 5's
 * backend/README.md previously documented this DLQ path only as a manual
 * curl / kafka-console-producer.sh exercise ("There is deliberately no
 * kafka.integration.test.ts in this repository yet") -- this closes that
 * gap with a real, automated failure-injection proof.
 *
 * Publishes a malformed (non-JSON) message directly to diagnostics.ping
 * via a raw producer -- bypassing the validated HTTP endpoint entirely,
 * the same bypass the README's manual instructions describe -- and
 * asserts it lands on diagnostics.ping.dlq with the exact shape
 * src/kafka/consumerFactory.ts's runConsumer() actually writes on a
 * processing failure.
 *
 * If no Kafka broker is running, this fails at beforeAll with a
 * connection error -- a missing local dependency, not a bug here, exactly
 * like every other real-infrastructure integration test in this project
 * (see tests/redis.integration.test.ts, tests/digitalTwin.integration.test.ts).
 */
describe('Kafka DLQ: a malformed message on diagnostics.ping is republished to diagnostics.ping.dlq', () => {
  const dlqMessages: Array<{ key: string | null; value: Record<string, unknown> }> = [];
  let stopDlqConsumer: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    await connectKafkaProducer();
    await ensureTopics([TOPICS.DIAGNOSTICS_PING, TOPICS.DIAGNOSTICS_PING_DLQ]);
    await startDiagnosticConsumer();

    const dlqConsumer = getKafka().consumer({ groupId: `dlq-test-${randomUUID()}` });
    await dlqConsumer.connect();
    await dlqConsumer.subscribe({ topic: TOPICS.DIAGNOSTICS_PING_DLQ, fromBeginning: false });
    await dlqConsumer.run({
      eachMessage: async ({ message }) => {
        dlqMessages.push({
          key: message.key?.toString('utf8') ?? null,
          value: JSON.parse(message.value?.toString('utf8') ?? '{}') as Record<string, unknown>,
        });
      },
    });
    stopDlqConsumer = () => dlqConsumer.disconnect();
  }, 60_000);

  afterAll(async () => {
    await stopDiagnosticConsumer();
    if (stopDlqConsumer) await stopDlqConsumer();
    await disconnectKafkaProducer();
  });

  it('a non-JSON message on diagnostics.ping ends up on the DLQ with the error and original value attached', async () => {
    const key = `dlq-proof-${randomUUID()}`;
    await getProducer().send({
      topic: TOPICS.DIAGNOSTICS_PING,
      messages: [{ key, value: 'this is not JSON {{{' }],
    });

    // Poll for the DLQ consumer to receive the republished message rather
    // than a fixed sleep, bounded generously for real broker + real
    // consumer-group rebalance latency.
    const deadline = Date.now() + 20_000;
    let found = dlqMessages.find((m) => m.key === key);
    while (!found && Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 250));
      found = dlqMessages.find((m) => m.key === key);
    }

    expect(found).toBeDefined();
    expect(found?.value.originalTopic).toBe(TOPICS.DIAGNOSTICS_PING);
    expect(found?.value.originalValue).toBe('this is not JSON {{{');
    expect(typeof found?.value.error).toBe('string');
    expect(found?.value.error).toMatch(/JSON/i);
  }, 25_000);
});
