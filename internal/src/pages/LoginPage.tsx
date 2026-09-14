import { useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../lib/api';
import { landingPath } from '../lib/access';
import { forgetStaffEmail, readRememberedStaffEmail, rememberStaffEmail } from '../lib/rememberedEmail';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';

type Step = { kind: 'login' } | { kind: 'request' } | { kind: 'pending' };

export function LoginPage() {
  const { user, access, loading, startSignIn, login } = useAuth();
  const [searchParams] = useSearchParams();
  const remembered = readRememberedStaffEmail();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState(remembered);
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'login' });
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

  async function onLogin(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login({ email, password });
      rememberStaffEmail(email);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in.');
    } finally {
      setSubmitting(false);
    }
  }

  async function onRequestInvite(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const next = await startSignIn({ firstName, lastName, email });
      if (next.status === 'ready') {
        setStep({ kind: 'login' });
        setError(null);
        setPassword('');
        return;
      }
      if (next.status === 'pending') {
        setStep({ kind: 'pending' });
        return;
      }
      setError('Enter your first name, last name, and work email to request access.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not request access.');
    } finally {
      setSubmitting(false);
    }
  }

  function goLogin() {
    setStep({ kind: 'login' });
    setError(null);
  }

  function goRequest() {
    setStep({ kind: 'request' });
    setError(null);
    setPassword('');
  }

  function useDifferentEmail() {
    forgetStaffEmail();
    setEmail('');
    setFirstName('');
    setLastName('');
    setPassword('');
    goLogin();
  }

  return (
    <div className="relative grid min-h-screen place-items-center bg-paper-100 px-6">
      <div className="absolute right-6 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md rounded-2xl border border-line bg-paper-0 p-8 shadow-sm">
        <Logo to={null} size="lg" />
        <p className="mt-5 text-[11px] uppercase tracking-[0.18em] text-brand-600">Atmosphere staff</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Internal</h1>
        {step.kind === 'pending' ? (
          <>
            <p className="mt-2 text-sm text-ink-500">
              Your request for {email || 'access'} is waiting on an Atmosphere admin. After they
              invite you, sign in here with the same email and password you use on Platform.
            </p>
            <button
              type="button"
              onClick={goLogin}
              className="mt-6 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-500"
            >
              Back to sign in
            </button>
          </>
        ) : step.kind === 'request' ? (
          <>
            <p className="mt-2 text-sm text-ink-500">
              Atmosphere Internal is invite-only. Enter your name and work email to request access.
              After an admin approves you, sign in with your Platform account password.
            </p>
            <form className="mt-6 space-y-4" onSubmit={(event) => void onRequestInvite(event)}>
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
                {submitting ? 'Submitting…' : 'Request invite'}
              </button>
              <button
                type="button"
                onClick={goLogin}
                className="w-full text-sm text-ink-500 hover:text-ink-800"
              >
                Already invited? Sign in
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-ink-500">
              Invite-only. Use the same email and password as your Atmosphere Platform account.
            </p>
            <form className="mt-6 space-y-4" onSubmit={(event) => void onLogin(event)}>
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
              <label className="block text-sm">
                <span className="text-ink-600">Password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-line-strong bg-paper-50 px-3 py-2 text-ink-900 outline-none focus:border-brand-500"
                />
              </label>
              <p className="text-xs text-ink-500">Same password as Platform (platform.atmosphereteam.com)</p>
              {error && <p className="text-sm text-danger-600">{error}</p>}
              <button
                type="submit"
                disabled={submitting || password.length < 8}
                className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-60"
              >
                {submitting ? 'Signing in…' : 'Sign in'}
              </button>
              <button
                type="button"
                onClick={goRequest}
                className="w-full text-sm text-ink-500 hover:text-ink-800"
              >
                Need access? Request an invite
              </button>
              {remembered ? (
                <button
                  type="button"
                  onClick={useDifferentEmail}
                  className="w-full text-sm text-ink-500 hover:text-ink-800"
                >
                  Use a different email
                </button>
              ) : null}
            </form>
          </>
        )}
      </div>
    </div>
  );
}
