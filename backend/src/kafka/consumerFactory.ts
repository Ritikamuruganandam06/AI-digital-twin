import { EachMessagePayload } from 'kafkajs';
import { getKafka, getProducer } from '../config/kafka';
import { logger } from '../config/logger';

export interface RunConsumerOptions {
  groupId: string;
  topic: string;
  /** If given, a message that throws during processing is republished here instead of being dropped silently. */
  dlqTopic?: string;
  onMessage: (payload: EachMessagePayload) => Promise<void>;
}

export interface RunningConsumer {
  stop: () => Promise<void>;
}

/**
 * Subscribes one consumer, under one consumer group, to one topic
 * (docs/architecture.md §7: "consumer groups" — the groupId is what lets
 * multiple instances of this backend share a topic's partitions instead of
 * each one reading every message).
 *
 * eachMessage is wrapped so a single bad message can't stall the whole
 * partition forever: on failure it's logged and, if dlqTopic is given,
 * republished there with the error attached; either way KafkaJS still
 * commits the offset once eachMessage returns, so the consumer moves on to
 * the next message instead of retrying the same one in a loop.
 */
export async function runConsumer({
  groupId,
  topic,
  dlqTopic,
  onMessage,
}: RunConsumerOptions): Promise<RunningConsumer> {
  const consumer = getKafka().consumer({ groupId });
  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning: false });

  await consumer.run({
    eachMessage: async (payload) => {
      try {
        await onMessage(payload);
      } catch (err) {
        logger.error(
          { mq: 'kafka', topic, partition: payload.partition, offset: payload.message.offset, err },
          'consumer failed to process message'
        );

        if (dlqTopic) {
          try {
            await getProducer().send({
              topic: dlqTopic,
              messages: [
                {
                  key: payload.message.key,
                  value: JSON.stringify({
                    originalTopic: topic,
                    originalPartition: payload.partition,
                    originalOffset: payload.message.offset,
                    error: err instanceof Error ? err.message : String(err),
                    originalValue: payload.message.value?.toString('utf8') ?? null,
                  }),
                },
              ],
            });
          } catch (dlqErr) {
            logger.error({ mq: 'kafka', dlqTopic, err: dlqErr }, 'failed to publish to DLQ — message dropped');
          }
        }
      }
    },
  });

  return {
    stop: () => consumer.disconnect(),
  };
}
