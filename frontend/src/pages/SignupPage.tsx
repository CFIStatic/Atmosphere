import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../lib/api';
import { loginHref, resolveAuthRedirect } from '../lib/authRedirect';
import { PLATFORM_HOME } from '../lib/platforms';
import { postAuthDestination } from '../lib/postAuth';
import { getPlatform } from '../lib/usePlatform';
import { Logo } from '../components/Logo';
import { EyeIcon, EyeOffIcon, SpinnerIcon, CheckIcon } from '../components/icons';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SETUP_STEPS = [
  {
    title: 'Create your account',
    detail: 'Work email and a password. We never store your password in plain text.',
    active: true,
  },
  {
    title: 'Name your organization',
    detail: 'Start a new workspace — or join an existing team with a join code.',
  },
  {
    title: 'Pick your role and trade',
    detail: 'So Field Capture and the Evidence Platform open with the right defaults.',
  },
  {
    title: 'Invite your crew',
    detail: 'Every organization gets one join code. Hand it to a teammate and they are in.',
  },
] as const;

export function SignupPage() {
  const { user, loading, signup } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
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
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Create your organization · Atmosphere';
    return () => {
      document.title = 'Atmosphere';
    };
  }, []);

  if (!loading && user) {
    return <Navigate to={redirectTo} replace />;
  }

  const emailValid = EMAIL_RE.test(email.trim());
  const passwordValid = password.length >= 8;
  const canSubmit = emailValid && passwordValid && !submitting;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      const res = await signup(email.trim(), password);
      if (res.needsEmailConfirmation) {
        setNotice(res.message ?? 'Check your email to confirm your account, then sign in.');
        setPassword('');
      } else {
        navigate(postAuthDestination(res.membership, redirectTo), { replace: true });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const signInHref = loginHref(redirectTo);

  return (
    <div className="cx-aurora relative flex min-h-screen flex-col bg-paper-100">
      <header className="flex items-center justify-between gap-4 px-6 py-6 sm:px-10">
        <Logo />
        <Link
          to={signInHref}
          className="text-sm font-medium text-ink-600 transition hover:text-ink-900"
        >
          Already have an account? <span className="font-semibold text-brand-600">Sign in</span>
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-4xl animate-fade-in-up">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-start lg:gap-14">
            <div className="hidden lg:block">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">
                Get started
              </p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink-900">
                Create your organization
              </h1>
              <p className="mt-3 max-w-md text-base text-ink-600">
                One account, one organization, one join code — and everyone from the office to the
                truck works on the same verified record.
              </p>

              <ol className="mt-10 space-y-5">
                {SETUP_STEPS.map((step, index) => (
                  <li
                    key={step.title}
                    className={`flex gap-4 rounded-xl border px-4 py-4 ${
                      step.active
                        ? 'border-brand-200 bg-brand-50/80 shadow-sm'
                        : 'border-line bg-paper-0/60'
                    }`}
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                        step.active
                          ? 'bg-brand-500 text-ink-900'
                          : 'bg-paper-100 text-ink-500'
                      }`}
                      aria-hidden="true"
                    >
                      {index + 1}
                    </span>
                    <div>
                      <p className="font-semibold text-ink-900">{step.title}</p>
                      <p className="mt-1 text-sm text-ink-600">{step.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div>
              <div className="rounded-2xl border border-brand-200 bg-paper-0 p-8 shadow-lift shadow-2xl shadow-lift-xl sm:p-10">
                <div className="lg:hidden">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">
                    Step 1 · Create your account
                  </p>
                  <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink-900">
                    Create your organization
                  </h1>
                  <p className="mt-2 text-sm text-ink-600">
                    Start with your work email. Next you will name your organization or join with a
                    code.
                  </p>
                </div>

                <div className="hidden lg:block">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">
                    Step 1 · Create your account
                  </p>
                  <h2 className="mt-2 text-xl font-bold tracking-tight text-ink-900">
                    Your login details
                  </h2>
                  <p className="mt-1.5 text-sm text-ink-600">
                    Organization setup comes right after this — about two minutes.
                  </p>
                </div>

                {notice && (
                  <div
                    role="status"
                    className="mt-6 flex items-start gap-2 rounded-lg border border-success-200 bg-success-50 px-3.5 py-3 text-sm text-success-600"
                  >
                    <CheckIcon className="mt-0.5 shrink-0" width={18} height={18} />
                    <span>
                      {notice}{' '}
                      <Link to={signInHref} className="font-semibold underline underline-offset-2">
                        Sign in
                      </Link>{' '}
                      once your email is confirmed.
                    </span>
                  </div>
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
                    <label htmlFor="signup-email" className="mb-1.5 block text-sm font-medium text-ink-700">
                      Work email
                    </label>
                    <input
                      id="signup-email"
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
                      <label
                        htmlFor="signup-password"
                        className="block text-sm font-medium text-ink-700"
                      >
                        Password
                      </label>
                      <span id="signup-password-hint" className="text-xs text-ink-500">
                        Min. 8 characters
                      </span>
                    </div>
                    <div className="relative">
                      <input
                        id="signup-password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        required
                        minLength={8}
                        aria-describedby="signup-password-hint"
                        aria-invalid={password.length > 0 && !passwordValid}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Choose a strong password"
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
                    {password.length > 0 && !passwordValid && (
                      <p className="mt-1.5 text-xs text-caution-600">Use at least 8 characters.</p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-3 font-semibold text-ink-900 shadow-lg shadow-card transition hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 focus:ring-offset-2 focus:ring-offset-ink-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitting && <SpinnerIcon className="animate-spin" />}
                    {submitting ? 'Creating account…' : 'Continue — set up your organization'}
                  </button>
                </form>

                <p className="mt-5 rounded-lg bg-paper-50 px-3.5 py-3 text-xs leading-relaxed text-ink-500">
                  Joining a team that already uses Atmosphere? Create your account here, then choose{' '}
                  <strong className="font-medium text-ink-700">Join with a code</strong> on the next
                  screen.
                </p>

                <p className="mt-6 text-center text-sm text-ink-600 lg:hidden">
                  Already have an account?{' '}
                  <Link to={signInHref} className="font-semibold text-brand-600 hover:text-brand-700">
                    Sign in
                  </Link>
                </p>
              </div>

              <p className="mt-6 text-center text-xs text-ink-400">
                Passwords are encrypted, never stored in plain text, and never seen by this page.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
