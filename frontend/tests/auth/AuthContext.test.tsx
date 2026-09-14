import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../../src/auth/AuthContext';
import { getToken } from '../../src/api/client';
import * as authApi from '../../src/api/auth';

vi.mock('../../src/api/auth');

function makeToken(payload: Record<string, unknown>): string {
  const base64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${base64url({ alg: 'HS256' })}.${base64url(payload)}.sig`;
}

/** A small consumer that exercises every AuthContext capability through the DOM, since useAuth() must be called inside a provider. */
function Consumer() {
  const { user, isAuthenticated, login, logout, hasRole } = useAuth();
  return (
    <div>
      <div data-testid="user">{user ? `${user.email}:${user.role}` : 'anonymous'}</div>
      <div data-testid="authed">{String(isAuthenticated)}</div>
      <div data-testid="can-operate">{String(hasRole('OPERATOR'))}</div>
      <button onClick={() => login('op@example.com', 'password123')}>Log in</button>
      <button onClick={() => logout()}>Log out</button>
    </div>
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(authApi.login).mockReset();
  });

  it('starts anonymous with no stored token', () => {
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );
    expect(screen.getByTestId('user')).toHaveTextContent('anonymous');
    expect(screen.getByTestId('authed')).toHaveTextContent('false');
  });

  it('logs in, persists the token, and exposes the role-ranked hasRole()', async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      token: makeToken({ sub: 'u1', email: 'op@example.com', role: 'OPERATOR', exp: Math.floor(Date.now() / 1000) + 3600 }),
      user: { id: 'u1', email: 'op@example.com', role: 'OPERATOR' },
    });

    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    await user.click(screen.getByText('Log in'));

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('op@example.com:OPERATOR'));
    expect(screen.getByTestId('can-operate')).toHaveTextContent('true');
    expect(getToken()).not.toBeNull();
  });

  it('logs out and clears the stored token', async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      token: makeToken({ sub: 'u1', email: 'a@b.com', role: 'USER', exp: Math.floor(Date.now() / 1000) + 3600 }),
      user: { id: 'u1', email: 'a@b.com', role: 'USER' },
    });

    const user = userEvent.setup();
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    await user.click(screen.getByText('Log in'));
    await waitFor(() => expect(screen.getByTestId('authed')).toHaveTextContent('true'));

    await user.click(screen.getByText('Log out'));
    expect(screen.getByTestId('authed')).toHaveTextContent('false');
    expect(getToken()).toBeNull();
  });

  it('restores a valid session from a stored, unexpired token on mount', () => {
    act(() => {
      localStorage.setItem(
        'ai-digital-twin:token',
        makeToken({ sub: 'u1', email: 'stored@example.com', role: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 3600 })
      );
    });

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    expect(screen.getByTestId('user')).toHaveTextContent('stored@example.com:ADMIN');
  });

  it('discards an expired stored token instead of restoring a session', () => {
    act(() => {
      localStorage.setItem(
        'ai-digital-twin:token',
        makeToken({ sub: 'u1', email: 'stale@example.com', role: 'USER', exp: Math.floor(Date.now() / 1000) - 10 })
      );
    });

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    expect(screen.getByTestId('authed')).toHaveTextContent('false');
    expect(getToken()).toBeNull();
  });
});
