import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import * as authApi from '../api/auth';
import { clearToken, getToken, setToken as persistToken } from '../api/client';
import { decodeToken, isTokenExpired } from './decodeToken';
import type { AuthUser, UserRole } from '../api/types';

const ROLE_RANK: Record<UserRole, number> = { USER: 0, OPERATOR: 1, ADMIN: 2 };

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, role?: UserRole) => Promise<void>;
  logout: () => void;
  /** Rank-based, mirroring backend/src/middleware/authorize.ts: ADMIN satisfies an OPERATOR check. UI-gating only, never a real access-control boundary -- see decodeToken.ts. */
  hasRole: (minimum: UserRole) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readStoredUser(): AuthUser | null {
  const token = getToken();
  if (!token) return null;

  const decoded = decodeToken(token);
  if (!decoded || isTokenExpired(decoded.exp)) {
    clearToken();
    return null;
  }
  return { id: decoded.id, email: decoded.email, role: decoded.role };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => readStoredUser());

  const login = useCallback(async (email: string, password: string) => {
    const result = await authApi.login(email, password);
    persistToken(result.token);
    setUser(result.user);
  }, []);

  const register = useCallback(async (email: string, password: string, role?: UserRole) => {
    const result = await authApi.register(email, password, role);
    persistToken(result.token);
    setUser(result.user);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  const hasRole = useCallback(
    (minimum: UserRole) => user !== null && ROLE_RANK[user.role] >= ROLE_RANK[minimum],
    [user]
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, isAuthenticated: user !== null, login, register, logout, hasRole }),
    [user, login, register, logout, hasRole]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth() must be called within an <AuthProvider>');
  }
  return ctx;
}
