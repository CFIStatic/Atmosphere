import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, ApiError, type RecoveryCredential } from '../lib/api';
import { Logo } from '../components/Logo';
import { EyeIcon, EyeOffIcon, SpinnerIcon } from '../components/icons';

interface ParsedLink {
  credential: RecoveryCredential | null;
  linkError: string | null;
}

/**
 * Pull the recovery credential out of the URL.
 *
 * Supabase delivers it three different ways — `?token_hash=` with a customised
 * email template, `?code=` under PKCE, or a `#access_token=…` fragment with the
 * stock template — so all three are read here and handed to the backend, which
 * does the actual exchange.
 */
function parseRecoveryLink(): ParsedLink {
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));

  const linkError =
    search.get('error_description') ??
    hash.get('error_description') ??
    search.get('error') ??
    hash.get('error');
  if (linkError) return { credential: null, linkError };

  const tokenHash = search.get('token_hash');
  if (tokenHash) return { credential: { tokenHash }, linkError: null };

  const code = search.get('code');
  if (code) return { credential: { code }, linkError: null };

  const accessToken = hash.get('access_token');
  const refreshToken = hash.get('refresh_token');
  if (accessToken && refreshToken) {
    return { credential: { accessToken, refreshToken }, linkError: null };
  }

  return { credential: null, linkError: null };
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const { adoptUser } = useAuth();

  // Read during the first render, before the effect below scrubs the URL.
  const [{ credential, linkError }] = useState<ParsedLink>(parseRecoveryLink);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Strip the credential from the address bar so it does not sit in browser
  // history, get screenshotted, or leak through a Referer header.
  useEffect(() => {
    if (window.location.search || window.location.hash) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const passwordValid = password.length >= 8;
  const matches = password === confirm;
  const canSubmit = passwordValid && matches && !submitting && Boolean(credential);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || !credential) return;

    setSubmitting(true);
    setError(null);
    try {
      const { user } = await api.resetPassword(credential, password);
      // The backend has already set fresh session cookies, so land the user
      // straight in the app rather than making them sign in again.
      await adoptUser(user);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const unusable = !credential;

  return (
    <div className="cx-aurora relative flex min-h-screen flex-col bg-ink-900">
      <header className="px-6 py-6 sm:px-10">
        <Logo />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md animate-fade-in-up">
          <div className="rounded-2xl border border-white/10 bg-ink-800/70 p-8 shadow-2xl shadow-black/40 backdrop-blur-xl sm:p-10">
            <h1 className="text-2xl font-bold tracking-tight text-white">Choose a new password</h1>

            {unusable ? (
              <>
                <p className="mt-2 text-sm leading-relaxed text-gray-400">
                  {linkError
                    ? 'That reset link is no longer valid.'
                    : 'This page needs a reset link to work.'}{' '}
                  Reset links expire after an hour and can only be used once.
                </p>
                <Link
                  to="/forgot-password"
                  className="mt-6 flex w-full items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 font-semibold text-white shadow-lg shadow-brand-900/40 transition hover:bg-brand-500"
                >
                  Request a new link
                </Link>
              </>
            ) : (
              <>
                <p className="mt-1.5 text-sm text-gray-400">
                  Pick something you haven't used before. You'll be signed in once it's saved.
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
                    <label
                      htmlFor="new-password"
                      className="mb-1.5 block text-sm font-medium text-gray-300"
                    >
                      New password
                    </label>
                    <div className="relative">
                      <input
                        id="new-password"
                        name="new-password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        autoFocus
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
                    {password.length > 0 && !passwordValid && (
                      <p className="mt-1.5 text-xs text-amber-300/90">Use at least 8 characters.</p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="confirm-password"
                      className="mb-1.5 block text-sm font-medium text-gray-300"
                    >
                      Confirm password
                    </label>
                    <input
                      id="confirm-password"
                      name="confirm-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      required
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder="••••••••"
                      className="w-full rounded-lg border border-white/10 bg-ink-700/80 px-3.5 py-2.5 text-white placeholder-gray-500 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-500/40"
                    />
                    {confirm.length > 0 && !matches && (
                      <p className="mt-1.5 text-xs text-amber-300/90">
                        These passwords don't match.
                      </p>
                    )}
                  </div>

                  <div className="rounded-lg border border-white/10 bg-ink-700/40 px-3.5 py-3 text-xs leading-relaxed text-gray-400">
                    For your security, saving a new password signs you out everywhere else and turns
                    off PIN sign-in on any device where you set one up.
                  </div>

                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 font-semibold text-white shadow-lg shadow-brand-900/40 transition hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 focus:ring-offset-ink-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitting && <SpinnerIcon className="animate-spin" />}
                    {submitting ? 'Saving…' : 'Save new password'}
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
