import { RequestHandler } from 'express';
import { AppError } from '../utils/AppError';
import type { UserRole } from '../utils/jwt';

const ROLE_RANK: Record<UserRole, number> = {
  USER: 0,
  OPERATOR: 1,
  ADMIN: 2,
};

export function authorize(minimumRole: UserRole): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(new AppError('Authentication required', 401));
      return;
    }

    if (ROLE_RANK[req.user.role] < ROLE_RANK[minimumRole]) {
      next(new AppError(`This action requires the ${minimumRole} role or higher`, 403));
      return;
    }

    next();
  };
}
