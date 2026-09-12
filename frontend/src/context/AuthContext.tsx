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
import {
  api,
  ApiError,
  type AuthUser,
  type Membership,
  type MemberRole,
  type Profile,
} from '../lib/api';
import {
  isFieldEmbedMarked,
  rememberFieldEmbedSession,
  waitForParentFieldSession,
  clearFieldEmbedSession,
  postSignOutToFieldCapture,
} from '../lib/fieldEmbed';
import { preferFresherProfile } from '../lib/preferFresherProfile';
import {
  clearSessionTermsAccepted,
  markSessionTermsAccepted,
  publicTermsStatus,
  termsRequired,
  type TermsStatus,
} from '../lib/terms';

function rememberSession(session?: { accessToken?: string; refreshToken?: string } | null): void {
  if (!session?.accessToken && !session?.refreshToken) return;
  rememberFieldEmbedSession(session.accessToken, session.refreshToken);
}

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
  signup: (email: string, password: string, acceptedTermsVersion: string) => Promise<SignupResult>;
  /** Adopt a session the backend just established (e.g. after a password reset). */
  adoptUser: (user: AuthUser) => Promise<Membership | null>;
  logout: () => Promise<void>;
  refreshMembership: () => Promise<Membership | null>;
  /** Publish a profile the user just saved, so the shell re-renders at once. */
  setProfile: (profile: Profile) => void;
  terms: TermsStatus | null;
  termsLoading: boolean;
  needsTermsAcceptance: boolean;
  acceptTerms: (acceptedTermsVersion: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [membershipLoading, setMembershipLoading] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [terms, setTerms] = useState<TermsStatus | null>(null);
  const [termsLoading, setTermsLoading] = useState(false);

  // True once an explicit login/signup/logout has run. The mount-time restore
  // below must never overwrite the result of an explicit action that races it.
  const explicitAuthRef = useRef(false);

  const loadMembership = useCallback(async (): Promise<Membership | null> => {
    setMembershipLoading(true);
    let resolved: Membership | null = null;
    try {
      try {
        const { membership } = await api.getMembership();
        resolved = membership;
      } catch (err) {
        if (err instanceof ApiError && err.code === 'terms_required') {
          resolved = null;
        }
        /* office membership unavailable — Field Capture may still have an org */
      }

      // 200 + null is not an error, so the Field Capture org fallback must
      // run here — not only in catch.
      if (!resolved && isFieldEmbedMarked()) {
        try {
          const field = await api.fieldAppMe();
          if (field.org?.id) {
            const role = (field.org.role as MemberRole | undefined) ?? 'employee';
            resolved = {
              role,
              workType: 'mitigation',
              usageIntents: ['field_work'],
              status: 'active',
              org: { id: field.org.id, name: field.org.name, joinCode: '' },
            };
          }
        } catch {
          resolved = null;
        }
      }

      setMembership(resolved);
    } finally {
      setMembershipLoading(false);
    }

    // Decorative for the shell — never wipe a photo the user just saved in
    // Settings if this GET is still catching up or fails.
    try {
      const { profile: incoming } = await api.getProfile();
      setProfile((current) => preferFresherProfile(current, incoming));
    } catch {
      /* keep the in-memory profile, including a just-uploaded avatar */
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
        const { user, terms: nextTerms } = await api.me();
        if (!cancelled && !explicitAuthRef.current) {
          setUser(user);
          setTerms(nextTerms ?? publicTermsStatus());
          await loadMembership();
        }
      } catch (err) {
        if (!cancelled && !explicitAuthRef.current && isFieldEmbedMarked()) {
          const adopted = await waitForParentFieldSession();
          if (adopted && !cancelled && !explicitAuthRef.current) {
            try {
              const { user, terms: nextTerms } = await api.me();
              if (!cancelled && !explicitAuthRef.current) {
                setUser(user);
                setTerms(nextTerms ?? publicTermsStatus());
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
      const { user, session, terms: nextTerms } = await api.login(email, password);
      rememberSession(session);
      explicitAuthRef.current = true;
      setUser(user);
      setTerms(nextTerms ?? publicTermsStatus());
      return loadMembership();
    },
    [loadMembership],
  );

  const signup = useCallback(
    async (
      email: string,
      password: string,
      acceptedTermsVersion: string,
    ): Promise<SignupResult> => {
      const res = await api.signup(email, password, acceptedTermsVersion);
      // If the project auto-confirms, a session is set and the user is logged in.
      let membership: Membership | null = null;
      setTerms(res.terms ?? publicTermsStatus());
      markSessionTermsAccepted(acceptedTermsVersion);
      if (!res.needsEmailConfirmation && res.user) {
        rememberSession(res.session);
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

  const acceptTerms = useCallback(
    async (acceptedTermsVersion: string) => {
      setTermsLoading(true);
      try {
        const { terms: nextTerms } = await api.acceptTerms(acceptedTermsVersion);
        setTerms(nextTerms);
        markSessionTermsAccepted(acceptedTermsVersion);
        await loadMembership();
      } finally {
        setTermsLoading(false);
      }
    },
    [loadMembership],
  );

  const adoptUser = useCallback(
    async (nextUser: AuthUser) => {
      explicitAuthRef.current = true;
      setUser(nextUser);
      try {
        const { terms: nextTerms } = await api.me();
        setTerms(nextTerms ?? publicTermsStatus());
      } catch {
        setTerms(publicTermsStatus());
      }
      return loadMembership();
    },
    [loadMembership],
  );

  const logout = useCallback(async () => {
    explicitAuthRef.current = true;
    try {
      await api.logout();
    } finally {
      clearFieldEmbedSession();
      clearSessionTermsAccepted();
      postSignOutToFieldCapture();
      setUser(null);
      setMembership(null);
      setProfile(null);
      setTerms(null);
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
      adoptUser,
      logout,
      refreshMembership: loadMembership,
      terms,
      termsLoading,
      needsTermsAcceptance: Boolean(user) && !loading && termsRequired(terms),
      acceptTerms,
    }),
    [
      user,
      loading,
      membership,
      membershipLoading,
      profile,
      login,
      signup,
      adoptUser,
      logout,
      loadMembership,
      terms,
      termsLoading,
      acceptTerms,
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
