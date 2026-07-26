import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../lib/api';
import { Logo } from '../components/Logo';
import { PinPad } from '../components/PinPad';
import { EyeIcon, EyeOffIcon, SpinnerIcon, CheckIcon } from '../components/icons';

type Mode = 'login' | 'signup';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginPage() {
  const { user, loading, login, signup, unlockWithPin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/dashboard';

  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // --- PIN unlock -----------------------------------------------------------
  const [pinChecked, setPinChecked] = useState(false);
  const [pinEnrolled, setPinEnrolled] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinShake, setPinShake] = useState(false);
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const shakeTimer = useRef<number | undefined>(undefined);

  // Ask the backend whether this browser holds a valid device enrollment. The
  // answer decides which screen opens, so the form waits on it rather than
  // flashing the password fields and swapping them out.
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
      })
      .finally(() => {
        if (!cancelled) setPinChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => window.clearTimeout(shakeTimer.current), []);

  if (!loading && user) {
    return <Navigate to={redirectTo} replace />;
  }

  const emailValid = EMAIL_RE.test(email.trim());
  const passwordValid = password.length >= 8;
  const canSubmit = emailValid && passwordValid && !submitting;
  const isLogin = mode === 'login';

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
  }

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
      await unlockWithPin(entered);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        rejectPin(err.message);
        // The device lost its enrollment (revoked, or too many lockouts), so
        // stop offering a PIN that can no longer work.
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
    setNotice(null);
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      if (isLogin) {
        await login(email.trim(), password);
        navigate(redirectTo, { replace: true });
      } else {
        const res = await signup(email.trim(), password);
        if (res.needsEmailConfirmation) {
          setNotice(res.message ?? 'Check your email to confirm your account, then sign in.');
          setMode('login');
          setPassword('');
        } else {
          navigate(redirectTo, { replace: true });
        }
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const title = showPin ? 'Enter your PIN' : isLogin ? 'Welcome back' : 'Create your account';
  const subtitle = showPin
    ? 'Use the 4-digit PIN you set up on this device.'
    : isLogin
      ? 'Sign in to your Atmosphere workspace.'
      : 'Create your Atmosphere account in minutes.';

  return (
    <div className="cx-aurora relative flex min-h-screen flex-col bg-canvas">
      <header className="px-6 py-6 sm:px-10">
        <Logo />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md animate-fade-in-up">
          <div className="rounded-2xl border border-line/10 bg-surface/70 p-8 shadow-2xl shadow-scrim/40 backdrop-blur-xl sm:p-10">
            {!pinChecked ? (
              <div className="grid place-items-center py-16 text-brand-300">
                <SpinnerIcon className="animate-spin" width={26} height={26} />
                <span className="sr-only">Loading…</span>
              </div>
            ) : (
              <>
                <h1 className="text-2xl font-bold tracking-tight text-fg">{title}</h1>
                <p className="mt-1.5 text-sm text-fg-3">{subtitle}</p>

                {notice && !showPin && (
                  <div
                    role="status"
                    className="mt-6 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-3 text-sm text-emerald-200"
                  >
                    <CheckIcon className="mt-0.5 shrink-0" width={18} height={18} />
                    <span>{notice}</span>
                  </div>
                )}

                {showPin ? (
                  <>
                    {pinError && (
                      <div
                        role="alert"
                        className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-3 text-center text-sm text-red-200"
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
                        <span className="flex items-center gap-2 text-sm text-brand-300">
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
                      className="mt-2 w-full rounded-lg border border-line/10 bg-raised/60 px-4 py-2.5 text-sm font-medium text-fg-2 transition hover:bg-raised-2"
                    >
                      Use password instead
                    </button>
                  </>
                ) : (
                  <>
                    {error && (
                      <div
                        role="alert"
                        className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-3 text-sm text-red-200"
                      >
                        {error}
                      </div>
                    )}

                    <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
                      <div>
                        <label
                          htmlFor="email"
                          className="mb-1.5 block text-sm font-medium text-fg-2"
                        >
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
                          className="w-full rounded-lg border border-line/10 bg-raised/80 px-3.5 py-2.5 text-fg placeholder-fg-4 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-500/40"
                        />
                      </div>

                      <div>
                        <div className="mb-1.5 flex items-center justify-between">
                          <label htmlFor="password" className="block text-sm font-medium text-fg-2">
                            Password
                          </label>
                          {isLogin ? (
                            <Link
                              to="/forgot-password"
                              className="text-xs font-medium text-brand-400 transition hover:text-brand-300"
                            >
                              Forgot password?
                            </Link>
                          ) : (
                            <span id="password-hint" className="text-xs text-fg-3">
                              Min. 8 characters
                            </span>
                          )}
                        </div>
                        <div className="relative">
                          <input
                            id="password"
                            name="password"
                            type={showPassword ? 'text' : 'password'}
                            autoComplete={isLogin ? 'current-password' : 'new-password'}
                            required
                            minLength={8}
                            aria-describedby="password-hint"
                            aria-invalid={!isLogin && password.length > 0 && !passwordValid}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            className="w-full rounded-lg border border-line/10 bg-raised/80 px-3.5 py-2.5 pr-11 text-fg placeholder-fg-4 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-500/40"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((s) => !s)}
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                            className="absolute inset-y-0 right-0 grid w-11 place-items-center text-fg-3 transition hover:text-fg-2"
                          >
                            {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                          </button>
                        </div>
                        {!isLogin && password.length > 0 && !passwordValid && (
                          <p id="password-hint" className="mt-1.5 text-xs text-amber-300/90">
                            Use at least 8 characters.
                          </p>
                        )}
                      </div>

                      <button
                        type="submit"
                        disabled={!canSubmit}
                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 font-semibold text-white shadow-lg shadow-brand-900/40 transition hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {submitting && <SpinnerIcon className="animate-spin" />}
                        {submitting
                          ? isLogin
                            ? 'Signing in…'
                            : 'Creating account…'
                          : isLogin
                            ? 'Sign in'
                            : 'Create account'}
                      </button>
                    </form>

                    {pinEnrolled && isLogin && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowPin(true);
                          setPinError(null);
                        }}
                        className="mt-3 w-full rounded-lg border border-line/10 bg-raised/60 px-4 py-2.5 text-sm font-medium text-fg-2 transition hover:bg-raised-2"
                      >
                        Use your PIN instead
                      </button>
                    )}

                    <p className="mt-6 text-center text-sm text-fg-3">
                      {isLogin ? "Don't have an account?" : 'Already have an account?'}{' '}
                      <button
                        type="button"
                        onClick={() => switchMode(isLogin ? 'signup' : 'login')}
                        className="font-semibold text-brand-400 transition hover:text-brand-300"
                      >
                        {isLogin ? 'Create one' : 'Sign in'}
                      </button>
                    </p>
                  </>
                )}
              </>
            )}
          </div>

          <p className="mt-6 text-center text-xs text-fg-4">
            Protected by Supabase Auth · Passwords are encrypted and never stored in plain text.
          </p>
        </div>
      </main>
    </div>
  );
}
