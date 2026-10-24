import { lazy, Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type PayoutsStatus } from '../../lib/api';
import { Button } from '../../design';
import type { EmbeddedView } from './StripeConnectEmbedded';

// connect-js only loads when an owner opens payout setup.
const StripeConnectEmbedded = lazy(() => import('./StripeConnectEmbedded'));

/**
 * Billing > Get paid by homeowners. Owner only (the route is owner-gated).
 * Onboards the workspace's Stripe Connect account inside Atmosphere (Connect
 * embedded components) so homeowners can pay deductibles and invoices from the
 * job file. Falls back to Stripe-hosted onboarding only if the server has no
 * publishable key for embedded setup.
 */
export function PayoutsSection() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState<PayoutsStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<EmbeddedView | null>(null);

  useEffect(() => {
    let live = true;
    const load = params.get('payouts') === 'return' ? api.refreshPayouts() : api.payoutsStatus();
    load
      .then((s) => live && setStatus(s))
      .catch(() => live && setStatus(null));
    return () => {
      live = false;
    };
  }, [params]);

  if (!status?.available) return null;
  const acct = status.account;
  const ready = Boolean(acct?.chargesEnabled);
  const feeLabel = `${(status.feeBps / 100).toFixed(status.feeBps % 100 ? 2 : 0)}%${
    status.feeFlatCents ? ` + ${(status.feeFlatCents / 100).toFixed(2)}` : ''
  }`;

  const embedded = Boolean(status.embedded);
  const finishedSetup = () => {
    setView(null);
    api.refreshPayouts().then(setStatus).catch(() => undefined);
  };

  const go = async (fn: () => Promise<{ url: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await fn();
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open Stripe.');
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl glass-card p-5 sm:p-6" data-testid="payouts-section">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink-900">Get paid by homeowners</h3>
          <p className="mt-0.5 text-xs text-ink-500">
            Homeowners pay deductibles and invoices by card or bank transfer from their job file. Payments are held and
            released to your bank account line by line as you confirm the work.
          </p>
        </div>
        {status.testMode ? (
          <span className="rounded-full bg-caution-50 px-2.5 py-0.5 text-[11px] font-semibold text-caution-600 ring-1 ring-caution-200">
            Test mode
          </span>
        ) : null}
      </header>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-line px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink-900" data-testid="payouts-state">
            {ready
              ? acct?.payoutsEnabled
                ? 'Ready: payments and payouts are on'
                : 'Payments on. Payouts start once Stripe verifies your bank.'
              : acct?.detailsSubmitted
                ? 'Stripe is reviewing your details'
                : acct
                  ? 'Setup started. Finish it to take payments.'
                  : 'Not set up'}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">
            Atmosphere fee: {feeLabel} of each payment. Card and bank processing fees are included.
            {acct && acct.requirementsDue > 0 ? ` Stripe needs ${acct.requirementsDue} more item(s).` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          {ready && embedded ? (
            <>
              <Button
                variant={view === 'payouts' ? 'primary' : 'outline'}
                size="sm"
                onClick={() => setView(view === 'payouts' ? null : 'payouts')}
                data-testid="payouts-view-payouts"
              >
                Payouts
              </Button>
              <Button
                variant={view === 'account' ? 'primary' : 'outline'}
                size="sm"
                onClick={() => setView(view === 'account' ? null : 'account')}
                data-testid="payouts-view-account"
              >
                Bank &amp; business details
              </Button>
            </>
          ) : null}
          {ready && !embedded ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => go(api.openPayoutsDashboard)}>
              Open payouts dashboard
            </Button>
          ) : null}
          {(!ready || (acct && acct.requirementsDue > 0)) && view !== 'onboarding' ? (
            <Button
              size="sm"
              loading={busy}
              disabled={busy}
              onClick={() => (embedded ? setView('onboarding') : go(api.startPayoutsOnboarding))}
              data-testid="payouts-onboard"
            >
              {acct ? 'Continue setup' : 'Set up payouts'}
            </Button>
          ) : null}
        </div>
      </div>
      {view ? (
        <div className="mt-3 rounded-lg border border-line p-4" data-testid="payouts-embedded">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-ink-900">
              {view === 'onboarding' ? 'Set up payouts' : view === 'payouts' ? 'Payouts' : 'Bank & business details'}
            </p>
            <button type="button" className="text-xs text-ink-500 hover:text-ink-900" onClick={() => (view === 'onboarding' ? finishedSetup() : setView(null))}>
              Close
            </button>
          </div>
          <Suspense fallback={<p className="text-xs text-ink-500">Loading payout setup…</p>}>
            <StripeConnectEmbedded key={view} view={view} onExit={finishedSetup} />
          </Suspense>
          <p className="mt-3 text-[11px] text-ink-400">Payments are processed securely by Stripe.</p>
        </div>
      ) : null}
      {acct ? (
        <label className="mt-3 flex items-start gap-3 rounded-lg border border-line px-4 py-3" data-testid="ai-release-setting">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={Boolean(acct.allowAiRelease)}
            disabled={busy}
            onChange={async (e) => {
              setBusy(true);
              setError(null);
              try {
                setStatus(await api.setPayoutsSettings({ allowAiRelease: e.target.checked }));
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not save.');
              } finally {
                setBusy(false);
              }
            }}
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink-900">Release payments on AI verification alone</span>
            <span className="block text-xs text-ink-500">
              Off: homeowner payments are held per line until you or an admin taps Confirm &amp; release. On: a line releases as
              soon as the AI verifies it from the job videos.
            </span>
          </span>
        </label>
      ) : null}
      {error ? <p className="mt-2 text-xs text-danger-700">{error}</p> : null}
    </section>
  );
}
