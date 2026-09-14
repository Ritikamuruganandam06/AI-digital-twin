import { RequestHandler } from 'express';
import { assertDatabaseConnected } from '../config/database';
import { askAssistant } from '../services/assistant.service';
import { AppError } from '../utils/AppError';

/**
 * POST /api/assistant/ask -- docs/architecture.md §3's sequence diagram:
 * "FE->>BE: POST /api/assistant/ask". Checks the database first, before
 * ever calling the AI service: there is no point starting a real (and
 * potentially slow, multi-iteration) agent run only to fail persisting
 * its result at the very end.
 *
 * req.user is always set here (src/app.ts mounts this router behind
 * src/middleware/authenticate.ts), so req.user.id is what
 * agentExecution.model.ts's `userId` field -- optional since Phase 14,
 * documented there as "Phase 15 populates this from a real JWT once auth
 * exists" -- finally gets populated from.
 */
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
