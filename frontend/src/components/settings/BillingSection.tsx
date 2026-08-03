import { useEffect, useState } from 'react';
import {
  api,
  type BillingOverview,
  type OrgMember,
  type Payment,
} from '../../lib/api';
import { SpinnerIcon } from '../icons';

/**
 * What Atmosphere costs this company.
 *
 * Not the credits page — that one is about model spend, which is metered and
 * variable and belongs with the people watching it. This is the boring
 * question an owner asks once a month: how many seats are we paying for, what
 * is the bill, and where are the receipts.
 *
 * The one number worth putting first is not the price. It is seats paid versus
 * people actually using it, because that gap is the only line on a SaaS
 * invoice a customer can act on, and it is the one every billing page hides.
 * Somebody paying for twelve seats with nine people in the org should be told
 * so by their own software rather than finding out during a renewal
 * negotiation.
 */

const money = (cents: number | null | undefined) =>
  cents === null || cents === undefined
    ? '—'
    : (cents / 100).toLocaleString(undefined, {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
      });

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-success-50 text-success-600',
  trialing: 'bg-brand-50 text-brand-700',
  past_due: 'bg-danger-50 text-danger-600',
  canceled: 'bg-paper-200/60 text-ink-500',
  paused: 'bg-caution-50 text-caution-600',
};

const PAYMENT_STYLE: Record<string, string> = {
  succeeded: 'text-success-600',
  paid: 'text-success-600',
  pending: 'text-caution-600',
  failed: 'text-danger-600',
  refunded: 'text-ink-500',
};

