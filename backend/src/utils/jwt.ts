import jwt from 'jsonwebtoken';
import { env } from '../config/env';

/**
 * docs/architecture.md §17: "JWT authentication + RBAC (USER, OPERATOR,
 * ADMIN)". Rank order matters elsewhere (src/middleware/authorize.ts) but
 * this module only cares that a role is one of these three exact strings.
 */
export type UserRole = 'USER' | 'OPERATOR' | 'ADMIN';
export const USER_ROLES: readonly UserRole[] = ['USER', 'OPERATOR', 'ADMIN'];

export interface AccessTokenPayload {
  id: string;
  email: string;
  role: UserRole;
}

export class InvalidTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTokenError';
  }
}

/**
 * Stateless signing: the id/email/role a token carries are exactly what
 * src/middleware/authenticate.ts hands back on every request -- there is
 * no database lookup per request, which is why authorize.ts can run
 * synchronously. The tradeoff (a role change or account deletion doesn't
 * take effect until the token naturally expires) is bounded by
 * JWT_EXPIRES_IN, not solved by re-querying Mongo on every call.
 *
 * `sub` carries the user id per JWT convention (RFC 7519 §4.1.2);
 * email/role are this app's own custom claims.
 */
export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign({ email: payload.email, role: payload.role }, env.jwtSecret, {
    subject: payload.id,
    // env.jwtExpiresIn is a free-form string from JWT_EXPIRES_IN (e.g.
    // "1h"); jsonwebtoken's own types are stricter than "any string" as of
    // v9, so this cast documents that env-vars.md, not TypeScript, is what
    // constrains its format.
    expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

/**
 * Verifies signature + expiry, then validates the payload actually has the
 * shape this app expects (a real-world concern: a token signed by an
 * older/different version of this codebase, or a hand-crafted one that
 * still happens to be validly signed with a leaked/reused secret, must
 * still be rejected rather than trusted blindly). Every failure path
 * throws InvalidTokenError so authenticate.ts can map all of them to one
 * 401 without caring which specific thing was wrong.
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  let decoded: jwt.JwtPayload;
  try {
    const result = jwt.verify(token, env.jwtSecret);
    if (typeof result === 'string') {
      throw new InvalidTokenError('token payload was a raw string, not an object');
    }
    decoded = result;
  } catch (err) {
    if (err instanceof InvalidTokenError) throw err;
    throw new InvalidTokenError(err instanceof Error ? err.message : 'invalid token');
  }

  if (typeof decoded.sub !== 'string' || decoded.sub.length === 0) {
    throw new InvalidTokenError('token payload is missing "sub" (user id)');
  }
  if (typeof decoded.email !== 'string' || decoded.email.length === 0) {
    throw new InvalidTokenError('token payload is missing "email"');
  }
  if (typeof decoded.role !== 'string' || !USER_ROLES.includes(decoded.role as UserRole)) {
    throw new InvalidTokenError(`token payload has an unrecognized role: ${String(decoded.role)}`);
  }

  return { id: decoded.sub, email: decoded.email, role: decoded.role as UserRole };
}
