import { signAccessToken, type UserRole } from '../../src/utils/jwt';

/**
 * Signs a REAL JWT using src/utils/jwt.ts's own signAccessToken() -- the
 * exact function src/services/auth.service.ts calls on a genuine
 * register/login. Every test that uses this helper is exercising real
 * signing and (via src/middleware/authenticate.ts) real verification, not
 * a bypass or a mocked middleware.
 *
 * No database user needs to exist for this to work: authenticate.ts is
 * stateless (see jwt.ts's own doc comment) -- it trusts a validly signed
 * token's payload without a lookup, so these tests can exercise
 * "authenticated as a given role" without the overhead of a real
 * register+login HTTP round trip for every request in every unrelated
 * test file. tests/auth.integration.test.ts is what proves the full
 * register -> login -> real token -> protected route path end to end.
 *
 * env.jwtSecret here is whatever JWT_SECRET resolves to in this test
 * process (the .env.example local-dev placeholder unless overridden) --
 * never a real production secret, consistent with this project's standing
 * "never print/expose a real secret" rule (which this isn't one of).
 */
let counter = 0;

export function signTestToken(role: UserRole = 'USER', overrides: { id?: string; email?: string } = {}): string {
  counter += 1;
  return signAccessToken({
    id: overrides.id ?? `test-user-${counter}`,
    email: overrides.email ?? `test-user-${counter}@example.com`,
    role,
  });
}

/** Ready to pass straight to supertest's `.set(...)` (which accepts a headers object). */
export function authHeader(role: UserRole = 'USER', overrides?: { id?: string; email?: string }): Record<string, string> {
  return { Authorization: `Bearer ${signTestToken(role, overrides)}` };
}
