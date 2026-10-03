import { useState } from 'react';
import { api, type AiAllowance } from '../../lib/api';
import { ATMOSPHERE_SELF_SERVE_PLANS } from '../../lib/atmospherePlans';
import { formatUsd } from '../../lib/money';

function day(iso: string | null | undefined) {
  return iso
    ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';
}

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
      {allowance.message && allowance.state === 'warning' ? (
        <p
          role="status"
          data-testid="ai-allowance-warning"
          className="mt-4 rounded-lg border border-caution-200 bg-caution-50 px-3.5 py-3 text-sm text-caution-700"
        >
          {allowance.message}
        </p>
      ) : null}
      {allowance.message && allowance.state !== 'warning' ? (
        <p
          role="status"
          data-testid="ai-allowance-status"
          className="mt-4 rounded-lg border border-line bg-paper-50 px-3.5 py-3 text-sm text-ink-700"
        >
          {allowance.message}
        </p>
      ) : null}

      <dl className="mt-5 space-y-3 border-t border-line pt-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-ink-500">Credit balance</dt>
          <dd className="font-medium tabular-nums text-ink-900" data-testid="ai-credit-balance">
            {formatUsd(allowance.creditBalanceNanos)}
          </dd>
        </div>
      </dl>

      {allowance.canManage ? (
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

      <div className="mt-6 border-t border-line pt-5">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Credits</h4>
          {allowance.history.credits.length === 0 ? (
            <p className="mt-2 text-sm text-ink-500">No credit purchases yet.</p>
          ) : (
            <ul className="mt-2 space-y-1.5 text-sm">
              {allowance.history.credits.map((row) => (
                <li key={row.id} className="flex justify-between gap-3">
                  <span className="text-ink-700">
                    {row.note || row.kind}
                    <span className="ml-2 text-xs text-ink-400">{day(row.at)}</span>
                  </span>
                  <span className="tabular-nums text-ink-900">{formatUsd(row.deltaNanos)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
