import { RequestHandler } from 'express';
import { assertDatabaseConnected } from '../config/database';
import { register, login } from '../services/auth.service';
import { AppError } from '../utils/AppError';
import type { UserRole } from '../utils/jwt';

const MIN_PASSWORD_LENGTH = 8;

function readCredentials(body: unknown): { email: string; password: string } {
  const { email, password } = (body ?? {}) as { email?: unknown; password?: unknown };

  if (typeof email !== 'string' || email.trim().length === 0) {
    throw new AppError('email is required and must be a non-empty string', 400);
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new AppError(`password is required and must be at least ${MIN_PASSWORD_LENGTH} characters`, 400);
  }

  return { email, password };
}

export const registerHandler: RequestHandler = async (req, res, next) => {
  try {
    assertDatabaseConnected();

    const { email, password } = readCredentials(req.body);
    const { role } = (req.body ?? {}) as { role?: unknown };
    if (role !== undefined && typeof role !== 'string') {
      throw new AppError('role must be a string when provided', 400);
    }

    const result = await register({ email, password, role: role as UserRole | undefined });
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
};

export const loginHandler: RequestHandler = async (req, res, next) => {
  try {
    assertDatabaseConnected();

    const { email, password } = readCredentials(req.body);

    const result = await login({ email, password });
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
};
