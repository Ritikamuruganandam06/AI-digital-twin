import { describe, expect, it } from 'vitest';
import { decodeToken, isTokenExpired } from '../../src/auth/decodeToken';

function makeToken(payload: Record<string, unknown>): string {
  const base64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${base64url({ alg: 'HS256' })}.${base64url(payload)}.signature-not-checked-client-side`;
}

describe('decodeToken', () => {
  it('decodes a well-formed payload', () => {
    const token = makeToken({ sub: 'u1', email: 'a@b.com', role: 'OPERATOR', exp: 9999999999 });
    expect(decodeToken(token)).toEqual({ id: 'u1', email: 'a@b.com', role: 'OPERATOR', exp: 9999999999 });
  });

  it('returns null for a malformed token', () => {
    expect(decodeToken('not-a-jwt')).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    expect(decodeToken(makeToken({ sub: 'u1' }))).toBeNull();
  });

  it('returns null for an invalid role', () => {
    expect(decodeToken(makeToken({ sub: 'u1', email: 'a@b.com', role: 'SUPERUSER' }))).toBeNull();
  });

  it('omits exp when absent rather than throwing', () => {
    const token = makeToken({ sub: 'u1', email: 'a@b.com', role: 'USER' });
    expect(decodeToken(token)?.exp).toBeUndefined();
  });
});

describe('isTokenExpired', () => {
  it('treats an undefined exp as never expired', () => {
    expect(isTokenExpired(undefined)).toBe(false);
  });

  it('is true once exp is in the past', () => {
    expect(isTokenExpired(Math.floor(Date.now() / 1000) - 10)).toBe(true);
  });

  it('is false while exp is in the future', () => {
    expect(isTokenExpired(Math.floor(Date.now() / 1000) + 3600)).toBe(false);
  });
});