export function BillingSection() {
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [members, setMembers] = useState<OrgMember[] | null>(null);
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([
      api.getBillingOverview(),
      api.getMembers().catch(() => ({ members: [] as OrgMember[] })),
      api.getPayments(25).catch(() => ({ payments: [] as Payment[] })),
    ])
      .then(([billing, org, history]) => {
        if (!live) return;
        setOverview(billing);
        setMembers(org.members);
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

  if (error && !overview) {
    return (
      <p role="alert" className="text-sm text-danger-600">
        {error}
      </p>
    );
  }

  if (!overview) return <p className="text-sm text-ink-600">Loading…</p>;

  const sub = overview.subscription;
  const people = (members ?? []).length;
  // Seats bought, against people who could use one. The gap is the point.
  const spare = sub.seats - people;
  const perSeat = sub.seats > 0 ? Math.round(sub.monthlyPriceCents / sub.seats) : 0;
  // Annual plans are billed once but the useful comparison is monthly, so the
  // headline stays monthly and the term is stated beside it.
  const annual = sub.billingInterval === 'annual';

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="text-sm text-danger-600">
          {error}
        </p>
      )}

      {/* The bill. */}
      <section className="rounded-xl glass-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-baseline gap-2">
              <h3 className="text-lg font-semibold text-ink-900">{sub.planName}</h3>
              <span
                className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                  STATUS_STYLE[sub.status] ?? 'bg-paper-200/60 text-ink-600'
                }`}
              >
                {sub.status.replace(/_/g, ' ')}
              </span>
            </div>
            <p className="mt-1 text-sm text-ink-600">
              {sub.seats} seat{sub.seats === 1 ? '' : 's'}
              {perSeat > 0 && <> · {money(perSeat)} each</>}
              {annual && ' · billed annually'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-semibold tabular-nums text-ink-900">
              {money(sub.monthlyPriceCents)}
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
            {sub.cancelAtPeriodEnd && <span className="ml-1 text-caution-600">· cancelling</span>}
          </Row>
          {annual && (
            <Row label="Charged annually">{money(sub.monthlyPriceCents * 12)}</Row>
          )}
        </dl>

        {sub.cancelAtPeriodEnd && (
          <p className="mt-3 rounded-lg border border-caution-200 bg-caution-50 px-3 py-2 text-xs text-caution-600">
            This plan is set to end on {day(sub.periodEnd)}. Everything keeps working until then.
          </p>
        )}

        {overview.canManage ? (
          <button
            onClick={() => void openPortal()}
            disabled={busy}
            className="mt-4 flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-ink-900 transition hover:bg-brand-700 disabled:opacity-50"
          >
            {busy && <SpinnerIcon className="animate-spin" width={14} height={14} />}
            Manage plan and payment method
          </button>
        ) : (
          // Said plainly rather than by disabling a button with no explanation.
          <p className="mt-4 text-xs text-ink-500">
            Only an owner can change the plan or the card on file.
          </p>
        )}
      </section>

      {/* Seats. The gap between bought and used is the only line on a SaaS
          invoice a customer can actually act on. */}
      <section className="rounded-xl glass-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-base font-semibold text-ink-900">Seats</h3>
          <span className="text-xs text-ink-500">
            {people} {people === 1 ? 'person' : 'people'} in this organization
          </span>
        </div>

        <div className="mt-3 flex items-end gap-4">
          <div>
            <p className="text-2xl font-semibold tabular-nums text-ink-900">{people}</p>
            <p className="text-xs text-ink-500">using a seat</p>
          </div>
          <div className="pb-1 text-ink-400">of</div>
          <div>
            <p className="text-2xl font-semibold tabular-nums text-ink-900">{sub.seats}</p>
            <p className="text-xs text-ink-500">paid for</p>
          </div>
        </div>

        <div className="mt-3 h-2 overflow-hidden rounded-full bg-paper-200/60">
          <div
            className={`h-full rounded-full ${spare < 0 ? 'bg-danger-600' : 'bg-brand-600'}`}
            style={{ width: `${Math.min(100, sub.seats > 0 ? (people / sub.seats) * 100 : 0)}%` }}
          />
        </div>

        {spare > 0 && (
          <p className="mt-3 rounded-lg border border-line px-3 py-2 text-xs text-ink-600">
            You are paying for {spare} seat{spare === 1 ? '' : 's'} nobody is using — about{' '}
            <span className="font-semibold text-ink-800">{money(perSeat * spare)}</span> a month.
            Drop them at the next renewal, or invite the people they were bought for.
          </p>
        )}
        {spare < 0 && (
          <p className="mt-3 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-600">
            {people} people are using {sub.seats} seats. Add {Math.abs(spare)} more before the next
            renewal or somebody will lose access.
          </p>
        )}
        {spare === 0 && (
          <p className="mt-3 text-xs text-ink-500">Every seat is in use. Nothing to change.</p>
        )}

        {members && members.length > 0 && (
          <ul className="mt-3 divide-y divide-line border-t border-line">
            {members.map((member) => (
              <li key={member.userId} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-ink-800">
                    {member.fullName ?? member.email ?? 'Member'}
                  </span>
                  {member.fullName && member.email && (
                    <span className="block truncate text-[11px] text-ink-500">{member.email}</span>
                  )}
                </span>
                <span className="shrink-0 rounded-full bg-paper-200/60 px-2 py-0.5 text-[10.5px] font-medium text-ink-600">
                  {member.role}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Receipts. */}
      <section className="rounded-xl glass-card p-5">
        <h3 className="text-base font-semibold text-ink-900">Billing history</h3>
        <p className="mt-0.5 text-xs text-ink-500">
          Every charge on this account, newest first.
        </p>

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
                    <td className="py-2.5 pr-3 tabular-nums text-ink-700">
                      {day(payment.createdAt)}
                    </td>
                    <td className="px-3 py-2.5 text-ink-700">
                      {payment.description ?? 'Subscription'}
                      {payment.cardBrand && payment.cardLast4 && (
                        <span className="block text-[11px] text-ink-500">
                          {payment.cardBrand} ····{payment.cardLast4}
                        </span>
                      )}
                      {/* Why it failed, where the processor said. Without it a
                          failed charge is a dead end and a support call. */}
                      {payment.failureReason && (
                        <span className="block text-[11px] text-danger-600">
                          {payment.failureReason}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium text-ink-900">
                      {money(payment.amountCents)}
                    </td>
                    <td className="py-2.5 pl-3">
                      <span className={PAYMENT_STYLE[payment.status] ?? 'text-ink-600'}>
                        {payment.status}
                      </span>
                      {/* Only links the processor actually gave us. A dead
                          "receipt" link is worse than none, and an accountant
                          wants the PDF rather than a hosted page. */}
                      {(payment.invoicePdfUrl || payment.hostedInvoiceUrl || payment.receiptUrl) && (
                        <a
                          href={
                            payment.invoicePdfUrl ??
                            payment.hostedInvoiceUrl ??
                            payment.receiptUrl ??
                            '#'
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-2 text-brand-600 hover:text-brand-700"
                        >
                          {payment.invoicePdfUrl ? 'invoice' : 'receipt'}
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* The other bill, named so nobody hunts for it here. Model spend is
          metered and variable and lives with the people watching it. */}
      <p className="text-xs text-ink-500">
        This is the subscription. Credits for model usage are metered separately — see Plan &
        credits.
      </p>
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
