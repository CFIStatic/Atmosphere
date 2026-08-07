import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../lib/api';
import { resolveAuthRedirect, signupHref } from '../lib/authRedirect';
import { PLATFORM_HOME } from '../lib/platforms';
import { usePendingAuthRedirect } from '../hooks/usePendingAuthRedirect';
import { postAuthDestination } from '../lib/postAuth';
import { getPlatform } from '../lib/usePlatform';
import { Logo } from '../components/Logo';
import { PinPad } from '../components/PinPad';
import { EyeIcon, EyeOffIcon, SpinnerIcon } from '../components/icons';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginPage() {
  const { user, loading, login, unlockWithPin } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const queueRedirect = usePendingAuthRedirect();
  const isLegacySignup = searchParams.get('mode') === 'signup';

  const redirectTo = resolveAuthRedirect(
    searchParams.get('next'),
    (location.state as { from?: string } | null)?.from,
    PLATFORM_HOME[getPlatform()],
  );

  const [email, setEmail] = useState(() => searchParams.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- PIN unlock -----------------------------------------------------------
  const [pinEnrolled, setPinEnrolled] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinShake, setPinShake] = useState(false);
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const shakeTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    document.title = 'Sign in · Atmosphere';
    return () => {
      document.title = 'Atmosphere';
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .pinStatus()
      .then((status) => {
        if (cancelled) return;
        setPinEnrolled(status.enrolled);
        const locked = status.lockedUntil ? new Date(status.lockedUntil) > new Date() : false;
        setShowPin(status.enrolled && !locked);
        if (locked) {
          setPinError('Too many incorrect PINs. Sign in with your password to continue.');
        }
      })
      .catch(() => {
        /* PIN is an optional convenience — fall back to the password form. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => window.clearTimeout(shakeTimer.current), []);

  if (isLegacySignup) {
    const params = new URLSearchParams();
    const next = searchParams.get('next');
    const email = searchParams.get('email');
    if (next) params.set('next', next);
    if (email) params.set('email', email);
    const qs = params.toString();
    return <Navigate to={qs ? `/signup?${qs}` : '/signup'} replace />;
  }

  if (loading) {
    return (
      <div className="cx-aurora grid min-h-screen place-items-center bg-paper-100 text-brand-600">
        <SpinnerIcon className="animate-spin" width={28} height={28} />
      </div>
    );
  }

  if (user) {
    return <Navigate to={redirectTo} replace />;
  }

  const emailValid = EMAIL_RE.test(email.trim());
  const passwordValid = password.length >= 8;
  const canSubmit = emailValid && passwordValid && !submitting;

  function rejectPin(message: string) {
    setPinError(message);
    setPin('');
    setPinShake(true);
    window.clearTimeout(shakeTimer.current);
    shakeTimer.current = window.setTimeout(() => setPinShake(false), 450);
  }

  async function handlePinComplete(entered: string) {
    setPinSubmitting(true);
    setPinError(null);
    try {
      const membership = await unlockWithPin(entered);
      queueRedirect(postAuthDestination(membership, redirectTo));
    } catch (err) {
      if (err instanceof ApiError) {
        rejectPin(err.message);
        if (err.code === 'pin_revoked' || err.code === 'pin_not_enrolled') {
          setPinEnrolled(false);
          setShowPin(false);
        }
      } else {
        rejectPin('Something went wrong. Please try again.');
      }
    } finally {
      setPinSubmitting(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      const membership = await login(email.trim(), password);
      queueRedirect(postAuthDestination(membership, redirectTo));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const createAccountHref = signupHref({ next: redirectTo, email: email.trim() || undefined });
  const returningToUsage = redirectTo === '/usage' || redirectTo.startsWith('/usage?');

  return (
    <div className="cx-aurora relative flex min-h-screen flex-col bg-paper-100">
      <header className="flex items-center justify-between gap-4 px-6 py-6 sm:px-10">
        <Logo />
        <Link
          to={createAccountHref}
          className="text-sm font-medium text-ink-600 transition hover:text-ink-900"
        >
          New here? <span className="font-semibold text-brand-600">Create your organization</span>
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md animate-fade-in-up">
          <div className="rounded-2xl border border-line bg-paper-0 shadow-lift p-8 shadow-2xl shadow-lift-xl sm:p-10">
            {showPin ? (
              <>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">
                  This device
                </p>
                <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink-900">Enter your PIN</h1>
                <p className="mt-1.5 text-sm text-ink-600">
                  Use the 4-digit PIN you set up on this device.
                </p>

                {pinError && (
                  <div
                    role="alert"
                    className="mt-6 rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-3 text-center text-sm text-danger-700"
                  >
                    {pinError}
                  </div>
                )}

                <div className="mt-8">
                  <PinPad
                    value={pin}
                    onChange={setPin}
                    onComplete={handlePinComplete}
                    disabled={pinSubmitting}
                    shake={pinShake}
                    autoFocus
                  />
                </div>

                <div className="mt-6 flex min-h-[1.5rem] items-center justify-center">
                  {pinSubmitting && (
                    <span className="flex items-center gap-2 text-sm text-brand-600">
                      <SpinnerIcon className="animate-spin" width={16} height={16} />
                      Signing in…
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setShowPin(false);
                    setPin('');
                    setPinError(null);
                  }}
                  className="mt-2 w-full rounded-lg border border-line bg-paper-0 px-4 py-2.5 text-sm font-medium text-ink-800 transition hover:bg-paper-100"
                >
                  Use password instead
                </button>
              </>
            ) : (
              <>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">
                  Workspace
                </p>
                <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink-900">Welcome back</h1>
                <p className="mt-1.5 text-sm text-ink-600">
                  {returningToUsage
                    ? 'Sign in to open your usage dashboard for this billing period.'
                    : 'Sign in to your Atmosphere workspace.'}
                </p>

                {returningToUsage && (
                  <p className="mt-4 rounded-lg border border-brand-200 bg-brand-50/80 px-3.5 py-3 text-sm text-ink-700">
                    After you sign in, you will land on <strong>Usage</strong> — jobs processed,
                    compute units, and your estimated bill.
                  </p>
                )}

                {error && (
                  <div
                    role="alert"
                    className="mt-6 rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-3 text-sm text-danger-700"
                  >
                    {error}
                  </div>
                )}

                <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
                  <div>
                    <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-ink-700">
                      Email
                    </label>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      className="w-full rounded-lg glass-card px-3.5 py-2.5 text-ink-900 placeholder-ink-400 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
                    />
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label htmlFor="password" className="block text-sm font-medium text-ink-700">
                        Password
                      </label>
                      <Link
                        to="/forgot-password"
                        className="text-xs font-medium text-brand-600 transition hover:text-brand-700"
                      >
                        Forgot password?
                      </Link>
                    </div>
                    <div className="relative">
                      <input
                        id="password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        required
                        minLength={8}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full rounded-lg glass-card px-3.5 py-2.5 pr-11 text-ink-900 placeholder-ink-400 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((s) => !s)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute inset-y-0 right-0 grid w-11 place-items-center text-ink-600 transition hover:text-ink-900"
                      >
                        {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 font-semibold text-ink-900 shadow-lg shadow-card transition hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 focus:ring-offset-2 focus:ring-offset-ink-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitting && <SpinnerIcon className="animate-spin" />}
                    {submitting ? 'Signing in…' : 'Sign in'}
                  </button>
                </form>

                {pinEnrolled && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowPin(true);
                      setPinError(null);
                    }}
                    className="mt-3 w-full rounded-lg glass-card px-4 py-2.5 text-sm font-medium text-ink-800 transition hover:bg-paper-100"
                  >
                    Use your PIN instead
                  </button>
                )}

                <p className="mt-6 text-center text-sm text-ink-600">
                  Need an organization?{' '}
                  <Link
                    to={createAccountHref}
                    className="font-semibold text-brand-600 transition hover:text-brand-700"
                  >
                    Create one
                  </Link>
                </p>
              </>
            )}
          </div>

          <p className="mt-6 text-center text-xs text-ink-400">
            Passwords are encrypted, never stored in plain text, and never seen by this page.
          </p>
        </div>
      </main>
    </div>
  );
}
