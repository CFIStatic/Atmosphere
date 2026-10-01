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
}: {
  allowance: AiAllowance;
  currentPlanCode?: string | null;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const percent = allowance.state === 'unlimited' ? 0 : Math.min(100, Math.round(allowance.usedFraction * 100));
  const bar = allowance.state === 'limited' ? 100 : percent;
  const tone =
    allowance.state === 'limited'
      ? 'bg-danger-600'
      : allowance.state === 'warning'
        ? 'bg-caution-500'
        : 'bg-brand-600';

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
      const { checkoutUrl } = await api.checkoutAiPlan(planCode, 'month');
      if (checkoutUrl) window.location.href = checkoutUrl;
      else onError('Checkout did not return a payment link.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not start the plan change.');
      setBusy(null);
    }
  }

  return (
    <section id="credits" className="rounded-xl glass-card p-5 sm:p-6" data-testid="ai-allowance">
      <header>
        <h3 className="text-base font-semibold text-ink-900">AI usage allowance</h3>
        <p className="mt-0.5 text-xs text-ink-500">
          Included with this plan for the current billing period. Resets {day(allowance.resetAt)}.
        </p>
      </header>

      {allowance.state === 'unlimited' ? (
        <p className="mt-4 text-sm text-ink-600">This account is not limited by an AI usage allowance.</p>
      ) : (
        <div className="mt-5" data-testid="ai-allowance-meter">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-2xl font-semibold tabular-nums tracking-tight text-ink-900">
              {formatUsd(allowance.usedNanos)}
              <span className="text-base font-medium text-ink-500"> of {formatUsd(allowance.allowanceNanos)}</span>
            </p>
            <p className="text-sm font-medium tabular-nums text-ink-600" data-testid="ai-allowance-percent">
              {percent}%
            </p>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-paper-200">
            <div className={`h-full rounded-full ${tone}`} style={{ width: `${bar}%` }} />
          </div>
        </div>
      )}

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
        <div className="flex justify-between gap-4">
          <dt className="text-ink-500">Daily limit</dt>
          <dd className="text-right text-ink-900">
            {!allowance.rolling.enabled
              ? 'Off'
              : allowance.rolling.limited
                ? `Paused until usage in the last ${allowance.rolling.hours} hours drops`
                : `${formatUsd(allowance.rolling.usedNanos)} of ${formatUsd(allowance.rolling.capNanos ?? 0)} in the last ${allowance.rolling.hours} hours`}
          </dd>
        </div>
      </dl>

      {allowance.byFeature.length > 0 ? (
        <div className="mt-5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-500">This period</h4>
          <ul className="mt-2 space-y-1.5 text-sm">
            {allowance.byFeature.map((row) => (
              <li key={row.feature} className="flex justify-between gap-4">
                <span className="text-ink-700">{row.label}</span>
                <span className="tabular-nums text-ink-900">{formatUsd(row.nanos)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
                  disabled={busy !== null || plan.code === currentPlanCode}
                  onClick={() => void changePlan(plan.code)}
                  className="rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm font-medium text-ink-800 transition hover:border-brand-300 disabled:opacity-50"
                >
                  {busy === plan.code ? 'Opening checkout…' : plan.code === currentPlanCode ? plan.name : `Switch to ${plan.name}`}
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

      <div className="mt-6 grid gap-5 border-t border-line pt-5 sm:grid-cols-2">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Usage</h4>
          {allowance.history.usage.length === 0 ? (
            <p className="mt-2 text-sm text-ink-500">No AI usage in this period yet.</p>
          ) : (
            <ul className="mt-2 space-y-1.5 text-sm">
              {allowance.history.usage.map((row) => (
                <li key={row.id} className="flex justify-between gap-3">
                  <span className="text-ink-700">
                    {row.label}
                    <span className="ml-2 text-xs text-ink-400">{day(row.at)}</span>
                  </span>
                  <span className="tabular-nums text-ink-900">{formatUsd(row.nanos)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
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
