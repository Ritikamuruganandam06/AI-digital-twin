import type { AuthUser, UserRole } from '../api/types';

/**
 * Decodes (never verifies) a JWT's payload for display/UI-gating
 * purposes only -- e.g. showing the logged-in email, or hiding an
 * OPERATOR-only button from a USER. This is NOT a security boundary: the
 * backend's own `src/middleware/authenticate.ts` is what actually
 * verifies the signature on every request, and a USER who edits this
 * decoded value in devtools gains nothing, since every privileged
 * endpoint re-checks the real token server-side
 * (`src/middleware/authorize.ts`). Hiding a button here is a UX
 * convenience, not an access-control mechanism.
 */
export function decodeToken(token: string): (AuthUser & { exp?: number }) | null {
  try {
    const [, payloadPart] = token.split('.');
    if (!payloadPart) return null;

    // JWTs use base64url (RFC 4648 §5): '-'/'_' instead of '+'/'/', no padding.
    const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const json = atob(padded);
    const payload = JSON.parse(json) as { sub?: unknown; email?: unknown; role?: unknown; exp?: unknown };

    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string' || typeof payload.role !== 'string') {
      return null;
    }
    if (!['USER', 'OPERATOR', 'ADMIN'].includes(payload.role)) {
      return null;
    }

    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role as UserRole,
      exp: typeof payload.exp === 'number' ? payload.exp : undefined,
    };
  } catch {
    return null;
  }
}

export function isTokenExpired(exp: number | undefined): boolean {
  if (exp === undefined) return false;
  return Date.now() >= exp * 1000;
}
