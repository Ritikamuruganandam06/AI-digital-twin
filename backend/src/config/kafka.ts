import { Kafka, Producer, logLevel } from 'kafkajs';
import { env } from './env';
import { logger } from './logger';

let kafka: Kafka | null = null;
let producer: Producer | null = null;
let producerConnected = false;

function createKafka(brokers: string[]): Kafka {
  return new Kafka({
    clientId: env.kafkaClientId,
    brokers,
    connectionTimeout: 5000,
    retry: { retries: 5, initialRetryTime: 300, maxRetryTime: 3000 },
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
