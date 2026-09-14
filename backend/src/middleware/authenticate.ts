import { RequestHandler } from 'express';
import { verifyAccessToken, InvalidTokenError } from '../utils/jwt';
import { AppError } from '../utils/AppError';

/**
 * Verifies a `Bearer <jwt>` Authorization header and attaches req.user
 * (typed in src/types/express.d.ts). Stateless -- see src/utils/jwt.ts's
 * own doc comment for why this never queries Mongo.
 *
 * A missing header, a header without the Bearer scheme, and an
 * invalid/expired token are all reported as the same 401 with the same
 * generic message -- this endpoint deliberately doesn't distinguish which
 * failure mode occurred, the same "don't confirm/deny specifics" posture
 * src/services/auth.service.ts's login() uses for bad credentials.
 */
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
