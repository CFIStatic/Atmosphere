import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type Payment, type WorkspaceBilling } from '../../lib/api';
import { formatCents } from '../../lib/money';
import { SpinnerIcon } from '../icons';
import { TokenUsageSection } from './TokenUsageSection';

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-success-50 text-success-700',
  trialing: 'bg-brand-50 text-brand-700',
  past_due: 'bg-danger-50 text-danger-700',
  canceled: 'bg-paper-200/60 text-ink-500',
  cancelled: 'bg-paper-200/60 text-ink-500',
  incomplete: 'bg-caution-50 text-caution-700',
};

const PAYMENT_STYLE: Record<string, string> = {
  succeeded: 'text-success-600',
  paid: 'text-success-600',
  pending: 'text-caution-600',
  failed: 'text-danger-600',
  refunded: 'text-ink-500',
};

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
  const jobsIncluded = sub.includedJobs;
  const statusLabel = sub.hasStripeSubscription ? sub.status.replace(/_/g, ' ') : 'unpaid';

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

      <section className="rounded-xl glass-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="text-lg font-semibold text-ink-900">{sub.name}</h3>
              <span
                className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold capitalize ${
                  STATUS_STYLE[sub.hasStripeSubscription ? sub.status : 'incomplete'] ??
                  'bg-paper-200/60 text-ink-600'
                }`}
              >
                {statusLabel}
              </span>
            </div>
            <p className="mt-1 text-sm text-ink-600">
              {jobsIncluded} jobs included · {formatCents(sub.additionalJobPriceCents)} each additional job
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-semibold tabular-nums text-ink-900">
              {formatCents(sub.baseMonthlyFeeCents)}
            </p>
            <p className="text-xs text-ink-500">per month</p>
          </div>
        </div>

        <dl className="mt-4 grid gap-x-6 gap-y-1.5 border-t border-line pt-3 text-xs sm:grid-cols-2">
          <Row label="Current period">
            {day(sub.periodStart)} — {day(sub.periodEnd)}
          </Row>
          <Row label={sub.cancelAtPeriodEnd ? 'Ends' : 'Renews'}>
            {day(sub.periodEnd)}
            {sub.cancelAtPeriodEnd ? <span className="ml-1 text-caution-600">· cancelling</span> : null}
          </Row>
        </dl>

        {sub.cancelAtPeriodEnd ? (
          <p className="mt-3 rounded-lg border border-caution-200 bg-caution-50 px-3 py-2 text-xs text-caution-700">
            This plan ends on {day(sub.periodEnd)}. Everything keeps working until then.
          </p>
        ) : null}

        {workspace.canManage && workspace.paymentProvider === 'stripe' ? (
          <button
            type="button"
            onClick={() => void openPortal()}
            disabled={busy}
            className="mt-4 flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-ink-900 transition hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? <SpinnerIcon className="animate-spin" width={14} height={14} /> : null}
            Manage plan and payment method
          </button>
        ) : workspace.canManage ? (
          <p className="mt-4 text-xs text-ink-500">Stripe is not configured on this server.</p>
        ) : (
          <p className="mt-4 text-xs text-ink-500">
            Only an owner or billing manager can change the plan or the card on file.
          </p>
        )}
      </section>

      <section className="rounded-xl glass-card p-5">
        <h3 className="text-base font-semibold text-ink-900">Billing history</h3>
        <p className="mt-0.5 text-xs text-ink-500">Every charge on this account, newest first.</p>

        {payments === null ? (
          <p className="mt-3 text-sm text-ink-600">Loading…</p>
        ) : payments.length === 0 ? (
          <p className="mt-3 rounded-lg border border-line px-4 py-3 text-sm text-ink-600">
            Nothing charged yet.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[30rem] text-left text-xs">
              <thead className="text-[10.5px] uppercase tracking-wide text-ink-500">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 font-semibold">Date</th>
                  <th className="px-3 py-2 font-semibold">What for</th>
                  <th className="px-3 py-2 text-right font-semibold">Amount</th>
                  <th className="py-2 pl-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id} className="border-b border-line/60 last:border-b-0">
                    <td className="py-2.5 pr-3 tabular-nums text-ink-700">{day(payment.createdAt)}</td>
                    <td className="px-3 py-2.5 text-ink-700">
                      {payment.description ?? 'Subscription'}
                      {payment.cardBrand && payment.cardLast4 ? (
                        <span className="block text-[11px] text-ink-500">
                          {payment.cardBrand} ····{payment.cardLast4}
                        </span>
                      ) : null}
                      {payment.failureReason ? (
                        <span className="block text-[11px] text-danger-600">{payment.failureReason}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium text-ink-900">
                      {formatCents(payment.amountCents)}
                    </td>
                    <td className="py-2.5 pl-3">
                      <span className={PAYMENT_STYLE[payment.status] ?? 'text-ink-600'}>{payment.status}</span>
                      {payment.invoicePdfUrl || payment.hostedInvoiceUrl || payment.receiptUrl ? (
                        <a
                          href={payment.invoicePdfUrl ?? payment.hostedInvoiceUrl ?? payment.receiptUrl ?? '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-2 text-brand-600 hover:text-brand-700"
                        >
                          {payment.invoicePdfUrl ? 'invoice' : 'receipt'}
                        </a>
                      ) : null}
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
    <div className="flex justify-between gap-3">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-right font-medium text-ink-800">{children}</dd>
    </div>
  );
}
