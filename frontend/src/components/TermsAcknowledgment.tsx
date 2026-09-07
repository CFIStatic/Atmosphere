import { useState, type FormEvent } from 'react';
import { CURRENT_TERMS_VERSION, PRIVACY_PUBLIC_URL, TERMS_PUBLIC_URL } from '../lib/terms';
import { TermsAckCheckbox } from './TermsAckCheckbox';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { SpinnerIcon } from './icons';

export function TermsAcknowledgment({
  submitting,
  error,
  onAccept,
  onSignOut,
}: {
  submitting?: boolean;
  error?: string | null;
  onAccept: (version: string) => Promise<void> | void;
  onSignOut?: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const disabled = !acknowledged || submitting || busy;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (disabled) return;
    setBusy(true);
    try {
      await onAccept(CURRENT_TERMS_VERSION);
    } finally {
      setBusy(false);
    }
  }

  const waiting = submitting || busy;

  return (
    <div className="relative flex min-h-screen flex-col bg-paper-100">
      <header className="flex items-center justify-between gap-4 px-6 py-8 sm:px-10 sm:py-10">
        <Logo size="lg" to={null} />
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md animate-fade-in-up">
          <div className="rounded-2xl border border-line bg-paper-0 p-8 shadow-lift sm:p-10">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">
              Terms of Service
            </p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink-900">
              Please acknowledge the Terms
            </h1>
            <p className="mt-1.5 text-sm text-ink-600">
              Please acknowledge the Terms of Service before using Atmosphere.
              If the Terms change, we will ask you to review them again.
            </p>

            {error ? (
              <div
                role="alert"
                className="mt-6 rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-3 text-sm text-danger-700"
              >
                {error}
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              <TermsAckCheckbox
                id="terms-ack"
                checked={acknowledged}
                onChange={setAcknowledged}
              />
              <button
                type="submit"
                disabled={disabled}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 font-semibold text-ink-900 shadow-lg shadow-card transition hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 focus:ring-offset-2 focus:ring-offset-ink-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {waiting ? <SpinnerIcon className="animate-spin" /> : null}
                {waiting ? 'Saving…' : 'Continue'}
              </button>
            </form>

            {onSignOut ? (
              <button
                type="button"
                onClick={onSignOut}
                className="mt-4 w-full text-center text-sm font-medium text-ink-600 transition hover:text-ink-900"
              >
                Sign out
              </button>
            ) : null}
          </div>
          <p className="mt-6 text-center text-xs text-ink-400">
            Read the{' '}
            <a
              href={TERMS_PUBLIC_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-ink-600 underline underline-offset-2 hover:text-ink-900"
            >
              Terms of Service
            </a>{' '}
            and{' '}
            <a
              href={PRIVACY_PUBLIC_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-ink-600 underline underline-offset-2 hover:text-ink-900"
            >
              Privacy Policy
            </a>
            .
          </p>
        </div>
      </main>
    </div>
  );
}
