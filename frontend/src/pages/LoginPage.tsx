import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../lib/api';
import { Logo } from '../components/Logo';
import { EyeIcon, EyeOffIcon, SpinnerIcon, CheckIcon } from '../components/icons';

type Mode = 'login' | 'signup';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginPage() {
  const { user, loading, login, signup } = useAuth();
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

  // If already authenticated, don't show the login screen.
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
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const title = isLogin ? 'Welcome back' : 'Create your account';
  const subtitle = isLogin
    ? 'Sign in to your Commandx command center.'
    : 'Start commanding your operations in minutes.';

  return (
    <div className="cx-aurora relative flex min-h-screen flex-col bg-ink-900">
      {/* Header */}
      <header className="px-6 py-6 sm:px-10">
        <Logo />
      </header>

      {/* Main */}
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md animate-fade-in-up">
          <div className="rounded-2xl border border-white/10 bg-ink-800/70 p-8 shadow-2xl shadow-black/40 backdrop-blur-xl sm:p-10">
            <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
            <p className="mt-1.5 text-sm text-gray-400">{subtitle}</p>

            {/* Notice (e.g. confirm email) */}
            {notice && (
              <div
                role="status"
                className="mt-6 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-3 text-sm text-emerald-200"
              >
                <CheckIcon className="mt-0.5 shrink-0" width={18} height={18} />
                <span>{notice}</span>
              </div>
            )}

            {/* Error */}
            {error && (
              <div
                role="alert"
                className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-3 text-sm text-red-200"
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
              {/* Email */}
              <div>
                <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-gray-300">
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
                  className="w-full rounded-lg border border-white/10 bg-ink-700/80 px-3.5 py-2.5 text-white placeholder-gray-500 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-500/40"
                />
              </div>

              {/* Password */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label htmlFor="password" className="block text-sm font-medium text-gray-300">
                    Password
                  </label>
                  {isLogin && (
                    <span className="text-xs text-gray-500">Min. 8 characters</span>
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
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-white/10 bg-ink-700/80 px-3.5 py-2.5 pr-11 text-white placeholder-gray-500 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-500/40"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-0 grid w-11 place-items-center text-gray-400 transition hover:text-gray-200"
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
                {!isLogin && password.length > 0 && !passwordValid && (
                  <p className="mt-1.5 text-xs text-amber-300/90">
                    Use at least 8 characters.
                  </p>
                )}
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={!canSubmit}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 font-semibold text-white shadow-lg shadow-brand-900/40 transition hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-ink-800 disabled:cursor-not-allowed disabled:opacity-50"
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

            {/* Mode switch */}
            <p className="mt-6 text-center text-sm text-gray-400">
              {isLogin ? "Don't have an account?" : 'Already have an account?'}{' '}
              <button
                type="button"
                onClick={() => switchMode(isLogin ? 'signup' : 'login')}
                className="font-semibold text-brand-400 transition hover:text-brand-300"
              >
                {isLogin ? 'Create one' : 'Sign in'}
              </button>
            </p>
          </div>

          <p className="mt-6 text-center text-xs text-gray-600">
            Protected by Supabase Auth · Passwords are encrypted and never stored in plain text.
          </p>
        </div>
      </main>
    </div>
  );
}
