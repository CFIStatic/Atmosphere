import { useState } from 'react';
import { api, type AiAllowance } from '../../lib/api';
import {
  ATMOSPHERE_SELF_SERVE_PLANS,
  EXTRA_FC_SEAT_ANNUAL_CENTS,
  EXTRA_FC_SEAT_MONTHLY_CENTS,
  fieldCaptureSeatLabel,
  planAnnualCents,
} from '../../lib/atmospherePlans';
import { APP_SHELL_BILLING_NOTE, appShellSafeBillingText, isInAppShell } from '../../lib/appShell';
import { formatCents } from '../../lib/money';
import { cn } from '../../design/cn';

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

type PlanOption = (typeof ATMOSPHERE_SELF_SERVE_PLANS)[number];
type PlanDirection = 'upgrade' | 'downgrade' | 'switch';

/** Catalog order is cheapest first, so a later plan is an upgrade. */
function planDirection(code: string, currentCode: string | null | undefined): PlanDirection {
  const from = ATMOSPHERE_SELF_SERVE_PLANS.findIndex((plan) => plan.code === currentCode);
  const to = ATMOSPHERE_SELF_SERVE_PLANS.findIndex((plan) => plan.code === code);
  if (from < 0 || to < 0) return 'switch';
  return to > from ? 'upgrade' : 'downgrade';
}

const DIRECTION_LABEL: Record<PlanDirection, string> = {
  upgrade: 'Upgrade',
  downgrade: 'Downgrade',
  switch: 'Switch',
};

