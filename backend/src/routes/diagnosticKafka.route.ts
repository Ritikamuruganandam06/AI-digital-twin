import { Router } from 'express';
import { publishPing, listConsumedPings } from '../controllers/diagnosticKafka.controller';

/**
 * Mounted at /api/diagnostics/kafka-messages — a throwaway
 * producer/consumer proof, same role as diagnosticPing (Mongo) and the
 * cache-aside wiring on it (Redis). Not a digital-twin domain endpoint.
 */
export const diagnosticKafkaRouter = Router();

diagnosticKafkaRouter.post('/', publishPing);
diagnosticKafkaRouter.get('/', listConsumedPings);
