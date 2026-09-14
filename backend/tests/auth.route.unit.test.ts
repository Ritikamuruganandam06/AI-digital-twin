import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

/**
 * HTTP-layer tests for POST /api/auth/register and /login with
 * src/services/auth.service.ts mocked -- proves routing/validation
 * without needing real MongoDB or real bcrypt hashing. The real,
 * database-backed round trip is tests/auth.integration.test.ts.
 */

vi.mock('../src/config/database', async () => {
  const actual = await vi.importActual<typeof import('../src/config/database')>('../src/config/database');
  return { ...actual, assertDatabaseConnected: vi.fn() };
});

vi.mock('../src/services/auth.service', () => ({
  register: vi.fn(),
  login: vi.fn(),
}));

import { createApp } from '../src/app';
import { register, login } from '../src/services/auth.service';
import { AppError } from '../src/utils/AppError';

const app = createApp();
const mockedRegister = vi.mocked(register);
const mockedLogin = vi.mocked(login);

const SAMPLE_RESULT = {
  token: 'header.payload.signature',
  user: { id: 'user-1', email: 'ops@example.com', role: 'OPERATOR' as const },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/auth/register', () => {
  it('returns 201 with the token + user on success', async () => {
    mockedRegister.mockResolvedValue(SAMPLE_RESULT);

    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: 'ops@example.com', password: 'correct horse battery' });

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual(SAMPLE_RESULT);
    expect(mockedRegister).toHaveBeenCalledWith({
      email: 'ops@example.com',
      password: 'correct horse battery',
      role: undefined,
    });
  });

  it('passes an explicit role through untouched', async () => {
    mockedRegister.mockResolvedValue(SAMPLE_RESULT);

    await request(app)
      .post('/api/auth/register')
      .send({ email: 'ops@example.com', password: 'correct horse battery', role: 'OPERATOR' });

    expect(mockedRegister).toHaveBeenCalledWith({
      email: 'ops@example.com',
      password: 'correct horse battery',
      role: 'OPERATOR',
    });
  });

  it('rejects a missing email with 400 without calling the service', async () => {
    const response = await request(app).post('/api/auth/register').send({ password: 'correct horse battery' });
    expect(response.status).toBe(400);
    expect(mockedRegister).not.toHaveBeenCalled();
  });

  it('rejects a too-short password with 400', async () => {
    const response = await request(app).post('/api/auth/register').send({ email: 'a@example.com', password: 'short' });
    expect(response.status).toBe(400);
    expect(mockedRegister).not.toHaveBeenCalled();
  });

  it('propagates a 409 from the service for a duplicate email', async () => {
    mockedRegister.mockRejectedValue(new AppError('An account with email "a@example.com" already exists', 409));

    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: 'a@example.com', password: 'correct horse battery' });

    expect(response.status).toBe(409);
  });

  it('checks the database is connected before calling the service', async () => {
    const { assertDatabaseConnected } = await import('../src/config/database');
    vi.mocked(assertDatabaseConnected).mockImplementationOnce(() => {
      throw new AppError('Database is currently unavailable', 503);
    });

    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: 'a@example.com', password: 'correct horse battery' });

    expect(response.status).toBe(503);
    expect(mockedRegister).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/login', () => {
  it('returns 200 with the token + user on success', async () => {
    mockedLogin.mockResolvedValue(SAMPLE_RESULT);

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ops@example.com', password: 'correct horse battery' });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(SAMPLE_RESULT);
  });

  it('propagates a 401 from the service for bad credentials', async () => {
    mockedLogin.mockRejectedValue(new AppError('Invalid email or password', 401));

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ops@example.com', password: 'wrong-password' });

    expect(response.status).toBe(401);
  });

  it('rejects a missing password with 400 without calling the service', async () => {
    const response = await request(app).post('/api/auth/login').send({ email: 'ops@example.com' });
    expect(response.status).toBe(400);
    expect(mockedLogin).not.toHaveBeenCalled();
  });
});
