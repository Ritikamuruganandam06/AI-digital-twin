import { RequestHandler } from 'express';
import { AppError } from '../utils/AppError';
import type { UserRole } from '../utils/jwt';

/**
 * Rank, not an exact-match set: authorize('OPERATOR') accepts OPERATOR and
 * ADMIN, because an ADMIN can always do what an OPERATOR can. This is the
 * one place that hierarchy is encoded, so USER/OPERATOR/ADMIN's relative
 * order only needs to change here if it ever changes at all.
 */
const ROLE_RANK: Record<UserRole, number> = {
  USER: 0,
  OPERATOR: 1,
  ADMIN: 2,
};

/**
 * Must run after src/middleware/authenticate.ts (req.user must already be
 * set). Doesn't assume that ordering holds silently -- a missing req.user
 * here is treated as "not authenticated" (401) rather than crashing or
 * falling through, since a middleware-ordering mistake in src/app.ts
 * should fail safe (reject) not fail open (allow).
 */
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
