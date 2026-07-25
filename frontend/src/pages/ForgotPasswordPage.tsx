import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { Logo } from '../components/Logo';
import { SpinnerIcon, CheckIcon } from '../components/icons';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailValid = EMAIL_RE.test(email.trim());

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!emailValid || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      await api.forgotPassword(email.trim());
      // The backend answers identically whether or not the account exists, and
      // so does this screen — confirming an address here would hand an attacker
      // a list of who works at the company.
      setSent(true);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="cx-aurora relative flex min-h-screen flex-col bg-ink-900">
      <header className="px-6 py-6 sm:px-10">
        <Logo />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md animate-fade-in-up">
          <div className="rounded-2xl border border-white/10 bg-ink-800/70 p-8 shadow-2xl shadow-black/40 backdrop-blur-xl sm:p-10">
            {sent ? (
              <>
                <div className="grid h-12 w-12 place-items-center rounded-full bg-emerald-500/15 text-emerald-300">
                  <CheckIcon width={26} height={26} />
                </div>
                <h1 className="mt-5 text-2xl font-bold tracking-tight text-white">Check your email</h1>
                <p className="mt-2 text-sm leading-relaxed text-gray-400">
                  If an account exists for{' '}
                  <span className="text-gray-200">{email.trim()}</span>, we've sent a link to reset
                  your password. It expires in one hour.
                </p>
                <p className="mt-4 text-sm text-gray-500">
                  Nothing arrived? Check your spam folder, or{' '}
                  <button
                    type="button"
                    onClick={() => setSent(false)}
                    className="font-semibold text-brand-400 transition hover:text-brand-300"
                  >
                    try another address
                  </button>
                  .
                </p>
              </>
            ) : (
              <>
                <h1 className="text-2xl font-bold tracking-tight text-white">Reset your password</h1>
                <p className="mt-1.5 text-sm text-gray-400">
                  Enter your email and we'll send you a link to set a new one.
                </p>

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
                    <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-gray-300">
                      Email
                    </label>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      autoFocus
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      className="w-full rounded-lg border border-white/10 bg-ink-700/80 px-3.5 py-2.5 text-white placeholder-gray-500 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-500/40"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={!emailValid || submitting}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 font-semibold text-white shadow-lg shadow-brand-900/40 transition hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-ink-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitting && <SpinnerIcon className="animate-spin" />}
                    {submitting ? 'Sending…' : 'Send reset link'}
                  </button>
                </form>
              </>
            )}

            <p className="mt-6 text-center text-sm text-gray-400">
              <Link
                to="/login"
                className="font-semibold text-brand-400 transition hover:text-brand-300"
              >
                Back to sign in
              </Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
