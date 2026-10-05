import { useState } from 'react';
import { api, type AiAllowance } from '../../lib/api';
import { ATMOSPHERE_SELF_SERVE_PLANS } from '../../lib/atmospherePlans';
import { APP_SHELL_BILLING_NOTE, appShellSafeBillingText, isInAppShell } from '../../lib/appShell';

function day(iso: string | null | undefined) {
  return iso
    ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';
}

/**
 * Credit history rows by kind. Customers never see allowance or credit dollar
 * amounts (internal Analytics shows those), and ledger notes can carry a pack
 * price, so rows show what happened and when, not the note or the amount.
 */
const CREDIT_KIND_LABEL: Record<string, string> = {
  purchase: 'Credits purchased',
  admin_grant: 'Credits added by Atmosphere',
  refund: 'Credits refunded',
  adjustment: 'Credit adjustment',
  consume: 'Credits used',
};

export function AiAllowanceSection({
  allowance,
  currentPlanCode,
  onError,
  onUpdated,
}: {
  allowance: AiAllowance;
  currentPlanCode?: string | null;
  onError: (message: string) => void;
  /** Reload allowance and the current plan after an in-place change. */
  onUpdated?: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [planNotice, setPlanNotice] = useState<string | null>(null);
  const [confirmedPlan, setConfirmedPlan] = useState<string | null>(null);
  const activePlanCode = confirmedPlan ?? currentPlanCode;
  const billingInterval = allowance.billingInterval === 'year' ? 'year' : 'month';
  // iPhone/Android app: no plan, credit, or payment buttons (App Store 3.1.1).
  const inApp = isInAppShell();
  const message = allowance.message ? appShellSafeBillingText(allowance.message, inApp) : null;

  async function buy(packCode: string) {
    setBusy(packCode);
    try {
      const { checkoutUrl } = await api.checkoutAiCredits(packCode);
      if (checkoutUrl) window.location.href = checkoutUrl;
      else onError('Checkout did not return a payment link.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not start checkout.');
      setBusy(null);
    }
  }

  async function changePlan(planCode: string) {
    setBusy(planCode);
    try {
      const result = await api.checkoutAiPlan(planCode, billingInterval);
      if (result.checkoutUrl) window.location.href = result.checkoutUrl;
      else if (result.updated) {
        setConfirmedPlan(result.planCode);
        setPlanNotice('Plan updated. Stripe prorates the difference on this billing period.');
        try {
          await onUpdated?.();
        } catch (refreshErr) {
          onError(refreshErr instanceof Error ? refreshErr.message : 'Could not refresh the plan.');
        }
        setBusy(null);
      } else onError('Checkout did not return a payment link.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not start the plan change.');
      setBusy(null);
    }
  }

  return (
    <section id="credits" className="rounded-xl glass-card p-5 sm:p-6" data-testid="ai-allowance">
      {/* The AI allowance (amount used, total, percent, daily cap, per-feature
          draw) is internal and is not shown to customers. Backend enforcement
          and metering are unchanged; internal Analytics shows the allowance. */}
      <header>
        <h3 className="text-base font-semibold text-ink-900">AI credits</h3>
      </header>

      {planNotice ? (
        <p role="status" data-testid="plan-change-updated" className="mt-4 text-sm text-ink-700">
          {planNotice}
        </p>
      ) : null}
      {message && allowance.state === 'warning' ? (
        <p
          role="status"
          data-testid="ai-allowance-warning"
          className="mt-4 rounded-lg border border-caution-200 bg-caution-50 px-3.5 py-3 text-sm text-caution-700"
        >
          {message}
        </p>
      ) : null}
      {message && allowance.state !== 'warning' ? (
        <p
          role="status"
          data-testid="ai-allowance-status"
          className="mt-4 rounded-lg border border-line bg-paper-50 px-3.5 py-3 text-sm text-ink-700"
        >
          {message}
        </p>
      ) : null}

      {inApp ? (
        <p data-testid="app-shell-billing-note" className="mt-5 border-t border-line pt-4 text-sm text-ink-600">
          {APP_SHELL_BILLING_NOTE}
        </p>
      ) : allowance.canManage ? (
        <div className="mt-6 space-y-5 border-t border-line pt-5">
          <div>
            <h4 className="text-sm font-semibold text-ink-900">Change plan</h4>
            <div className="mt-3 flex flex-wrap gap-2">
              {ATMOSPHERE_SELF_SERVE_PLANS.map((plan) => (
                <button
                  key={plan.code}
                  type="button"
                  data-testid={`upgrade-plan-${plan.code}`}
                  disabled={busy !== null || plan.code === activePlanCode}
                  onClick={() => void changePlan(plan.code)}
                  className="rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm font-medium text-ink-800 transition hover:border-brand-300 disabled:opacity-50"
                >
                  {busy === plan.code ? 'Opening checkout…' : plan.code === activePlanCode ? plan.name : `Switch to ${plan.name}`}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-ink-900">Buy credits</h4>
            <p className="mt-1 text-xs text-ink-500">
              Credits are used after the included allowance and stay on the account until they are used.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {allowance.packs.map((pack) => (
                <button
                  key={pack.code}
                  type="button"
                  data-testid={`buy-credits-${pack.code}`}
                  disabled={busy !== null}
                  onClick={() => void buy(pack.code)}
                  className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-ink-900 transition hover:bg-brand-700 disabled:opacity-50"
                >
                  {busy === pack.code ? 'Opening checkout…' : `Buy ${pack.label}`}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-5 text-xs text-ink-500">An owner can change the plan or buy credits.</p>
      )}

      {inApp ? null : (
        <div className="mt-6 border-t border-line pt-5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Credits</h4>
          {allowance.history.credits.length === 0 ? (
            <p className="mt-2 text-sm text-ink-500">No credit purchases yet.</p>
          ) : (
            <ul className="mt-2 space-y-1.5 text-sm" data-testid="ai-credit-history">
              {allowance.history.credits.map((row) => (
                <li key={row.id} className="flex justify-between gap-3">
                  <span className="text-ink-700">{CREDIT_KIND_LABEL[row.kind] ?? 'Credits'}</span>
                  <span className="text-xs text-ink-400">{day(row.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
