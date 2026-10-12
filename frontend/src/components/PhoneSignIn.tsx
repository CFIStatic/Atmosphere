import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, type Membership } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { formatPhone, formatPhoneInput, normalizePhoneE164 } from '../lib/phone';
import { SpinnerIcon } from './icons';

const RESEND_SECONDS = 30;

const inputClass =
  'w-full rounded-lg border border-line bg-paper-0 px-3.5 py-2.5 text-ink-900 placeholder-ink-400 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200';
const primaryClass =
  'flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 font-semibold text-ink-900 shadow-lg shadow-card transition hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Sign in (or create an account) with a mobile number and a 6-digit text code.
 * No password. Two steps: number, then code.
 */
export function PhoneSignIn({
  intent,
  initialPhone,
  acceptedTermsVersion,
  termsReady = true,
  onSignedIn,
}: {
  intent: 'signin' | 'signup';
  initialPhone?: string | null;
  /** Sign-up only: the terms revision the person acknowledged. */
  acceptedTermsVersion?: string;
  /** Sign-up only: false until the terms box is checked. */
  termsReady?: boolean;
  onSignedIn: (membership: Membership | null) => void | Promise<void>;
}) {
  const { loginWithPhone } = useAuth();
  const [phoneInput, setPhoneInput] = useState(() => formatPhoneInput(initialPhone ?? ''));
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

  const phone = normalizePhoneE164(phoneInput);

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    const target = sentTo ?? phone;
    if (!target || busy) return;
    setBusy(true);
    try {
      await api.phoneAuthStart(target, intent);
      setSentTo(target);
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
      const membership = await loginWithPhone(sentTo, code, intent === 'signup' ? acceptedTermsVersion : undefined);
      await onSignedIn(membership);
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
      <form onSubmit={verify} noValidate className="space-y-4" data-testid="phone-code-step">
        {errorBox}
        <p className="text-sm text-ink-600">
          Enter the 6-digit code we texted to{' '}
          <span className="font-medium text-ink-900">{formatPhone(sentTo)}</span>.
        </p>
        <div>
          <label htmlFor="phone-code" className="mb-1.5 block text-sm font-medium text-ink-700">
            Code
          </label>
          <input
            ref={codeRef}
            id="phone-code"
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
          {busy ? 'Checking…' : intent === 'signup' ? 'Create account' : 'Sign in'}
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
            Change number
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
    <form onSubmit={sendCode} noValidate className="space-y-4" data-testid="phone-number-step">
      {errorBox}
      <div>
        <label htmlFor="phone" className="mb-1.5 block text-sm font-medium text-ink-700">
          Mobile number
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phoneInput}
          onChange={(e) => setPhoneInput(formatPhoneInput(e.target.value))}
          placeholder="(555) 123-4567"
          className={inputClass}
        />
        <p className="mt-1.5 text-xs text-ink-500">We&apos;ll text you a 6-digit code. Message and data rates may apply.</p>
      </div>
      <button type="submit" disabled={!phone || busy || !termsReady} className={primaryClass}>
        {busy && <SpinnerIcon className="animate-spin" />}
        {busy ? 'Sending…' : 'Text me a code'}
      </button>
    </form>
  );
}
