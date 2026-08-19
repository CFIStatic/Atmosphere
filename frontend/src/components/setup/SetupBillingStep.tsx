import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type BillingOnboardingStatus } from '../../lib/api';
import { formatCents } from '../../lib/money';
import { SetupStepCard } from './SetupWizardShell';
import { SpinnerIcon, CheckIcon } from '../icons';

export function SetupBillingStep({
  redirectTo,
  checkoutOutcome,
  nextLabel = 'Continue',
  onComplete,
}: {
  redirectTo: string;
  checkoutOutcome: 'success' | 'cancelled' | null;
  nextLabel?: string;
  onComplete: () => void;
}) {
  const [status, setStatus] = useState<BillingOnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const autoEnteredRef = useRef(false);

  const refresh = useCallback(async () => {
    const next = await api.getBillingOnboarding();
    setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await refresh();
        if (cancelled) return;
        if (checkoutOutcome === 'success' && next.required && !next.complete) {
          setNotice('Payment received — confirming your subscription…');
        } else if (checkoutOutcome === 'cancelled') {
          setNotice('Checkout cancelled. Add a payment method when you are ready.');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load billing status.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [checkoutOutcome, refresh]);

  useEffect(() => {
    if (checkoutOutcome !== 'success' || !status?.required || status.complete) return;

    let attempts = 0;
    const timer = window.setInterval(async () => {
      attempts += 1;
      try {
        const next = await refresh();
        if (next.complete) {
          setNotice('Payment confirmed.');
          window.clearInterval(timer);
        } else if (attempts >= 12) {
          window.clearInterval(timer);
          setNotice(
            'Still confirming with Stripe. This usually takes a few seconds — refresh or try again shortly.',
          );
        }
      } catch {
        /* keep polling */
      }
    }, 2500);

    return () => window.clearInterval(timer);
  }, [checkoutOutcome, refresh, status?.complete, status?.required]);

  useEffect(() => {
    if (checkoutOutcome !== 'success' || !status?.complete || autoEnteredRef.current) return;
    autoEnteredRef.current = true;
    onComplete();
  }, [checkoutOutcome, onComplete, status?.complete]);

  async function startCheckout() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { checkoutUrl } = await api.startOnboardingCheckout(redirectTo);
      if (checkoutUrl) {
        window.location.assign(checkoutUrl);
        return;
      }
      setError('Stripe did not return a checkout link. Try again in a moment.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open Stripe checkout.');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !status) {
    return (
      <SetupStepCard step={3} title="Set up billing" subtitle="Loading your plan details…">
        <div className="mt-10 grid place-items-center text-brand-600">
          <SpinnerIcon className="animate-spin" width={28} height={28} />
        </div>
      </SetupStepCard>
    );
  }

  if (!status.required || status.complete) {
    return (
      <SetupStepCard
        step={3}
        title="Billing ready"
        subtitle={
          status.complete
            ? 'Your payment method is on file.'
            : 'Your organization handles billing separately.'
        }
      >
        <div className="mt-6 flex items-start gap-2 rounded-lg border border-success-200 bg-success-50 px-3.5 py-3 text-sm text-success-600">
          <CheckIcon className="mt-0.5 shrink-0" width={18} height={18} />
          <span>
            {status.complete
              ? 'Subscription active.'
              : 'No payment setup needed for your account.'}
          </span>
        </div>
        <div className="mt-7 flex justify-end">
          <button
            type="button"
            onClick={onComplete}
            className="flex min-w-[200px] items-center justify-center rounded-lg bg-brand-500 px-4 py-3 font-semibold text-ink-900 shadow-lg shadow-card transition hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          >
            {nextLabel}
          </button>
        </div>
      </SetupStepCard>
    );
  }

  const plan = status.plan;

  return (
    <SetupStepCard step={3} title="Set up billing" subtitle="Add a payment method to activate the workspace.">
      {error && (
        <div
          role="alert"
          className="mt-6 rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-3 text-sm text-danger-700"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="mt-6 flex items-start gap-2 rounded-lg border border-success-200 bg-success-50 px-3.5 py-3 text-sm text-success-600"
        >
          <CheckIcon className="mt-0.5 shrink-0" width={18} height={18} />
          <span>{notice}</span>
        </div>
      )}

      <div className="mt-6 rounded-xl border border-line bg-paper-50 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-500">{plan.name}</p>
        <p className="mt-2 text-3xl font-bold tracking-tight text-ink-900">
          {formatCents(plan.baseMonthlyFeeCents)}
          <span className="text-base font-medium text-ink-500"> / month</span>
        </p>
      </div>

      <div className="mt-7 flex justify-end">
        {status.complete ? (
          <button
            type="button"
            onClick={onComplete}
            className="flex min-w-[180px] items-center justify-center rounded-lg bg-brand-500 px-4 py-3 font-semibold text-ink-900 shadow-lg shadow-card transition hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          >
            {nextLabel}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || Boolean(notice?.includes('confirming'))}
            onClick={() => void startCheckout()}
            className="flex min-w-[200px] items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-3 font-semibold text-ink-900 shadow-lg shadow-card transition hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <>
                <SpinnerIcon className="animate-spin" width={18} height={18} />
                Opening Stripe…
              </>
            ) : (
              'Continue to Stripe'
            )}
          </button>
        )}
      </div>
    </SetupStepCard>
  );
}
