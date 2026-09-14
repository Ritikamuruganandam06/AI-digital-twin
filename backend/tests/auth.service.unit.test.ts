import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for src/services/auth.service.ts with userRepository mocked
 * (no MongoDB needed) but bcryptjs and jsonwebtoken used FOR REAL -- both
 * are pure libraries, not infrastructure, so there's no reason to mock
 * them, and doing so would hide the one thing worth actually proving here:
 * that register()/login() produce a real bcrypt hash (never the plaintext
 * password) and a real, independently-verifiable JWT. The real, database-
 * backed round trip (register -> login -> protected route) is
 * tests/auth.integration.test.ts.
 */

vi.mock('../src/repositories/user.repository', () => ({
  userRepository: { findByEmail: vi.fn(), create: vi.fn() },
}));

import bcrypt from 'bcryptjs';
import { userRepository, type UserRecord } from '../src/repositories/user.repository';
import { register, login } from '../src/services/auth.service';
import { verifyAccessToken } from '../src/utils/jwt';
import { AppError } from '../src/utils/AppError';

const mockedFindByEmail = vi.mocked(userRepository.findByEmail);
const mockedCreate = vi.mocked(userRepository.create);

function fakeUserRecord(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'user-1',
    email: 'ops@example.com',
    passwordHash: 'x',
    role: 'USER',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('register', () => {
  it('hashes the password with real bcrypt (never stores it in plaintext) and returns a real, verifiable JWT', async () => {
    mockedFindByEmail.mockResolvedValue(null);
    mockedCreate.mockImplementation(async (input) =>
      fakeUserRecord({ id: 'user-1', email: input.email, passwordHash: input.passwordHash, role: input.role })
    );

    const result = await register({ email: 'Ops@Example.com', password: 'correct horse battery' });

    expect(mockedCreate).toHaveBeenCalledOnce();
    const createdInput = mockedCreate.mock.calls[0][0];
    expect(createdInput.email).toBe('ops@example.com'); // lowercased/trimmed
    expect(createdInput.passwordHash).not.toBe('correct horse battery');
    expect(createdInput.passwordHash.startsWith('$2')).toBe(true); // a real bcrypt hash
    expect(await bcrypt.compare('correct horse battery', createdInput.passwordHash)).toBe(true);

    // verifyAccessToken is NOT mocked -- this is real jwt.verify() against
    // a real jwt.sign() output.
    const payload = verifyAccessToken(result.token);
    expect(payload).toEqual({ id: 'user-1', email: 'ops@example.com', role: 'USER' });
    expect(result.user).toEqual({ id: 'user-1', email: 'ops@example.com', role: 'USER' });
  });

  it('defaults role to USER but accepts an explicit valid role', async () => {
    mockedFindByEmail.mockResolvedValue(null);
    mockedCreate.mockImplementation(async (input) =>
      fakeUserRecord({ id: 'user-2', email: input.email, passwordHash: input.passwordHash, role: input.role })
    );

    const result = await register({ email: 'op2@example.com', password: 'correct horse battery', role: 'OPERATOR' });

    expect(result.user.role).toBe('OPERATOR');
    expect(mockedCreate).toHaveBeenCalledWith(expect.objectContaining({ role: 'OPERATOR' }));
  });

  it('rejects an unrecognized role with 400 before ever touching the repository', async () => {
    await expect(
      register({ email: 'x@example.com', password: 'correct horse battery', role: 'SUPERUSER' as never })
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(mockedFindByEmail).not.toHaveBeenCalled();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('rejects a duplicate email with 409 without hashing or writing anything', async () => {
    mockedFindByEmail.mockResolvedValue(fakeUserRecord({ email: 'dup@example.com' }));

    await expect(register({ email: 'dup@example.com', password: 'correct horse battery' })).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});

describe('login', () => {
  it('returns a real token when the password matches the real stored bcrypt hash', async () => {
    const passwordHash = await bcrypt.hash('correct horse battery', 10);
    mockedFindByEmail.mockResolvedValue(fakeUserRecord({ id: 'user-9', email: 'ops@example.com', passwordHash, role: 'OPERATOR' }));

    const result = await login({ email: 'ops@example.com', password: 'correct horse battery' });

    expect(result.user).toEqual({ id: 'user-9', email: 'ops@example.com', role: 'OPERATOR' });
    const payload = verifyAccessToken(result.token);
    expect(payload.role).toBe('OPERATOR');
  });

  it('rejects a wrong password and an unknown email with the same 401 message', async () => {
    const passwordHash = await bcrypt.hash('correct horse battery', 10);
    mockedFindByEmail.mockResolvedValueOnce(fakeUserRecord({ email: 'ops@example.com', passwordHash }));

    let wrongPasswordErr: AppError | undefined;
    try {
      await login({ email: 'ops@example.com', password: 'not-it' });
    } catch (err) {
      wrongPasswordErr = err as AppError;
    }

    mockedFindByEmail.mockResolvedValueOnce(null);
    let unknownEmailErr: AppError | undefined;
    try {
      await login({ email: 'nobody@example.com', password: 'anything' });
    } catch (err) {
      unknownEmailErr = err as AppError;
    }

    expect(wrongPasswordErr?.statusCode).toBe(401);
    expect(unknownEmailErr?.statusCode).toBe(401);
    expect(wrongPasswordErr?.message).toBe(unknownEmailErr?.message);
  });
});
