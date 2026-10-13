import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { forgetHomeownerCache } from '../lib/homeownerPortal';
import { SpinnerIcon } from './icons';
import { clearSignInCodeSent, markSignInCodeSent, signInCodeSent } from '../lib/signInCodeSent';

/**
 * The homeowner option on the shared sign-in page: email a one-time sign-in code
 * to the address the job was shared with (#704). The server picks the address
 * from the share, never from this form, so nothing can be enumerated.
 */
export function HomeownerEmailLink({ token, email }: { token: string; email: string | null }) {
  const navigate = useNavigate();
  const { adoptUser } = useAuth();
  const sentKey = `share:${token}`;
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'verifying'>(() =>
    signInCodeSent(sentKey) ? 'sent' : 'idle',
  );
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  // A link that is gone can't be retried here; everything else can.
  const [dead, setDead] = useState(false);

  async function send() {
    setState('sending');
    setError(null);
    try {
      await api.progressShareEmailSignIn(token);
      markSignInCodeSent(sentKey);
      setState('sent');
    } catch (err) {
      setState('idle');
      const code = err instanceof ApiError ? err.code : '';
      if (['not_found', 'revoked', 'expired', 'no_recipient', 'job_deleted'].includes(code)) {
        setDead(true);
        setError(`${(err as Error).message} Ask your contractor to share the job again.`);
      } else if (code === 'rate_limited') {
        setError('Too many emails in a row. Wait a few minutes, then tap Email me a code again.');
      } else {
        setError(err instanceof ApiError ? `${err.message} Tap Email me a code to try again.` : 'Could not send the sign-in email. Tap Email me a code to try again.');
      }
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setState('verifying');
    setError(null);
    try {
      const res = await api.progressShareVerifyEmailSignIn(token, { code: code.trim() });
      clearSignInCodeSent(sentKey);
      forgetHomeownerCache();
      await adoptUser(res.user);
      navigate(res.path, { replace: true });
    } catch (err) {
      setState('sent');
      setError(err instanceof ApiError ? err.message : 'That code did not work. Send a new one.');
    }
  }

  return (
    <div className="mt-6" data-testid="homeowner-email-link">
      {state === 'sent' || state === 'verifying' ? (
        <form onSubmit={verify} className="space-y-3">
          <p className="text-sm text-ink-700" role="status">
            We emailed a sign-in code{email ? <> to <span className="font-medium text-ink-900">{email}</span></> : null}.
            Enter it below.
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
        dead ? null : <>
          {email && (
            <div>
              <label htmlFor="homeowner-email" className="mb-1.5 block text-sm font-medium text-ink-700">
                Email
              </label>
              <input
                id="homeowner-email"
                type="email"
                value={email}
                readOnly
                className="w-full rounded-lg border border-line bg-paper-100 px-3.5 py-2.5 text-ink-900 outline-hidden"
              />
            </div>
          )}
          <p className="mt-3 text-sm text-ink-600">No password needed. We&apos;ll email you a sign-in code.</p>
          <button
            type="button"
            onClick={() => void send()}
            disabled={state === 'sending'}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 font-semibold text-ink-900 disabled:opacity-50"
          >
            {state === 'sending' && <SpinnerIcon className="animate-spin" />}
            Email me a code
          </button>
        </>
      )}
      {error && (
        <div role="alert" className="mt-3 text-sm text-danger-700">
          <p>{error}</p>
          {dead && (
            <a href="/login" className="mt-2 inline-block font-semibold text-brand-600" data-testid="email-link-dead-action">
              Go to sign in
            </a>
          )}
        </div>
      )}
    </div>
  );
}
