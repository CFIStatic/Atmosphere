import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type BillingOnboardingStatus } from '../../lib/api';
import { formatCents } from '../../lib/money';
import { SetupStepCard } from './SetupWizardShell';
import { SpinnerIcon } from '../icons';

export function SetupBillingStep({
  redirectTo,
  checkoutOutcome,
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
          setNotice('Confirming payment…');
        } else if (checkoutOutcome === 'cancelled') {
          setNotice('Checkout cancelled.');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load billing.');
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
          window.clearInterval(timer);
        } else if (attempts >= 12) {
          window.clearInterval(timer);
          setNotice('Still confirming — try again in a moment.');
        }
      } catch {
        /* keep polling */
      }
    }, 2500);

    return () => window.clearInterval(timer);
  }, [checkoutOutcome, refresh, status?.complete, status?.required]);

  useEffect(() => {
    if (!status || autoEnteredRef.current) return;
    if (status.required && !status.complete) return;
    autoEnteredRef.current = true;
    onComplete();
  }, [onComplete, status]);

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
      setError('Could not open checkout. Try again.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open checkout.');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !status || !status.required || status.complete) {
    return (
      <SetupStepCard title="Payment">
        <div className="mt-10 grid place-items-center text-brand-600">
          <SpinnerIcon className="animate-spin" width={28} height={28} />
        </div>
      </SetupStepCard>
    );
  }

  const plan = status.plan;

  return (
    <SetupStepCard title="Payment">
      {error && (
        <div
          role="alert"
          className="mt-6 rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-3 text-sm text-danger-700"
        >
          {error}
        </div>
      )}
      {notice && (
        <p role="status" className="mt-6 text-sm text-ink-600">
          {notice}
        </p>
      )}

      <p className="mt-8 text-3xl font-bold tracking-tight text-ink-900">
        {formatCents(plan.baseMonthlyFeeCents)}
        <span className="text-base font-medium text-ink-500"> / month</span>
      </p>

      <div className="mt-8 flex justify-end">
        <button
          type="button"
          disabled={busy || Boolean(notice?.includes('Confirming'))}
          onClick={() => void startCheckout()}
          className="flex min-w-[160px] items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-3 font-semibold text-ink-900 shadow-lg shadow-card transition hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <>
              <SpinnerIcon className="animate-spin" width={18} height={18} />
              Opening…
            </>
          ) : (
            'Continue'
          )}
        </button>
      </div>
    </SetupStepCard>
  );
}
