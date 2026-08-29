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
import { api, ApiError, type AuthUser, type Membership, type Profile } from '../lib/api';
import { isFieldEmbedMarked, waitForParentFieldSession } from '../lib/fieldEmbed';

interface SignupResult {
  needsEmailConfirmation: boolean;
  message?: string;
  membership: Membership | null;
  user: AuthUser | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean; // true while restoring the session on first load
  membership: Membership | null; // null = not yet onboarded into an org
  membershipLoading: boolean; // true while resolving membership for a known user
  profile: Profile | null; // display name etc.; null until loaded
  login: (email: string, password: string) => Promise<Membership | null>;
  signup: (email: string, password: string) => Promise<SignupResult>;
  unlockWithPin: (pin: string) => Promise<Membership | null>;
  /** Adopt a session the backend just established (e.g. after a password reset). */
  adoptUser: (user: AuthUser) => Promise<Membership | null>;
  logout: () => Promise<void>;
  refreshMembership: () => Promise<Membership | null>;
  /** Publish a profile the user just saved, so the shell re-renders at once. */
  setProfile: (profile: Profile) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [membershipLoading, setMembershipLoading] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);

  // True once an explicit login/signup/logout has run. The mount-time restore
  // below must never overwrite the result of an explicit action that races it.
  const explicitAuthRef = useRef(false);

  const loadMembership = useCallback(async (): Promise<Membership | null> => {
    setMembershipLoading(true);
    let resolved: Membership | null = null;
    try {
      const { membership } = await api.getMembership();
      resolved = membership;
      setMembership(membership);
    } catch {
      // Treat any failure as "not onboarded"; the onboarding flow will re-check.
      setMembership(null);
    } finally {
      setMembershipLoading(false);
    }

    // The profile is decorative (a display name for the shell), so it is fetched
    // after membership has already settled routing and never blocks on it.
    try {
      const { profile } = await api.getProfile();
      setProfile(profile);
    } catch {
      setProfile(null);
    }

    return resolved;
  }, []);

  // On mount, try to restore an existing session from the httpOnly cookie.
  // Inside Field Capture, wait for the phone's tokens before showing login —
  // one sign-in covers both Field Capture and the in-app Platform.
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
        if (!cancelled && !explicitAuthRef.current && isFieldEmbedMarked()) {
          const adopted = await waitForParentFieldSession();
          if (adopted && !cancelled && !explicitAuthRef.current) {
            try {
              const { user } = await api.me();
              if (!cancelled && !explicitAuthRef.current) {
                setUser(user);
                await loadMembership();
                return;
              }
            } catch {
              /* parent posted tokens that the office could not adopt */
            }
          }
        }
        if (!cancelled && !explicitAuthRef.current) setUser(null);
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
  }, [loadMembership]);

  const login = useCallback(
    async (email: string, password: string) => {
      const { user } = await api.login(email, password);
      explicitAuthRef.current = true;
      setUser(user);
      return loadMembership();
    },
    [loadMembership],
  );

  const signup = useCallback(
    async (email: string, password: string): Promise<SignupResult> => {
      const res = await api.signup(email, password);
      // If the project auto-confirms, a session is set and the user is logged in.
      let membership: Membership | null = null;
      if (!res.needsEmailConfirmation && res.user) {
        explicitAuthRef.current = true;
        setUser(res.user);
        membership = await loadMembership();
      }
      return {
        needsEmailConfirmation: Boolean(res.needsEmailConfirmation),
        message: res.message,
        membership,
        user: res.user ?? null,
      };
    },
    [loadMembership],
  );

  const unlockWithPin = useCallback(
    async (pin: string) => {
      const { user } = await api.pinUnlock(pin);
      explicitAuthRef.current = true;
      setUser(user);
      return loadMembership();
    },
    [loadMembership],
  );

  const adoptUser = useCallback(
    async (nextUser: AuthUser) => {
      explicitAuthRef.current = true;
      setUser(nextUser);
      return loadMembership();
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
      setProfile(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      membership,
      membershipLoading,
      profile,
      setProfile,
      login,
      signup,
      unlockWithPin,
      adoptUser,
      logout,
      refreshMembership: loadMembership,
    }),
    [
      user,
      loading,
      membership,
      membershipLoading,
      profile,
      login,
      signup,
      unlockWithPin,
      adoptUser,
      logout,
      loadMembership,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
