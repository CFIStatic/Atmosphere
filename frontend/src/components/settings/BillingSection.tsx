import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type Payment, type WorkspaceBilling } from '../../lib/api';
import { formatCents } from '../../lib/money';
import { AlertIcon, SpinnerIcon } from '../icons';
import { TokenUsageSection } from './TokenUsageSection';

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-success-50 text-success-700 ring-1 ring-success-200',
  trialing: 'bg-brand-50 text-brand-700 ring-1 ring-brand-200',
  past_due: 'bg-danger-50 text-danger-700 ring-1 ring-danger-200',
  unpaid: 'bg-caution-50 text-caution-800 ring-1 ring-caution-200',
  incomplete: 'bg-caution-50 text-caution-800 ring-1 ring-caution-200',
  canceled: 'bg-paper-200/60 text-ink-500 ring-1 ring-line',
  cancelled: 'bg-paper-200/60 text-ink-500 ring-1 ring-line',
};

const PAYMENT_STYLE: Record<string, string> = {
  succeeded: 'bg-success-50 text-success-700 ring-1 ring-success-200',
  paid: 'bg-success-50 text-success-700 ring-1 ring-success-200',
  pending: 'bg-caution-50 text-caution-800 ring-1 ring-caution-200',
  failed: 'bg-danger-50 text-danger-700 ring-1 ring-danger-200',
  refunded: 'bg-paper-200/60 text-ink-600 ring-1 ring-line',
};

