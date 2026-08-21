import { useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../lib/api';
import { landingPath } from '../lib/access';

export function LoginPage() {
  const { user, access, loading, login } = useAuth();
  const [searchParams] = useSearchParams();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [accessCode, setAccessCode] = useState('');
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

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login({ firstName, lastName, email, accessCode });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-paper-100 px-6">
      <div className="w-full max-w-md rounded-2xl border border-line bg-paper-0 p-8 shadow-sm">
        <p className="text-[11px] uppercase tracking-[0.18em] text-brand-600">Atmosphere staff</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Internal</h1>
        <p className="mt-2 text-sm text-ink-500">
          Accounts, product analytics, and system health. Sign in with your name, work email, and
          staff access code.
        </p>
        <form className="mt-6 space-y-4" onSubmit={(event) => void onSubmit(event)}>
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
          <label className="block text-sm">
            <span className="text-ink-600">Access code</span>
            <input
              type="password"
              autoComplete="off"
              required
              value={accessCode}
              onChange={(event) => setAccessCode(event.target.value)}
              className="mt-1 w-full rounded-lg border border-line-strong bg-paper-50 px-3 py-2 text-ink-900 outline-none focus:border-brand-500"
            />
          </label>
          {error && <p className="mt-0 text-sm text-danger-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-60"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
