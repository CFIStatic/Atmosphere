import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type BillingInvoice, type BillingInvoiceLine, type WorkspaceBilling } from '../../lib/api';
import { formatCents } from '../../lib/money';
import { AlertIcon, SpinnerIcon } from '../icons';
import { Logo } from '../Logo';
import { TokenUsageSection } from './TokenUsageSection';

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-success-50 text-success-600 ring-1 ring-success-200',
  trialing: 'bg-brand-50 text-brand-700 ring-1 ring-brand-200',
  comped: 'bg-success-50 text-success-600 ring-1 ring-success-200',
  past_due: 'bg-danger-50 text-danger-700 ring-1 ring-danger-200',
  unpaid: 'bg-caution-50 text-caution-600 ring-1 ring-caution-200',
  incomplete: 'bg-caution-50 text-caution-600 ring-1 ring-caution-200',
  canceled: 'bg-paper-200/60 text-ink-500 ring-1 ring-line',
  cancelled: 'bg-paper-200/60 text-ink-500 ring-1 ring-line',
};

const INVOICE_STYLE: Record<string, string> = {
  paid: 'bg-success-50 text-success-600 ring-1 ring-success-200',
  open: 'bg-caution-50 text-caution-600 ring-1 ring-caution-200',
  void: 'bg-paper-200/60 text-ink-600 ring-1 ring-line',
  uncollectible: 'bg-danger-50 text-danger-700 ring-1 ring-danger-200',
};

