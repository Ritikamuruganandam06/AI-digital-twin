import { describe, it, expect } from 'vitest';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { authenticate } from '../src/middleware/authenticate';
import { authorize } from '../src/middleware/authorize';
import { signAccessToken } from '../src/utils/jwt';
import { env } from '../src/config/env';
import { AppError } from '../src/utils/AppError';
import type { UserRole } from '../src/utils/jwt';

/**
 * Unit tests for the two Phase 15 middleware functions, called directly
 * (not through supertest) so each failure path can be asserted precisely
 * without going through a whole Express app. The real, full-stack proof
 * (a genuine HTTP request rejected/accepted through the actual app) is
 * tests/auth.integration.test.ts.
 */

function fakeRequest(headers: Record<string, string> = {}): Request {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    header: (name: string) => lower[name.toLowerCase()],
  } as unknown as Request;
}

function fakeRequestWithUser(role?: UserRole): Request {
  return { user: role ? { id: 'u1', email: 'a@example.com', role } : undefined } as unknown as Request;
}

function runMiddleware(
  mw: (req: Request, res: Response, next: (err?: unknown) => void) => void,
  req: Request
): unknown {
  let capturedErr: unknown = 'next-not-called';
  mw(req, {} as Response, (err?: unknown) => {
    capturedErr = err;
  });
  return capturedErr;
}

describe('authenticate', () => {
  it('attaches req.user from a validly signed token and calls next() with no error', () => {
    const token = signAccessToken({ id: 'u1', email: 'a@example.com', role: 'ADMIN' });
    const req = fakeRequest({ Authorization: `Bearer ${token}` });

    const err = runMiddleware(authenticate, req);

    expect(err).toBeUndefined();
    expect(req.user).toEqual({ id: 'u1', email: 'a@example.com', role: 'ADMIN' });
  });

  it('rejects a missing Authorization header with 401', () => {
    const err = runMiddleware(authenticate, fakeRequest());
    expect((err as AppError).statusCode).toBe(401);
  });

  it('rejects a header without the Bearer scheme with 401', () => {
    const err = runMiddleware(authenticate, fakeRequest({ Authorization: 'Basic dXNlcjpwYXNz' }));
    expect((err as AppError).statusCode).toBe(401);
  });

  it('rejects a garbage token with 401, not a crash', () => {
    const err = runMiddleware(authenticate, fakeRequest({ Authorization: 'Bearer not-a-real-jwt' }));
    expect((err as AppError).statusCode).toBe(401);
  });

  it('rejects an expired token with 401', () => {
    const expiredToken = jwt.sign({ email: 'a@example.com', role: 'USER' }, env.jwtSecret, {
      subject: 'u1',
      expiresIn: -10, // already expired 10 seconds ago
    });

    const err = runMiddleware(authenticate, fakeRequest({ Authorization: `Bearer ${expiredToken}` }));
    expect((err as AppError).statusCode).toBe(401);
  });

  it('rejects a token whose role claim is not one of USER/OPERATOR/ADMIN with 401', () => {
    const badRoleToken = jwt.sign({ email: 'a@example.com', role: 'SUPERUSER' }, env.jwtSecret, { subject: 'u1' });

    const err = runMiddleware(authenticate, fakeRequest({ Authorization: `Bearer ${badRoleToken}` }));
    expect((err as AppError).statusCode).toBe(401);
  });

  it('rejects a token signed with the wrong secret with 401', () => {
    const wrongSecretToken = jwt.sign({ email: 'a@example.com', role: 'USER' }, 'a-different-secret-entirely', {
      subject: 'u1',
    });

    const err = runMiddleware(authenticate, fakeRequest({ Authorization: `Bearer ${wrongSecretToken}` }));
    expect((err as AppError).statusCode).toBe(401);
  });
});

describe('authorize', () => {
  it('allows a role exactly at the minimum', () => {
    const err = runMiddleware(authorize('OPERATOR'), fakeRequestWithUser('OPERATOR'));
    expect(err).toBeUndefined();
  });

  it('allows a role above the minimum (ADMIN satisfies an OPERATOR requirement)', () => {
    const err = runMiddleware(authorize('OPERATOR'), fakeRequestWithUser('ADMIN'));
    expect(err).toBeUndefined();
  });

  it('rejects a role below the minimum with 403', () => {
    const err = runMiddleware(authorize('OPERATOR'), fakeRequestWithUser('USER'));
    expect((err as AppError).statusCode).toBe(403);
  });

  it('rejects when req.user is missing with 401, not a crash (authenticate should already have set it)', () => {
    const err = runMiddleware(authorize('USER'), fakeRequestWithUser(undefined));
    expect((err as AppError).statusCode).toBe(401);
  });
});
