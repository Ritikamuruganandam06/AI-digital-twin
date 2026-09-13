import { Kafka, Producer, logLevel } from 'kafkajs';
import { env } from './env';
import { logger } from './logger';

/**
 * Kafka client + producer lifecycle, mirroring src/config/database.ts and
 * src/config/redis.ts: production calls connectKafkaProducer() with no
 * argument (reads env.kafkaBrokers); tests pass explicit brokers.
 *
 * There is one shared Kafka client and one shared producer for the whole
 * process — consumers are created separately per topic/group (see
 * src/kafka/consumerFactory.ts) since each consumer runs its own
 * subscribe/run loop.
 */

let kafka: Kafka | null = null;
let producer: Producer | null = null;
let producerConnected = false;

function createKafka(brokers: string[]): Kafka {
  return new Kafka({
    clientId: env.kafkaClientId,
    brokers,
    connectionTimeout: 5000,
    // KafkaJS retries forever by default with unbounded growth; bounding
    // it here means a broker that's genuinely down fails connectToKafka
    // in a predictable time instead of hanging startup indefinitely.
    retry: { retries: 5, initialRetryTime: 300, maxRetryTime: 3000 },
    // KafkaJS logs straight to the console by default; route everything
    // through our own structured logger instead via the log creator below.
    logLevel: logLevel.NOTHING,
    logCreator:
      () =>
      ({ namespace, level, log }) => {
        const { message, ...extra } = log;
        const line = { mq: 'kafka', namespace, ...extra };
        if (level === logLevel.ERROR) logger.error(line, message);
        else if (level === logLevel.WARN) logger.warn(line, message);
        else logger.debug(line, message);
      },
  });
}

export async function connectKafkaProducer(brokers: string[] = env.kafkaBrokers): Promise<void> {
  if (producer) {
    await disconnectKafkaProducer();
  }

  kafka = createKafka(brokers);
  // idempotent: true — KafkaJS de-duplicates retried sends within a
  // producer session (a broker-level retry never writes the same message
  // twice), which is the "idempotency" requirement from docs/architecture.md
  // §7 implemented, not just described.
  producer = kafka.producer({ idempotent: true });

  producer.on(producer.events.CONNECT, () => {
    producerConnected = true;
    logger.info({ mq: 'kafka' }, 'Kafka producer connected');
  });
  producer.on(producer.events.DISCONNECT, () => {
    producerConnected = false;
    logger.warn({ mq: 'kafka' }, 'Kafka producer disconnected');
  });

  await producer.connect();
}

export async function disconnectKafkaProducer(): Promise<void> {
  if (!producer) return;
  const toClose = producer;
  producer = null;
  producerConnected = false;
  await toClose.disconnect().catch(() => {});
}

export function getKafka(): Kafka {
  if (!kafka) {
    throw new Error('Kafka client requested before connectKafkaProducer() succeeded');
  }
  return kafka;
}

export function getProducer(): Producer {
  if (!producer) {
    throw new Error('Kafka producer requested before connectKafkaProducer() succeeded');
  }
  return producer;
}

export function isKafkaProducerConnected(): boolean {
  return producerConnected;
}
