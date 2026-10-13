import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { forgetHomeownerCache } from '../lib/homeownerPortal';
import { SpinnerIcon } from './icons';
import { clearSignInCodeSent, markSignInCodeSent, signInCodeSent } from '../lib/signInCodeSent';

const SENT_KEY = 'homeowner-email';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Sign-up page option for homeowners: type the email a contractor shared a
 * job with, get the same sign-in code as a share link. No password,
 * no plan, no billing. The server answers the same for every email, so this
 * never reveals whether an account or an invite exists.
 */
export function HomeownerEmailSignIn({ initialEmail, onBack }: { initialEmail?: string; onBack: () => void }) {
  const navigate = useNavigate();
  const { adoptUser } = useAuth();
  const [sentTo] = useState(() => signInCodeSent(SENT_KEY));
  const [email, setEmail] = useState(sentTo ?? initialEmail ?? '');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'verifying'>(sentTo ? 'sent' : 'idle');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const valid = EMAIL_RE.test(email.trim());

  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (!valid) return;
    setState('sending');
    setError(null);
    try {
      await api.homeownerEmailSignIn(email.trim());
      markSignInCodeSent(SENT_KEY, email.trim());
      setState('sent');
    } catch (err) {
      setState('idle');
      setError(
        err instanceof ApiError && err.code === 'rate_limited'
          ? 'Too many emails in a row. Wait a few minutes, then try again.'
          : 'Could not send the sign-in email. Try again.',
      );
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (code.length < 6) return;
    setState('verifying');
    setError(null);
    try {
      const res = await api.homeownerVerifyEmailSignIn(email.trim(), code.trim());
      clearSignInCodeSent(SENT_KEY);
      forgetHomeownerCache();
      await adoptUser(res.user);
      navigate(res.path, { replace: true });
    } catch {
      setState('sent');
      setError('That code did not work. Check the newest email, or send a new one.');
    }
  }

  return (
    <div className="mt-6" data-testid="homeowner-email-signin">
      {state === 'sent' || state === 'verifying' ? (
        <form onSubmit={verify} className="space-y-3">
          <p className="text-sm text-ink-700" role="status">
            If a contractor shared a job with <span className="font-medium text-ink-900">{email.trim()}</span>, we
            just emailed a sign-in code. Enter it below. No email in a few minutes? Ask
            your contractor to share the job with this address.
          </p>
          <div className="flex gap-2">
            <input
              aria-label="Code from the email"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="123456"
              className="min-w-0 flex-1 rounded-lg border border-line bg-paper-0 px-3 py-2 text-ink-900"
            />
            <button
              type="submit"
              disabled={state === 'verifying' || code.length < 6}
              className="rounded-lg bg-ink-900 px-3.5 py-2 text-sm font-semibold text-paper-0 disabled:opacity-50"
            >
              {state === 'verifying' ? 'Opening…' : 'Continue'}
            </button>
          </div>
          <button type="button" onClick={() => void send()} className="text-xs font-medium text-brand-600">
            Send a new code
          </button>
        </form>
      ) : (
        <form onSubmit={send} noValidate>
          <label htmlFor="homeowner-signin-email" className="mb-1.5 block text-sm font-medium text-ink-700">
            Email the job was shared with
          </label>
          <input
            id="homeowner-signin-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-lg border border-line bg-paper-0 px-3.5 py-2.5 text-ink-900 placeholder-ink-400 outline-hidden transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
          />
          <p className="mt-3 text-sm text-ink-600">No password, no plan. We&apos;ll email you a sign-in code.</p>
          <button
            type="submit"
            disabled={!valid || state === 'sending'}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 font-semibold text-ink-900 disabled:opacity-50"
          >
            {state === 'sending' && <SpinnerIcon className="animate-spin" />}
            Email me a code
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger-700">
          {error}
        </p>
      )}
      <p className="mt-4 text-center text-sm">
        <button type="button" onClick={onBack} className="font-medium text-brand-600 hover:text-brand-700">
          Back to create an account
        </button>
      </p>
    </div>
  );
}
