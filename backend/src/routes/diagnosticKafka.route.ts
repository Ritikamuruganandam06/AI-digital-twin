import { Router } from 'express';
import { publishPing, listConsumedPings } from '../controllers/diagnosticKafka.controller';


export const diagnosticKafkaRouter = Router();

diagnosticKafkaRouter.post('/', publishPing);
diagnosticKafkaRouter.get('/', listConsumedPings);
