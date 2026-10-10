import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { forgetHomeownerCache } from '../lib/homeownerPortal';
import { HOMEOWNER_HUB_PATH } from '../lib/homeownerHub';
import { homeownerLoginHref } from '../lib/homeownerLogin';
import { useAuth } from '../context/AuthContext';
import { Logo } from '../components/Logo';
import { SpinnerIcon } from '../components/icons';

/**
 * A homeowner's share link (/progress/:token, or the emailed sign-in link
 * /progress/:token?signin=…). There is no separate guest page any more:
 *
 * - signed in as the invited email → claim the share, open the job in the portal
 * - emailed sign-in link → verify, claim, open the job in the portal
 * - signed out → the same sign-in page contractors use, email prefilled,
 *   "Email me a link" offered
 * - signed in as someone else → say so, offer to switch accounts
 *
 * The server checks the email against the invite on every claim.
 */
export function ShareLinkGate() {
  const { token = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading, adoptUser, logout } = useAuth();
  const [emailSignIn] = useState(() => {
    const hash = searchParams.get('signin');
    const kind = searchParams.get('kind') === 'invite' ? 'invite' : 'magiclink';
    return hash ? { tokenHash: hash, kind: kind as 'magiclink' | 'invite' } : null;
  });
  const [invite, setInvite] = useState<{ recipientEmail: string | null; orgName: string; jobTitle: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  // Emailed link: verify, claim, open the job.
  useEffect(() => {
    if (!emailSignIn || !token || started.current) return;
    started.current = true;
    if (typeof window !== 'undefined') window.history.replaceState(window.history.state, '', `/progress/${encodeURIComponent(token)}`);
    void (async () => {
      try {
        const res = await api.progressShareVerifyEmailSignIn(token, emailSignIn);
        forgetHomeownerCache();
        await adoptUser(res.user);
        navigate(res.path, { replace: true });
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'That sign-in link did not work. Send a new one.');
      }
    })();
  }, [emailSignIn, token, adoptUser, navigate]);

  useEffect(() => {
    if (emailSignIn || !token) return;
    let cancelled = false;
    api
      .progressShareInvite(token)
      .then((data) => !cancelled && setInvite(data))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : 'This link is not valid.'));
    return () => {
      cancelled = true;
    };
  }, [token, emailSignIn]);

  const invited = invite?.recipientEmail?.trim().toLowerCase() || null;
  const sessionEmail = user?.email?.trim().toLowerCase() || null;
  const matches = Boolean(user && invited && sessionEmail === invited);

  // Already signed in as the invitee: straight to the job.
  useEffect(() => {
    if (authLoading || !matches || started.current) return;
    started.current = true;
    void api
      .claimProgressShare(token)
      .then((res) => {
        forgetHomeownerCache();
        navigate(res.path, { replace: true });
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not open this job.'));
  }, [authLoading, matches, token, navigate]);

  if (error) {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold text-ink-900">Link unavailable</h1>
        <p className="mt-3 text-ink-600">{error}</p>
        <a href={user ? HOMEOWNER_HUB_PATH : homeownerLoginHref(token, invited)} className="mt-6 inline-block font-semibold text-brand-600">
          {user ? 'Go to your dashboard' : 'Sign in'}
        </a>
      </Shell>
    );
  }

  if (emailSignIn || authLoading || !invite || matches) {
    return (
      <div className="grid min-h-screen place-items-center bg-paper-100 text-brand-600" data-testid="share-gate-loading">
        <SpinnerIcon className="animate-spin" width={28} height={28} />
      </div>
    );
  }

  if (!user) return <Navigate to={homeownerLoginHref(token, invited)} replace />;

  return (
    <Shell>
      <h1 className="text-2xl font-semibold text-ink-900">This job was shared with another email</h1>
      <p className="mt-3 text-ink-600" data-testid="share-gate-mismatch">
        {invite.orgName} shared this job with <span className="font-medium text-ink-900">{invite.recipientEmail}</span>.
        You&apos;re signed in as <span className="font-medium text-ink-900">{user.email}</span>.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={async () => {
            await logout();
            navigate(homeownerLoginHref(token, invited), { replace: true });
          }}
          className="rounded-lg bg-brand-500 px-4 py-2.5 font-semibold text-ink-900"
        >
          Switch to {invite.recipientEmail}
        </button>
        <a href={HOMEOWNER_HUB_PATH} className="rounded-lg border border-line px-4 py-2.5 font-medium text-ink-800">
          Stay signed in
        </a>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="cx-aurora min-h-screen bg-paper-100">
      <div className="mx-auto max-w-xl px-6 py-20 text-center">
        <Logo to={null} />
        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}
