import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, type Membership } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { SpinnerIcon } from './icons';

const RESEND_SECONDS = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inputClass =
  'w-full rounded-lg border border-line bg-paper-0 px-3.5 py-2.5 text-ink-900 placeholder-ink-400 outline-hidden transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200';
const primaryClass =
  'flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 font-semibold text-ink-900 shadow-lg shadow-card transition hover:bg-brand-500 focus:outline-hidden focus:ring-2 focus:ring-brand-200 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Sign in to an existing account with a 6-digit code sent by email, instead
 * of the password. A typed code (not a magic link) so it works in the app.
 */
export function EmailCodeSignIn({
  initialEmail,
  onSignedIn,
}: {
  initialEmail?: string | null;
  onSignedIn: (membership: Membership | null) => void | Promise<void>;
}) {
  const { loginWithEmailCode } = useAuth();
  const [email, setEmail] = useState(initialEmail ?? '');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (sentTo) codeRef.current?.focus();
  }, [sentTo]);

  const target = email.trim().toLowerCase();

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    const to = sentTo ?? target;
    if (!EMAIL_RE.test(to) || busy) {
      if (!busy) setError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    try {
      await api.emailCodeStart(to);
      setSentTo(to);
      setCode('');
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not send a code. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!sentTo || code.length !== 6 || busy) return;
    setBusy(true);
    try {
      await onSignedIn(await loginWithEmailCode(sentTo, code));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That code did not work. Try again.');
      setBusy(false);
    }
  }

  const errorBox = error ? (
    <div role="alert" className="rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-3 text-sm text-danger-700">
      {error}
    </div>
  ) : null;

  if (sentTo) {
    return (
      <form onSubmit={verify} noValidate className="space-y-4" data-testid="email-code-step">
        {errorBox}
        <p className="text-sm text-ink-600">
          If <span className="font-medium text-ink-900">{sentTo}</span> has an Atmosphere account, we emailed it a
          6-digit code.
        </p>
        <div>
          <label htmlFor="email-code" className="mb-1.5 block text-sm font-medium text-ink-700">
            Code
          </label>
          <input
            ref={codeRef}
            id="email-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            className={`${inputClass} text-center font-mono text-lg tracking-[0.4em]`}
          />
        </div>
        <button type="submit" disabled={code.length !== 6 || busy} className={primaryClass}>
          {busy && <SpinnerIcon className="animate-spin" />}
          {busy ? 'Checking…' : 'Sign in'}
        </button>
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={() => {
              setSentTo(null);
              setCode('');
              setError(null);
            }}
            className="font-medium text-ink-600 transition hover:text-ink-900"
          >
            Change email
          </button>
          <button
            type="button"
            onClick={() => void sendCode()}
            disabled={cooldown > 0 || busy}
            className="font-medium text-brand-600 transition hover:text-brand-700 disabled:cursor-not-allowed disabled:text-ink-400"
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={sendCode} noValidate className="space-y-4" data-testid="email-code-start">
      {errorBox}
      <div>
        <label htmlFor="code-email" className="mb-1.5 block text-sm font-medium text-ink-700">
          Email
        </label>
        <input
          id="code-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className={inputClass}
        />
      </div>
      <button type="submit" disabled={!target || busy} className={primaryClass}>
        {busy && <SpinnerIcon className="animate-spin" />}
        {busy ? 'Sending…' : 'Email me a code'}
      </button>
    </form>
  );
}
