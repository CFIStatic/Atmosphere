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
import { api, ApiError, DEMO_USER } from '../lib/api';
import { disableSessionDemo, isDemoMode } from '../lib/demoMode';
import type { AnalyticsAccess, AuthUser } from '../lib/types';

interface AuthValue {
  user: AuthUser | null;
  access: AnalyticsAccess | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  enterDemo: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [access, setAccess] = useState<AnalyticsAccess | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAccess = useCallback(async () => {
    if (isDemoMode()) {
      setAccess({ scope: 'internal', displayName: 'Jack Cyganiak' });
      return;
    }
    const next = await api.access();
    setAccess(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (isDemoMode()) {
          if (!cancelled) {
            setUser(DEMO_USER);
            setAccess({ scope: 'internal', displayName: 'Jack Cyganiak' });
          }
          return;
        }
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

  const login = useCallback(
    async (email: string, password: string) => {
      const { user: next } = await api.login(email, password);
      setUser(next);
      await loadAccess();
    },
    [loadAccess],
  );

  const enterDemo = useCallback(() => {
    setUser(DEMO_USER);
    setAccess({ scope: 'internal', displayName: 'Jack Cyganiak' });
  }, []);

  const logout = useCallback(async () => {
    disableSessionDemo();
    if (!isDemoMode()) {
      try {
        await api.logout();
      } catch {
        /* cookies already gone */
      }
    }
    setUser(null);
    setAccess(null);
  }, []);

  const value = useMemo(
    () => ({ user, access, loading, login, enterDemo, logout }),
    [user, access, loading, login, enterDemo, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