export function AiAllowanceSection({
  allowance,
  currentPlanCode,
  complimentary = false,
  hasStripeSubscription = true,
  fieldCaptureAccountsUsed,
  onError,
  onUpdated,
}: {
  allowance: AiAllowance;
  currentPlanCode?: string | null;
  /** Comped workspace: plan changes are free and credits are unlimited, so no Buy buttons. */
  complimentary?: boolean;
  /** False when there is no live subscription yet, so a plan change opens Stripe Checkout. */
  hasStripeSubscription?: boolean;
  /** Field Capture accounts in use today, to warn before a downgrade below that. */
  fieldCaptureAccountsUsed?: number;
  onError: (message: string) => void;
  /** Reload allowance and the current plan after an in-place change. */
  onUpdated?: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [planNotice, setPlanNotice] = useState<string | null>(null);
  const [confirmedPlan, setConfirmedPlan] = useState<string | null>(null);
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);
  const activePlanCode = confirmedPlan ?? currentPlanCode;
  const billingInterval = allowance.billingInterval === 'year' ? 'year' : 'month';
  const perLabel = billingInterval === 'year' ? '/yr' : '/mo';
  const priceOf = (plan: PlanOption) => (billingInterval === 'year' ? planAnnualCents(plan) : plan.monthlyCents);
  const currentPlan = ATMOSPHERE_SELF_SERVE_PLANS.find((plan) => plan.code === activePlanCode) ?? null;
  const pending = ATMOSPHERE_SELF_SERVE_PLANS.find((plan) => plan.code === pendingPlan) ?? null;
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
    setPendingPlan(null);
    setBusy(planCode);
    try {
      const result = await api.checkoutAiPlan(planCode, billingInterval);
      if (result.checkoutUrl) window.location.href = result.checkoutUrl;
      else if (result.updated) {
        setConfirmedPlan(result.planCode);
        setPlanNotice(
          result.complimentary || complimentary
            ? 'Plan updated. No charge, this workspace is complimentary.'
            : 'Plan updated. Stripe prorates the difference on this billing period.',
        );
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
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {ATMOSPHERE_SELF_SERVE_PLANS.map((plan) => {
                const current = plan.code === activePlanCode;
                const direction = planDirection(plan.code, activePlanCode);
                return (
                  <div
                    key={plan.code}
                    data-testid={`plan-option-${plan.code}`}
                    className={cn(
                      'flex flex-col rounded-lg border p-3.5',
                      current ? 'border-brand-300 bg-brand-50' : 'border-line bg-paper-0',
                      plan.code === pendingPlan && 'border-brand-400',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-ink-900">{plan.name}</span>
                      {current ? (
                        <span className="rounded-full bg-brand-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-white">
                          Current
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1.5 text-lg font-semibold tabular-nums tracking-tight text-ink-900">
                      {formatCents(priceOf(plan))}
                      <span className="text-sm font-medium text-ink-500">{perLabel}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-ink-600">{fieldCaptureSeatLabel(plan.includedFcSeats)}</p>
                    <p className="mb-3 text-xs text-ink-500">Platform and AI allowance included</p>
                    <button
                      type="button"
                      data-testid={`upgrade-plan-${plan.code}`}
                      disabled={busy !== null || current}
                      onClick={() => setPendingPlan(plan.code)}
                      className={cn(
                        'mt-auto rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-50',
                        direction === 'upgrade' && !current
                          ? 'bg-brand-600 font-semibold text-ink-900 hover:bg-brand-700'
                          : 'border border-line bg-paper-0 text-ink-800 hover:border-brand-300',
                      )}
                    >
                      {busy === plan.code
                        ? complimentary || hasStripeSubscription
                          ? 'Switching…'
                          : 'Opening checkout…'
                        : current
                          ? 'Current plan'
                          : `${DIRECTION_LABEL[direction]} to ${plan.name}`}
                    </button>
                  </div>
                );
              })}
            </div>
            {pending ? (
              <PlanChangeConfirm
                plan={pending}
                currentPlan={currentPlan}
                direction={planDirection(pending.code, activePlanCode)}
                newPrice={priceOf(pending)}
                currentPrice={currentPlan ? priceOf(currentPlan) : null}
                perLabel={perLabel}
                extraSeatCents={billingInterval === 'year' ? EXTRA_FC_SEAT_ANNUAL_CENTS : EXTRA_FC_SEAT_MONTHLY_CENTS}
                complimentary={complimentary}
                hasStripeSubscription={hasStripeSubscription}
                fieldCaptureAccountsUsed={fieldCaptureAccountsUsed}
                onConfirm={() => void changePlan(pending.code)}
                onCancel={() => setPendingPlan(null)}
              />
            ) : null}
          </div>
          {complimentary ? (
            <p data-testid="ai-credits-complimentary" className="text-sm text-ink-600">
              AI credits are unlimited on this complimentary workspace. Plan changes are free.
            </p>
          ) : (
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
          )}
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

function PlanChangeConfirm({
  plan,
  currentPlan,
  direction,
  newPrice,
  currentPrice,
  perLabel,
  extraSeatCents,
  complimentary,
  hasStripeSubscription,
  fieldCaptureAccountsUsed,
  onConfirm,
  onCancel,
}: {
  plan: PlanOption;
  currentPlan: PlanOption | null;
  direction: PlanDirection;
  newPrice: number;
  currentPrice: number | null;
  perLabel: string;
  extraSeatCents: number;
  complimentary: boolean;
  hasStripeSubscription: boolean;
  fieldCaptureAccountsUsed?: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const action = DIRECTION_LABEL[direction];
  const diff = currentPrice === null ? null : newPrice - currentPrice;
  const overSeats =
    direction === 'downgrade' &&
    fieldCaptureAccountsUsed !== undefined &&
    fieldCaptureAccountsUsed > plan.includedFcSeats;

  let priceLine: string;
  if (complimentary) {
    priceLine = `List price ${formatCents(newPrice)}${perLabel}. No charge, this workspace is complimentary.`;
  } else if (diff !== null && currentPlan) {
    const change = diff === 0 ? 'the same price' : `${formatCents(Math.abs(diff))}${perLabel} ${diff > 0 ? 'more' : 'less'}`;
    priceLine = `${formatCents(newPrice)}${perLabel} instead of ${formatCents(currentPrice!)}${perLabel}, ${change}.`;
  } else {
    priceLine = `${formatCents(newPrice)}${perLabel}.`;
  }

  let billLine: string | null = null;
  if (!complimentary) {
    if (!hasStripeSubscription) billLine = 'You pay on the Stripe checkout page next. Nothing is charged until you finish there.';
    else if (direction === 'upgrade')
      billLine = 'The change starts now. The difference for the rest of this billing period is added to your next invoice.';
    else if (direction === 'downgrade')
      billLine = `The change starts now. Unused time on ${currentPlan?.name ?? 'the current plan'} is credited on your next invoice.`;
    else billLine = 'The change starts now. Stripe prorates the difference on your next invoice.';
  }

  return (
    <div
      role="dialog"
      aria-label={`${action} to ${plan.name}`}
      data-testid="plan-change-confirm"
      className="mt-3 rounded-lg border border-line bg-paper-50 px-4 py-3.5 text-sm text-ink-700"
    >
      <p className="font-semibold text-ink-900">
        {action} to {plan.name}
      </p>
      <ul className="mt-2 space-y-1">
        <li data-testid="plan-change-price">{priceLine}</li>
        <li>
          {currentPlan
            ? `Includes ${fieldCaptureSeatLabel(plan.includedFcSeats)} instead of ${currentPlan.includedFcSeats}.`
            : `Includes ${fieldCaptureSeatLabel(plan.includedFcSeats)}.`}{' '}
          {direction === 'upgrade'
            ? 'The AI allowance grows with the plan.'
            : direction === 'downgrade'
              ? 'The AI allowance shrinks with the plan.'
              : 'The AI allowance follows the plan.'}
        </li>
        {overSeats ? (
          <li data-testid="plan-change-seat-warning" className="text-caution-700">
            This workspace already has {fieldCaptureAccountsUsed} Field Capture accounts and {plan.name} includes{' '}
            {plan.includedFcSeats}. They keep working.
            {complimentary ? '' : ` New accounts past the limit are ${formatCents(extraSeatCents)}${perLabel} each.`}
          </li>
        ) : null}
        {billLine ? <li data-testid="plan-change-bill">{billLine}</li> : null}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          data-testid={`confirm-plan-${plan.code}`}
          onClick={onConfirm}
          className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-ink-900 transition hover:bg-brand-700"
        >
          {hasStripeSubscription || complimentary ? `Confirm ${action.toLowerCase()}` : 'Continue to checkout'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm font-medium text-ink-800 transition hover:border-brand-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
