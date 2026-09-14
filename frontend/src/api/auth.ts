import { apiFetch } from './client';
import type { AuthResult, UserRole } from './types';

export function login(email: string, password: string): Promise<AuthResult> {
  return apiFetch<AuthResult>('/api/auth/login', {
    method: 'POST',
    body: { email, password },
    skipAuth: true,
  });
}

export function register(email: string, password: string, role?: UserRole): Promise<AuthResult> {
  return apiFetch<AuthResult>('/api/auth/register', {
    method: 'POST',
    body: { email, password, role },
    skipAuth: true,
  });
}
