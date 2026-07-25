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
import { api, ApiError, type AuthUser, type Membership } from '../lib/api';

interface SignupResult {
  needsEmailConfirmation: boolean;
  message?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean; // true while restoring the session on first load
  membership: Membership | null; // null = not yet onboarded into an org
  membershipLoading: boolean; // true while resolving membership for a known user
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<SignupResult>;
  logout: () => Promise<void>;
  refreshMembership: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [membershipLoading, setMembershipLoading] = useState(false);

  // True once an explicit login/signup/logout has run. The mount-time restore
  // below must never overwrite the result of an explicit action that races it.
  const explicitAuthRef = useRef(false);

  const loadMembership = useCallback(async () => {
    setMembershipLoading(true);
    try {
      const { membership } = await api.getMembership();
      setMembership(membership);
    } catch {
      // Treat any failure as "not onboarded"; the onboarding flow will re-check.
      setMembership(null);
    } finally {
      setMembershipLoading(false);
    }
  }, []);

  // On mount, try to restore an existing session from the httpOnly cookie.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { user } = await api.me();
        if (!cancelled && !explicitAuthRef.current) {
          setUser(user);
          await loadMembership();
        }
      } catch (err) {
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
  }, [loadMembership]);

  const login = useCallback(
    async (email: string, password: string) => {
      const { user } = await api.login(email, password);
      explicitAuthRef.current = true;
      setUser(user);
      await loadMembership();
    },
    [loadMembership],
  );

  const signup = useCallback(
    async (email: string, password: string): Promise<SignupResult> => {
      const res = await api.signup(email, password);
      // If the project auto-confirms, a session is set and the user is logged in.
      if (!res.needsEmailConfirmation && res.user) {
        explicitAuthRef.current = true;
        setUser(res.user);
        await loadMembership();
      }
      return { needsEmailConfirmation: Boolean(res.needsEmailConfirmation), message: res.message };
    },
    [loadMembership],
  );

  const logout = useCallback(async () => {
    explicitAuthRef.current = true;
    try {
      await api.logout();
    } finally {
      setUser(null);
      setMembership(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      membership,
      membershipLoading,
      login,
      signup,
      logout,
      refreshMembership: loadMembership,
    }),
    [user, loading, membership, membershipLoading, login, signup, logout, loadMembership],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
