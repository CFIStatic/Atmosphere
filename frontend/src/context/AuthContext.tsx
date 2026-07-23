import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError, type AuthUser } from '../lib/api';

interface SignupResult {
  needsEmailConfirmation: boolean;
  message?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean; // true while restoring the session on first load
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<SignupResult>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // True once an explicit login/signup/logout has run. The mount-time restore
  // below must never overwrite the result of an explicit action that races it.
  const explicitAuthRef = useRef(false);

  // On mount, try to restore an existing session from the httpOnly cookie.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { user } = await api.me();
        if (!cancelled && !explicitAuthRef.current) setUser(user);
      } catch (err) {
        // 401 simply means "not logged in" — anything else we also treat as
        // logged-out but leave the console note for debugging.
        if (!cancelled && !explicitAuthRef.current) setUser(null);
        if (err instanceof ApiError && err.status !== 401 && err.status !== 0) {
          // eslint-disable-next-line no-console
          console.warn('Session restore failed:', err.message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { user } = await api.login(email, password);
    explicitAuthRef.current = true;
    setUser(user);
  }, []);

  const signup = useCallback(async (email: string, password: string): Promise<SignupResult> => {
    const res = await api.signup(email, password);
    // If the project auto-confirms, a session is set and the user is logged in.
    if (!res.needsEmailConfirmation && res.user) {
      explicitAuthRef.current = true;
      setUser(res.user);
    }
    return { needsEmailConfirmation: Boolean(res.needsEmailConfirmation), message: res.message };
  }, []);

  const logout = useCallback(async () => {
    explicitAuthRef.current = true;
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, signup, logout }),
    [user, loading, login, signup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
