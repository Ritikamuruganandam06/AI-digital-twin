import { Router } from 'express';
import { askAssistantHandler } from '../controllers/assistant.controller';


export const assistantRouter = Router();

assistantRouter.post('/ask', askAssistantHandler);
