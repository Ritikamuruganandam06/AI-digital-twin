import { RequestHandler } from 'express';
import { assertDatabaseConnected } from '../config/database';
import { askAssistant } from '../services/assistant.service';
import { AppError } from '../utils/AppError';


export const askAssistantHandler: RequestHandler = async (req, res, next) => {
  try {
    assertDatabaseConnected();

    const { question } = req.body ?? {};
    if (typeof question !== 'string' || question.trim().length === 0) {
      throw new AppError('question is required and must be a non-empty string', 400);
    }

    const execution = await askAssistant({ question, userId: req.user?.id });
    res.status(201).json({ data: execution });
  } catch (err) {
    next(err);
  }
};