function titleCase(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function planStatus(sub: WorkspaceBilling['subscription']) {
  if (!sub.hasStripeSubscription) return 'unpaid';
  return sub.status;
}

const day = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

export function BillingSection() {
  const [params] = useSearchParams();
  const checkout = params.get('checkout');
  const [workspace, setWorkspace] = useState<WorkspaceBilling | null>(null);
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([api.getBillingWorkspace(), api.getPayments(25).catch(() => ({ payments: [] as Payment[] }))])
      .then(([next, history]) => {
        if (!live) return;
        setWorkspace(next);
        setPayments(history.payments);
      })
      .catch((err) => {
        if (!live) return;
        setError(err instanceof Error ? err.message : 'Could not load billing.');
      });
    return () => {
      live = false;
    };
  }, []);

  async function openPortal() {
    setBusy(true);
    try {
      const { portalUrl } = await api.openBillingPortal();
      window.location.href = portalUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the billing portal.');
      setBusy(false);
    }
  }

  if (error && !workspace) {
    return (
      <p role="alert" className="text-sm text-danger-600">
        {error}
      </p>
    );
  }

  if (!workspace) return <p className="text-sm text-ink-600">Loading…</p>;

  const sub = workspace.subscription;
  const status = planStatus(sub);
  const renewsLabel = sub.cancelAtPeriodEnd ? 'Ends' : 'Renews';

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="text-sm text-danger-600">
          {error}
        </p>
      )}
      {checkout === 'success' && (
        <p role="status" className="rounded-lg border border-success-200 bg-success-50 px-3.5 py-3 text-sm text-success-700">
          Payment received. Stripe will confirm the subscription in a few seconds.
        </p>
      )}
      {checkout === 'cancelled' && (
        <p role="status" className="rounded-lg border border-line bg-paper-50 px-3.5 py-3 text-sm text-ink-600">
          Checkout cancelled. Nothing was charged.
        </p>
      )}

      <section className="rounded-xl glass-card p-5 sm:p-6">
        <header>
          <h3 className="text-base font-semibold text-ink-900">Plan</h3>
          <p className="mt-0.5 text-xs text-ink-500">
            Subscription, allowance, and this billing period.
          </p>
        </header>

        <div className="mt-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h4 className="text-lg font-semibold tracking-tight text-ink-900">{sub.name}</h4>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                  STATUS_STYLE[status] ?? 'bg-paper-200/60 text-ink-600 ring-1 ring-line'
                }`}
              >
                {titleCase(status)}
              </span>
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-ink-900">
              {formatCents(sub.baseMonthlyFeeCents)}
              <span className="ml-1.5 text-sm font-medium text-ink-500">per month</span>
            </p>
          </div>
        </div>

        <dl className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-line bg-paper-50/70 px-3.5 py-3">
            <dt className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-500">Included</dt>
            <dd className="mt-1 text-sm font-semibold text-ink-900">{sub.includedJobs} jobs included</dd>
            <p className="mt-0.5 text-[11px] text-ink-500">each billing period</p>
          </div>
          <div className="rounded-lg border border-line bg-paper-50/70 px-3.5 py-3">
            <dt className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-500">
              Additional jobs
            </dt>
            <dd className="mt-1 text-sm font-semibold text-ink-900">
              {formatCents(sub.additionalJobPriceCents)} each
            </dd>
            <p className="mt-0.5 text-[11px] text-ink-500">after the included allowance</p>
          </div>
        </dl>

        <dl className="mt-5 space-y-3 border-t border-line pt-4 text-sm">
          <Row label="Current period">
            {day(sub.periodStart)} — {day(sub.periodEnd)}
          </Row>
          <Row label={renewsLabel}>
            {day(sub.periodEnd)}
            {sub.cancelAtPeriodEnd ? <span className="ml-1.5 text-caution-700">Cancelling</span> : null}
          </Row>
        </dl>

        {sub.cancelAtPeriodEnd ? (
          <p className="mt-4 rounded-lg border border-caution-200 bg-caution-50 px-3.5 py-3 text-sm text-caution-800">
            This plan ends on {day(sub.periodEnd)}. Everything keeps working until then.
          </p>
        ) : null}

        {workspace.canManage && workspace.paymentProvider === 'stripe' ? (
          <button
            type="button"
            onClick={() => void openPortal()}
            disabled={busy}
            className="mt-5 flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-ink-900 transition hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? <SpinnerIcon className="animate-spin" width={14} height={14} /> : null}
            Manage plan and payment method
          </button>
        ) : workspace.canManage ? (
          <div
            role="status"
            className="mt-5 flex gap-3 rounded-lg border border-caution-200 bg-caution-50 px-3.5 py-3"
          >
            <AlertIcon className="mt-0.5 shrink-0 text-caution-700" width={16} height={16} />
            <div>
              <p className="text-sm font-medium text-caution-800">Payments aren't available</p>
              <p className="mt-0.5 text-xs leading-relaxed text-caution-700">
                Stripe is not configured on this server. This plan stays unpaid until a payment
                provider is connected.
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-5 text-xs text-ink-500">
            Only an owner or billing manager can change the plan or the card on file.
          </p>
        )}
      </section>

      <section className="rounded-xl glass-card p-5 sm:p-6">
        <header>
          <h3 className="text-base font-semibold text-ink-900">Billing history</h3>
          <p className="mt-0.5 text-xs text-ink-500">Every charge on this account, newest first.</p>
        </header>

        {payments === null ? (
          <p className="mt-4 text-sm text-ink-600">Loading…</p>
        ) : payments.length === 0 ? (
          <p className="mt-4 rounded-lg border border-line px-4 py-3 text-sm text-ink-600">
            Nothing charged yet.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[30rem] text-left text-xs">
              <thead className="text-[10.5px] uppercase tracking-wide text-ink-500">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 font-semibold">Date</th>
                  <th className="px-3 py-2 font-semibold">Description</th>
                  <th className="px-3 py-2 text-right font-semibold">Amount</th>
                  <th className="py-2 pl-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id} className="border-b border-line/60 last:border-b-0">
                    <td className="py-3 pr-3 tabular-nums text-ink-700">{day(payment.createdAt)}</td>
                    <td className="px-3 py-3 text-ink-800">
                      {payment.description ?? 'Subscription'}
                      {payment.cardBrand && payment.cardLast4 ? (
                        <span className="block text-[11px] text-ink-500">
                          {titleCase(payment.cardBrand)} ····{payment.cardLast4}
                        </span>
                      ) : null}
                      {payment.failureReason ? (
                        <span className="block text-[11px] text-danger-600">{payment.failureReason}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums font-medium text-ink-900">
                      {formatCents(payment.amountCents)}
                    </td>
                    <td className="py-3 pl-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            PAYMENT_STYLE[payment.status] ?? 'bg-paper-200/60 text-ink-600 ring-1 ring-line'
                          }`}
                        >
                          {titleCase(payment.status)}
                        </span>
                        {payment.invoicePdfUrl || payment.hostedInvoiceUrl || payment.receiptUrl ? (
                          <a
                            href={payment.invoicePdfUrl ?? payment.hostedInvoiceUrl ?? payment.receiptUrl ?? '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-brand-700 hover:text-brand-800"
                          >
                            {payment.invoicePdfUrl ? 'Invoice' : 'Receipt'}
                          </a>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <TokenUsageSection />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
      <dt className="text-ink-500">{label}</dt>
      <dd className="tabular-nums font-medium text-ink-800">{children}</dd>
    </div>
  );
}