function titleCase(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function planStatus(sub: WorkspaceBilling['subscription'], billingExempt?: boolean) {
  if (billingExempt || sub.status === 'comped') return 'comped';
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
  const [invoices, setInvoices] = useState<BillingInvoice[] | null>(null);
  const [invoicesComplimentary, setInvoicesComplimentary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([
      api.getBillingWorkspace(),
      api.getInvoices(25).catch(() => ({ invoices: [] as BillingInvoice[], complimentary: false })),
    ])
      .then(([next, history]) => {
        if (!live) return;
        setWorkspace(next);
        setInvoices(history.invoices);
        setInvoicesComplimentary(history.complimentary);
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
  const status = planStatus(sub, workspace.billingExempt);
  const renewsLabel = sub.cancelAtPeriodEnd ? 'Ends' : 'Renews';
  const complimentary = status === 'comped' || Boolean(workspace.billingExempt);
  const showStripePortal =
    workspace.canManage && workspace.paymentProvider === 'stripe' && !complimentary;

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
          <p className="mt-0.5 text-xs text-ink-500">Subscription and this billing period.</p>
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
              {complimentary ? (
                'Complimentary'
              ) : (
                <>
                  {formatCents(sub.baseMonthlyFeeCents)}
                  <span className="ml-1.5 text-sm font-medium text-ink-500">per month</span>
                </>
              )}
            </p>
          </div>
        </div>

        <dl className="mt-5 space-y-3 border-t border-line pt-4 text-sm">
          <Row label="Current period">
            {day(sub.periodStart)} — {day(sub.periodEnd)}
          </Row>
          <Row label={renewsLabel}>
            {day(sub.periodEnd)}
            {sub.cancelAtPeriodEnd ? <span className="ml-1.5 text-caution-600">Cancelling</span> : null}
          </Row>
          {workspace.fieldCaptureSeats ? (
            <Row label="Field Capture accounts">
              {workspace.fieldCaptureSeats.used} of {workspace.fieldCaptureSeats.allowed} used
              <span className="ml-1.5 font-normal text-ink-500">
                ({workspace.fieldCaptureSeats.included} included
                {workspace.fieldCaptureSeats.extra > 0
                  ? ` + ${workspace.fieldCaptureSeats.extra} extra`
                  : ''}
                )
              </span>
            </Row>
          ) : null}
        </dl>

        {sub.cancelAtPeriodEnd ? (
          <p className="mt-4 rounded-lg border border-caution-200 bg-caution-50 px-3.5 py-3 text-sm text-caution-600">
            This plan ends on {day(sub.periodEnd)}. Everything keeps working until then.
          </p>
        ) : null}

        {showStripePortal ? (
          <div className="mt-5 space-y-2">
            <button
              type="button"
              onClick={() => void openPortal()}
              disabled={busy}
              className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-ink-900 transition hover:bg-brand-700 disabled:opacity-50"
            >
              {busy ? <SpinnerIcon className="animate-spin" width={14} height={14} /> : null}
              Manage plan and payment method
            </button>
            <p className="text-xs text-ink-500">
              Extra Field Capture accounts ({formatCents(workspace.fieldCaptureSeats?.extraSeatPriceCents ?? 12_500)}/mo) are added automatically when you invite past the{' '}
              {workspace.fieldCaptureSeats?.included ?? sub.includedFcSeats ?? 3} included seats.
              Change plans in the billing portal, or contact us for Enterprise.
            </p>
          </div>
        ) : complimentary && workspace.canManage ? (
          <p className="mt-5 text-xs text-ink-500">
            Extra Field Capture accounts are added automatically when you invite someone past the{' '}
            {workspace.fieldCaptureSeats?.included ?? sub.includedFcSeats ?? 3} included seats.
          </p>
        ) : workspace.canManage ? (
          <div
            role="status"
            className="mt-5 flex gap-3 rounded-lg border border-caution-200 bg-caution-50 px-3.5 py-3"
          >
            <AlertIcon className="mt-0.5 shrink-0 text-caution-600" width={16} height={16} />
            <div>
              <p className="text-sm font-medium text-caution-600">Payments aren't available</p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-600">
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
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-ink-900">Invoices / Receipts</h3>
            <p className="mt-0.5 text-xs text-ink-500">
              Atmosphere invoices for this account, newest first. Email receipts go to the billing email on file.
            </p>
          </div>
          <Logo to={null} size="md" className="shrink-0" />
        </header>

        {invoices === null ? (
          <p className="mt-4 text-sm text-ink-600">Loading…</p>
        ) : invoices.length === 0 ? (
          <p className="mt-4 rounded-lg border border-line px-4 py-3 text-sm text-ink-600">
            {complimentary || invoicesComplimentary
              ? 'No Stripe invoices — complimentary billing'
              : 'No invoices yet.'}
          </p>
        ) : (
          <div className="mt-4 space-y-5">
            {invoices.map((invoice) => (
              <InvoiceReceiptCard key={invoice.id} invoice={invoice} />
            ))}
          </div>
        )}
      </section>

      <TokenUsageSection />
    </div>
  );
}

function invoiceLines(invoice: BillingInvoice): BillingInvoiceLine[] {
  if (invoice.lines && invoice.lines.length > 0) return invoice.lines;
  return [
    {
      description: invoice.description ?? invoice.number ?? 'Invoice',
      quantity: 1,
      unitAmountCents: invoice.amountCents,
      amountCents: invoice.amountCents,
    },
  ];
}

function InvoiceReceiptCard({ invoice }: { invoice: BillingInvoice }) {
  const lines = invoiceLines(invoice);
  const receiptHref = invoice.hostedInvoiceUrl ?? invoice.invoicePdfUrl;
  return (
    <article className="rounded-lg border border-line">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
        <div className="min-w-0 text-xs">
          <p className="tabular-nums font-medium text-ink-800">{day(invoice.createdAt)}</p>
          <p className="text-ink-500">{invoice.number ?? invoice.id}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              INVOICE_STYLE[invoice.status] ?? 'bg-paper-200/60 text-ink-600 ring-1 ring-line'
            }`}
          >
            {titleCase(invoice.status)}
          </span>
          <span className="text-sm font-semibold tabular-nums text-ink-900">
            {formatCents(invoice.amountCents)}
          </span>
          {receiptHref ? (
            <a
              href={receiptHref}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-brand-700 hover:text-brand-800"
            >
              View receipt
            </a>
          ) : null}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-left text-xs">
          <thead className="text-[10.5px] uppercase tracking-wide text-ink-500">
            <tr className="border-b border-line/60">
              <th className="px-3.5 py-2 font-semibold">Description</th>
              <th className="px-3 py-2 text-right font-semibold">Qty</th>
              <th className="px-3 py-2 text-right font-semibold">Unit price</th>
              <th className="px-3.5 py-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={`${invoice.id}-line-${index}`} className="border-b border-line/40 last:border-b-0">
                <td className="px-3.5 py-2.5 text-ink-800">{line.description ?? 'Usage'}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink-700">
                  {line.quantity != null ? line.quantity : '—'}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink-700">
                  {line.unitAmountCents != null ? formatCents(line.unitAmountCents) : '—'}
                </td>
                <td className="px-3.5 py-2.5 text-right tabular-nums font-medium text-ink-900">
                  {formatCents(line.amountCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
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
