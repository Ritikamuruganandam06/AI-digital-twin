import { RequestHandler } from 'express';
import { verifyAccessToken, InvalidTokenError } from '../utils/jwt';
import { AppError } from '../utils/AppError';
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.header('Authorization');
  if (!header || !header.startsWith('Bearer ')) {
    next(new AppError('Authentication required', 401));
    return;
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    next(new AppError('Authentication required', 401));
    return;
  }

  try {
    req.user = verifyAccessToken(token);
    next();
  } catch (err) {
    if (err instanceof InvalidTokenError) {
      next(new AppError('Invalid or expired token', 401));
      return;
    }
    next(err);
  }
};
