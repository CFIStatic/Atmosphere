/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError } from '../lib/api';
import type {
  AnalyticsAccess,
  AuthUser,
  StaffChallengeResponse,
  StaffIdentity,
  StaffVerify,
} from '../lib/types';

interface AuthValue {
  user: AuthUser | null;
  access: AnalyticsAccess | null;
  loading: boolean;
  startSignIn: (input: StaffIdentity) => Promise<StaffChallengeResponse>;
  login: (input: StaffVerify) => Promise<void>;
  logout: () => Promise<void>;
  loadAccess: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [access, setAccess] = useState<AnalyticsAccess | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAccess = useCallback(async () => {
    const next = await api.access();
    setAccess(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { user: next } = await api.me();
        if (cancelled) return;
        setUser(next);
        await loadAccess();
      } catch (err) {
        if (!cancelled) {
          setUser(null);
          setAccess(null);
        }
        if (err instanceof ApiError && err.status !== 401 && err.status !== 0) {
          console.warn('Session restore failed:', err.message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAccess]);

  const startSignIn = useCallback(
    (input: StaffIdentity) => api.startSignIn(input),
    [],
  );

  const login = useCallback(
    async (input: StaffVerify) => {
      const { user: next } = await api.login(input);
      setUser(next);
      await loadAccess();
    },
    [loadAccess],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* cookies already gone */
    }
    setUser(null);
    setAccess(null);
  }, []);

  const value = useMemo(
    () => ({ user, access, loading, startSignIn, login, logout, loadAccess }),
    [user, access, loading, startSignIn, login, logout, loadAccess],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
