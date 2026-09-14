import { RequestHandler } from 'express';
import { Types } from 'mongoose';
import { assertDatabaseConnected } from '../config/database';
import { agentExecutionRepository } from '../repositories/agentExecution.repository';
import { AppError } from '../utils/AppError';

/**
 * docs/phases.md row 14's verification: "Trace retrievable via API".
 * Read-only, same shape as incidents.controller.ts's list/get pair.
 */

export const listAgentExecutionsHandler: RequestHandler = async (req, res, next) => {
  try {
    assertDatabaseConnected();

    const requested = Number(req.query.limit ?? 20);
    const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), 100) : 20;

    const executions = await agentExecutionRepository.findAll(limit);
    res.status(200).json({ data: executions });
  } catch (err) {
    next(err);
  }
};

export const getAgentExecutionHandler: RequestHandler = async (req, res, next) => {
  try {
    assertDatabaseConnected();

    const id = String(req.params.id ?? '');
    if (!Types.ObjectId.isValid(id)) {
      throw new AppError(`"${id}" is not a valid execution id`, 400);
    }

    const execution = await agentExecutionRepository.findById(id);
    if (!execution) {
      throw new AppError(`Agent execution "${id}" not found`, 404);
    }

    res.status(200).json({ data: execution });
  } catch (err) {
    next(err);
  }
};
