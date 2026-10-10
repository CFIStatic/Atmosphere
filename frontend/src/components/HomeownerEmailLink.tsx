import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { forgetHomeownerCache } from '../lib/homeownerPortal';
import { SpinnerIcon } from './icons';

/**
 * The homeowner option on the shared sign-in page: email a one-time link + code
 * to the address the job was shared with (#704). The server picks the address
 * from the share, never from this form, so nothing can be enumerated.
 */
export function HomeownerEmailLink({ token, email }: { token: string; email: string | null }) {
  const navigate = useNavigate();
  const { adoptUser } = useAuth();
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'verifying'>('idle');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setState('sending');
    setError(null);
    try {
      await api.progressShareEmailSignIn(token);
      setState('sent');
    } catch (err) {
      setState('idle');
      setError(err instanceof ApiError ? err.message : 'Could not send the sign-in email.');
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setState('verifying');
    setError(null);
    try {
      const res = await api.progressShareVerifyEmailSignIn(token, { code: code.trim() });
      forgetHomeownerCache();
      await adoptUser(res.user);
      navigate(res.path, { replace: true });
    } catch (err) {
      setState('sent');
      setError(err instanceof ApiError ? err.message : 'That code did not work. Send a new one.');
    }
  }

  return (
    <div className="mt-6 rounded-lg border border-brand-200 bg-brand-50/70 p-4" data-testid="homeowner-email-link">
      {state === 'sent' || state === 'verifying' ? (
        <form onSubmit={verify} className="space-y-3">
          <p className="text-sm text-ink-700" role="status">
            We emailed a sign-in link{email ? <> to <span className="font-medium text-ink-900">{email}</span></> : null}.
            Tap it, or enter the code from the email.
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
            Send a new link
          </button>
        </form>
      ) : (
        <>
          <p className="text-sm text-ink-700">
            No password needed. We&apos;ll email a one-tap sign-in link
            {email ? <> to <span className="font-medium text-ink-900">{email}</span></> : null}.
          </p>
          <button
            type="button"
            onClick={() => void send()}
            disabled={state === 'sending'}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 font-semibold text-ink-900 disabled:opacity-50"
          >
            {state === 'sending' && <SpinnerIcon className="animate-spin" />}
            Email me a link
          </button>
          <p className="mt-3 text-center text-xs text-ink-500">Or sign in with a password below.</p>
        </>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger-700">
          {error}
        </p>
      )}
    </div>
  );
}
