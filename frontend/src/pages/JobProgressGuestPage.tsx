import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError, type JobScopeItem, type ProgressShareGuestView, type SharedJobRecord } from '../lib/api';
import { exchangeShareToken, guestPathAfterExchange } from '../lib/shareExchange';
import { loginHref } from '../lib/authRedirect';
import { Logo } from '../components/Logo';
import { SpinnerIcon } from '../components/icons';
import { JobFileAskChrome } from '../components/JobFileAskChrome';
import { JobProgressDashboard } from '../components/shared/JobProgressDashboard';
import { useAuth } from '../context/AuthContext';

/**
 * Read-only job file for third parties — homeowners, attorneys, banks,
 * insurance companies. The token in the URL is the credential.
 *
 * To come back later they tap one button: we email the invited address a
 * one-time sign-in link + code (no password, no payment), and the click claims
 * this share and opens the same /job-progress UI the office uses. Viewers who
 * already set a password can still use Sign in.
 */

export function JobProgressGuestPage() {
  const { token = '' } = useParams();
  const [searchParams] = useSearchParams();
  const openAsk = searchParams.get('ask') === '1';
  const navigate = useNavigate();
  const { user, loading: authLoading, adoptUser } = useAuth();
  // Read the one-time sign-in params once, before the share exchange rewrites the URL.
  const [emailSignIn] = useState(() => {
    const hash = searchParams.get('signin');
    const kind = searchParams.get('kind') === 'invite' ? 'invite' : 'magiclink';
    return hash ? { tokenHash: hash, kind: kind as 'magiclink' | 'invite' } : null;
  });
  const [linkState, setLinkState] = useState<'idle' | 'sending' | 'sent' | 'verifying'>(
    emailSignIn ? 'verifying' : 'idle',
  );
  const [code, setCode] = useState('');
  const [view, setView] = useState<ProgressShareGuestView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    void exchangeShareToken('progress', token).then((ok) => {
      if (!ok || typeof window === 'undefined') return;
      const next = guestPathAfterExchange('progress', window.location.search);
      if (window.location.pathname + window.location.search !== next) {
        window.history.replaceState(window.history.state, '', next);
      }
    });
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.progressShareGuest(token);
        if (!cancelled) {
          setView(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not open this job file.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const invitedEmail = view?.share.recipientEmail?.trim().toLowerCase() || null;
  const progressPath = token ? `/progress/${encodeURIComponent(token)}` : '/progress';

  async function claimAndOpen() {
    if (!token || claiming) return;
    setClaiming(true);
    setClaimError(null);
    try {
      const res = await api.claimProgressShare(token);
      navigate(res.path, { replace: true });
    } catch (err) {
      setClaimError(err instanceof ApiError ? err.message : 'Could not open this job in your account.');
    } finally {
      setClaiming(false);
    }
  }

  async function verifyEmailSignIn(input: { tokenHash?: string; kind?: 'magiclink' | 'invite'; code?: string }) {
    try {
      const res = await api.progressShareVerifyEmailSignIn(token, input);
      await adoptUser(res.user);
      navigate(res.path, { replace: true });
    } catch (err) {
      setLinkState(input.code ? 'sent' : 'idle');
      setClaimError(err instanceof ApiError ? err.message : 'That sign-in link did not work. Send a new one.');
    }
  }

  useEffect(() => {
    if (!emailSignIn || !token) return;
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('signin');
      url.searchParams.delete('kind');
      window.history.replaceState(window.history.state, '', url.pathname + url.search);
    }
    void verifyEmailSignIn(emailSignIn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailSignIn, token]);

  async function sendSignInLink() {
    if (linkState === 'sending') return;
    setLinkState('sending');
    setClaimError(null);
    try {
      await api.progressShareEmailSignIn(token);
      setLinkState('sent');
    } catch (err) {
      setLinkState('idle');
      setClaimError(err instanceof ApiError ? err.message : 'Could not send the sign-in email.');
    }
  }

  useEffect(() => {
    if (authLoading || !user || !token || !view || emailSignIn) return;
    const sessionEmail = user.email?.trim().toLowerCase() || '';
    if (!invitedEmail || sessionEmail !== invitedEmail) return;
    void claimAndOpen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, token, view, invitedEmail]);

  const exclusions = useMemo(
    () => (view?.scope ?? []).filter((item) => item.state === 'excluded'),
    [view],
  );

  const guestRecord = useMemo((): SharedJobRecord | null => {
    if (!view?.job) return null;
    return {
      job: view.job,
      brief: view.brief ?? null,
      revisions: [],
      currentRevision: view.brief?.revision ?? null,
      parties: [],
      scope: view.scope ?? [],
      money: { approved: 0, pending: 0, unpricedApprovals: 0 },
      messages: [],
      risks: [],
    };
  }, [view]);

  if (!view && !error) {
    return (
      <div className="grid min-h-screen place-items-center bg-paper-100 text-brand-600">
        <SpinnerIcon className="animate-spin" width={28} height={28} />
      </div>
    );
  }

  if (error || !view || !view.job) {
    return (
      <div className="cx-aurora min-h-screen bg-paper-100">
        <div className="mx-auto max-w-xl px-6 py-20 text-center">
          <Logo to={null} />
          <h1 className="mt-8 text-2xl font-semibold text-ink-900">Link unavailable</h1>
          <p className="mt-3 text-ink-600">{error ?? 'This link is not valid.'}</p>
        </div>
      </div>
    );
  }

  const loginLink = loginHref(progressPath);

  return (
    <div className="cx-aurora flex h-svh flex-col bg-paper-100">
      <header className="shrink-0 border-b border-line bg-paper-0/90 backdrop-blur">
        <div className="flex items-start justify-between gap-4 px-6 py-5">
          <Logo to={null} />
          <div className="min-w-0 text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-brand-600">
              Job file
            </p>
            <h1 className="text-lg font-semibold text-ink-900">{view.org.name}</h1>
            <p className="mt-0.5 truncate text-sm text-ink-600">
              Shared with{' '}
              <span className="font-medium text-ink-800">
                {view.share.recipientEmail ?? view.share.label}
              </span>
            </p>
          </div>
        </div>
      </header>

      <div className="shrink-0 border-b border-line bg-paper-0 px-4 py-3 sm:px-6" data-testid="guest-save-banner">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
          {user ? (
            <>
              <p className="text-sm text-ink-700">Save this job to your account to find it again anytime.</p>
              <button
                type="button"
                onClick={() => void claimAndOpen()}
                disabled={claiming}
                className="rounded-lg bg-ink-900 px-3.5 py-2 text-sm font-semibold text-paper-0 disabled:opacity-50"
              >
                {claiming ? 'Opening…' : 'Open in my account'}
              </button>
            </>
          ) : linkState === 'verifying' ? (
            <p className="flex items-center gap-2 text-sm text-ink-700">
              <SpinnerIcon className="animate-spin" width={16} height={16} /> Signing you in…
            </p>
          ) : linkState === 'sent' ? (
            <form
              className="flex w-full flex-wrap items-center justify-between gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!code.trim()) return;
                setLinkState('verifying');
                setClaimError(null);
                void verifyEmailSignIn({ code: code.trim() });
              }}
            >
              <p className="min-w-0 text-sm text-ink-700" role="status">
                <span className="font-semibold text-ink-900">Check your email.</span> We sent a sign-in link to{' '}
                <span className="font-medium text-ink-900">{invitedEmail}</span>. Tap it, or enter the code.
              </p>
              <div className="flex w-full gap-2 sm:w-auto">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="6-digit code"
                  aria-label="Sign-in code"
                  className="min-w-0 flex-1 rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm tracking-widest text-ink-900 sm:w-36 sm:flex-none"
                />
                <button
                  type="submit"
                  disabled={code.trim().length < 6}
                  className="rounded-lg bg-ink-900 px-3.5 py-2 text-sm font-semibold text-paper-0 disabled:opacity-50"
                >
                  Open
                </button>
                <button
                  type="button"
                  onClick={() => void sendSignInLink()}
                  className="rounded-lg px-2 py-2 text-sm font-medium text-ink-600 hover:text-ink-900"
                >
                  Resend
                </button>
              </div>
            </form>
          ) : invitedEmail ? (
            <>
              <p className="min-w-0 text-sm text-ink-700">
                Save this job — we&apos;ll email a sign-in link to{' '}
                <span className="font-medium text-ink-900">{invitedEmail}</span>. No password, free.
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void sendSignInLink()}
                  disabled={linkState === 'sending'}
                  className="rounded-lg bg-ink-900 px-3.5 py-2 text-sm font-semibold text-paper-0 disabled:opacity-50"
                >
                  {linkState === 'sending' ? 'Sending…' : 'Email me a link'}
                </button>
                <Link to={loginLink} className="text-sm font-medium text-ink-600 hover:text-ink-900">
                  Use a password
                </Link>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-ink-700">Have an Atmosphere account? Sign in to save this job.</p>
              <Link
                to={loginLink}
                className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-ink-800"
              >
                Sign in
              </Link>
            </>
          )}
        </div>
        {claimError && (
          <p role="alert" className="mx-auto mt-2 max-w-3xl text-sm text-danger-600">
            {claimError}
          </p>
        )}
      </div>

      <JobFileAskChrome
        jobId={view.job.id}
        initialPane={openAsk ? 'ask' : 'file'}
        file={{ record: guestRecord, proofs: view.proof }}
        ask={(question, opts) => api.progressShareAsk(token, question, opts)}
        loadQuestions={(threadId) => api.progressShareAskQuestions(token, { threadId })}
        loadThreads={() => api.progressShareAskThreads(token)}
        createThread={(title) => api.progressShareCreateAskThread(token, title)}
        renameThread={(threadId, title) => api.progressShareRenameAskThread(token, threadId, title)}
      >
        <div className="mx-auto max-w-3xl space-y-4">
          {exclusions.length > 0 && (
            <section className="rounded-xl border border-danger-200 bg-danger-50/50 px-5 py-4" data-testid="homeowner-do-nots">
              <h2 className="text-sm font-semibold text-ink-900">Do not</h2>
              <ul className="mt-2 space-y-2">
                {exclusions.map((item) => (
                  <ExclusionRow key={item.id} item={item} />
                ))}
              </ul>
            </section>
          )}

          <JobProgressDashboard
            jobId={view.job.id}
            record={{
              job: view.job,
              scope: view.scope ?? [],
              risks: [],
              brief: view.brief ?? null,
            }}
            readOnly
            initialProof={view.proof}
            metrics={view.progress}
            liveStory={view.liveStory ?? null}
            videoFetcher={(proofId) => api.progressShareVideo(token, proofId)}
            alwaysShowRecordings
          />
        </div>
      </JobFileAskChrome>
    </div>
  );
}

function ExclusionRow({ item }: { item: JobScopeItem }) {
  return (
    <li>
      <p className="text-sm font-medium text-ink-800">{item.title}</p>
      {item.reason && <p className="mt-0.5 text-xs text-ink-600">{item.reason}</p>}
    </li>
  );
}
