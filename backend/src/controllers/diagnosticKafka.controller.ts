import { RequestHandler } from 'express';
import { publishDiagnosticMessage } from '../kafka/producers/diagnosticProducer';
import { getConsumedMessages } from '../kafka/consumers/store';
import { isKafkaProducerConnected } from '../config/kafka';
import { AppError } from '../utils/AppError';

function assertKafkaConnected(): void {
  if (!isKafkaProducerConnected()) {
    throw new AppError('Kafka is currently unavailable', 503);
  }
}

export const publishPing: RequestHandler = async (req, res, next) => {
  try {
    assertKafkaConnected();

    const { message } = req.body ?? {};
    if (typeof message !== 'string' || message.trim().length === 0) {
      throw new AppError('message is required and must be a non-empty string', 400);
    }

    const published = await publishDiagnosticMessage(message.trim());
    res.status(202).json({ data: published });
  } catch (err) {
    next(err);
  }
};

export const listConsumedPings: RequestHandler = async (req, res, next) => {
  try {
    const requested = Number(req.query.limit ?? 10);
    const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), 50) : 10;

    res.status(200).json({ data: getConsumedMessages(limit) });
  } catch (err) {
    next(err);
  }
};
