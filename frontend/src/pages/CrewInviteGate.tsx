import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { forgetHomeownerCache } from '../lib/homeownerPortal';
import { HOMEOWNER_HUB_PATH } from '../lib/homeownerHub';
import { jobShareTokenFromRoute } from '../lib/jobSharePath';
import { crewInviteLoginHref } from '../lib/crewInvite';
import { useAuth } from '../context/AuthContext';
import { Logo } from '../components/Logo';
import { SpinnerIcon } from '../components/icons';

/**
 * A subcontractor's invite link (/invite/:token), from Share > Subcontractor
 * or crew. Same flow as the homeowner's link, but a real account:
 *
 * - signed out → the contractor sign-in page (email prefilled, password,
 *   Create an account), then back here
 * - signed in as the invited email → claim, open the job (it also stays on
 *   their Dashboard, marked Shared by <company>)
 * - signed in as someone else → say so, offer to switch
 */
export function CrewInviteGate() {
  const params = useParams();
  const token = jobShareTokenFromRoute(params);
  const navigate = useNavigate();
  const { user, loading: authLoading, logout } = useAuth();
  const [invite, setInvite] = useState<{ recipientEmail: string | null; orgName: string; jobTitle: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!token) {
      setError('This link is not valid.');
      return;
    }
    let cancelled = false;
    api
      .crewInviteInfo(token)
      .then((data) => !cancelled && setInvite(data))
      .catch((err) => {
        if (cancelled) return;
        const gone = err instanceof ApiError && ['revoked', 'job_deleted'].includes(err.code);
        setError(
          err instanceof ApiError
            ? gone
              ? `${err.message} Ask your contractor to invite you again.`
              : err.message
            : 'This link is not valid.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const invited = invite?.recipientEmail?.trim().toLowerCase() || null;
  const sessionEmail = user?.email?.trim().toLowerCase() || null;
  const matches = Boolean(user && invited && sessionEmail === invited);

  useEffect(() => {
    if (authLoading || !matches || started.current) return;
    started.current = true;
    void api
      .claimCrewInvite(token)
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
        <p className="mt-3 text-ink-600" data-testid="crew-invite-error">{error}</p>
        <a href={user ? HOMEOWNER_HUB_PATH : '/login'} className="mt-6 inline-block font-semibold text-brand-600">
          {user ? 'Go to your dashboard' : 'Sign in'}
        </a>
      </Shell>
    );
  }

  if (authLoading || !invite || matches) {
    return (
      <div className="grid min-h-screen place-items-center bg-paper-100 text-brand-600" data-testid="crew-invite-loading">
        <SpinnerIcon className="animate-spin" width={28} height={28} />
      </div>
    );
  }

  if (!invited) {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold text-ink-900">Ask for an email invite</h1>
        <p className="mt-3 text-ink-600">
          {invite.orgName} invited you without an email address. Ask them to invite you by email so the job joins your account.
        </p>
      </Shell>
    );
  }

  if (!user) return <Navigate to={crewInviteLoginHref(token, invited)} replace />;

  return (
    <Shell>
      <h1 className="text-2xl font-semibold text-ink-900">This job was shared with another email</h1>
      <p className="mt-3 text-ink-600" data-testid="crew-invite-mismatch">
        {invite.orgName} shared this job with <span className="font-medium text-ink-900">{invited}</span>.
        You&apos;re signed in as <span className="font-medium text-ink-900">{user.email}</span>.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={async () => {
            await logout();
            navigate(crewInviteLoginHref(token, invited), { replace: true });
          }}
          className="rounded-lg bg-brand-500 px-4 py-2.5 font-semibold text-ink-900"
        >
          Switch to {invited}
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
