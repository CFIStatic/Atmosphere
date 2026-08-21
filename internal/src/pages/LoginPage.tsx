import { useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../lib/api';
import { landingPath } from '../lib/access';
import type { StaffChallengeResponse } from '../lib/types';

type Step =
  | { kind: 'identity' }
  | { kind: 'enroll'; challenge: string; qrDataUrl: string; secret: string }
  | { kind: 'code'; challenge: string };

function stepFromChallenge(next: StaffChallengeResponse): Step {
  if (next.status === 'enroll') {
    return {
      kind: 'enroll',
      challenge: next.challenge,
      qrDataUrl: next.qrDataUrl,
      secret: next.secret,
    };
  }
  return { kind: 'code', challenge: next.challenge };
}

export function LoginPage() {
  const { user, access, loading, startSignIn, login } = useAuth();
  const [searchParams] = useSearchParams();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'identity' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-paper-100 text-ink-500">
        Loading…
      </div>
    );
  }

  if (user && access?.scope) {
    const next = searchParams.get('next');
    return <Navigate to={next && next.startsWith('/') ? next : landingPath(access.scope)} replace />;
  }

  async function onIdentity(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const next = await startSignIn({ firstName, lastName, email });
      setCode('');
      setStep(stepFromChallenge(next));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in.');
    } finally {
      setSubmitting(false);
    }
  }

  async function onVerify(event: FormEvent) {
    event.preventDefault();
    if (step.kind === 'identity') return;
    setSubmitting(true);
    setError(null);
    try {
      await login({ challenge: step.challenge, code: code.replace(/\s+/g, '') });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in.');
    } finally {
      setSubmitting(false);
    }
  }

  function backToIdentity() {
    setStep({ kind: 'identity' });
    setCode('');
    setError(null);
  }

  return (
    <div className="grid min-h-screen place-items-center bg-paper-100 px-6">
      <div className="w-full max-w-md rounded-2xl border border-line bg-paper-0 p-8 shadow-sm">
        <p className="text-[11px] uppercase tracking-[0.18em] text-brand-600">Atmosphere staff</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Internal</h1>
        {step.kind === 'identity' ? (
          <>
            <p className="mt-2 text-sm text-ink-500">
              Accounts, product analytics, and system health. Sign in with your name, work email,
              and Microsoft Authenticator — not the office-app password.
            </p>
            <form className="mt-6 space-y-4" onSubmit={(event) => void onIdentity(event)}>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-ink-600">First name</span>
                  <input
                    type="text"
                    autoComplete="given-name"
                    required
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-line-strong bg-paper-50 px-3 py-2 text-ink-900 outline-none focus:border-brand-500"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-ink-600">Last name</span>
                  <input
                    type="text"
                    autoComplete="family-name"
                    required
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-line-strong bg-paper-50 px-3 py-2 text-ink-900 outline-none focus:border-brand-500"
                  />
                </label>
              </div>
              <label className="block text-sm">
                <span className="text-ink-600">Email</span>
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-line-strong bg-paper-50 px-3 py-2 text-ink-900 outline-none focus:border-brand-500"
                />
              </label>
              {error && <p className="text-sm text-danger-600">{error}</p>}
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-60"
              >
                {submitting ? 'Checking…' : 'Continue'}
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-ink-500">
              {step.kind === 'enroll'
                ? 'Add Atmosphere Internal in Microsoft Authenticator, then enter the 6-digit code.'
                : `Enter the 6-digit code from Microsoft Authenticator for ${email}.`}
            </p>
            {step.kind === 'enroll' && (
              <div className="mt-4 rounded-xl border border-line bg-paper-50 p-4">
                <ol className="list-decimal space-y-1 pl-4 text-sm text-ink-600">
                  <li>Open Microsoft Authenticator</li>
                  <li>Tap +, then Other account (Google, Facebook, etc.)</li>
                  <li>Scan this QR code</li>
                </ol>
                <img
                  src={step.qrDataUrl}
                  alt="QR code for Microsoft Authenticator"
                  className="mx-auto mt-4 h-[220px] w-[220px] rounded-lg bg-white p-2"
                />
                <p className="mt-3 break-all text-center font-mono text-[11px] text-ink-500">
                  Setup key: {step.secret}
                </p>
              </div>
            )}
            <form className="mt-6 space-y-4" onSubmit={(event) => void onVerify(event)}>
              <label className="block text-sm">
                <span className="text-ink-600">Authenticator code</span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="mt-1 w-full rounded-lg border border-line-strong bg-paper-50 px-3 py-2 tracking-[0.3em] text-ink-900 outline-none focus:border-brand-500"
                />
              </label>
              {error && <p className="text-sm text-danger-600">{error}</p>}
              <button
                type="submit"
                disabled={submitting || code.length !== 6}
                className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-60"
              >
                {submitting ? 'Signing in…' : 'Sign in'}
              </button>
              <button
                type="button"
                onClick={backToIdentity}
                className="w-full text-sm text-ink-500 hover:text-ink-800"
              >
                Use a different email
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
