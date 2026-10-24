import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  api,
  type InvoiceEvidence,
  type JobInvoice,
  type JobInvoiceInput,
  type JobPayment,
  type JobPaymentsResponse,
  type ProofVideoRecord,
} from '../../lib/api';
import { Button } from '../../design';

const usd = (cents: number) =>
  (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const clock = (s: number | null) =>
  s === null ? '' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const KIND_LABEL: Record<JobInvoice['kind'], string> = {
  invoice: 'Invoice',
  deductible: 'Deductible',
  out_of_pocket: 'Out-of-pocket',
};

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-paper-200/60 text-ink-600 ring-1 ring-line',
  sent: 'bg-caution-50 text-caution-600 ring-1 ring-caution-200',
  paid: 'bg-success-50 text-success-600 ring-1 ring-success-200',
  void: 'bg-paper-200/60 text-ink-500 ring-1 ring-line',
  pending: 'bg-paper-200/60 text-ink-600 ring-1 ring-line',
  processing: 'bg-brand-50 text-brand-700 ring-1 ring-brand-200',
  failed: 'bg-danger-50 text-danger-700 ring-1 ring-danger-200',
  expired: 'bg-paper-200/60 text-ink-500 ring-1 ring-line',
  refunded: 'bg-paper-200/60 text-ink-600 ring-1 ring-line',
  partially_refunded: 'bg-paper-200/60 text-ink-600 ring-1 ring-line',
  disputed: 'bg-danger-50 text-danger-700 ring-1 ring-danger-200',
  dispute_lost: 'bg-danger-50 text-danger-700 ring-1 ring-danger-200',
};
const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  sent: 'Due',
  paid: 'Paid',
  void: 'Void',
  pending: 'Started',
  processing: 'Bank transfer pending',
  failed: 'Failed',
  expired: 'Abandoned',
  refunded: 'Refunded',
  partially_refunded: 'Partly refunded',
  disputed: 'Disputed',
  dispute_lost: 'Dispute lost',
};

const RELEASE_STYLE: Record<string, string> = {
  held: 'bg-caution-50 text-caution-600 ring-1 ring-caution-200',
  verified: 'bg-brand-50 text-brand-700 ring-1 ring-brand-200',
  released: 'bg-success-50 text-success-600 ring-1 ring-success-200',
  frozen: 'bg-danger-50 text-danger-700 ring-1 ring-danger-200',
  refunded: 'bg-paper-200/60 text-ink-600 ring-1 ring-line',
  reversed: 'bg-paper-200/60 text-ink-600 ring-1 ring-line',
};
const RELEASE_LABEL: Record<string, string> = {
  held: 'Paid – held',
  verified: 'Verified by AI',
  released: 'Released',
  frozen: 'Frozen – disputed',
  refunded: 'Refunded',
  reversed: 'Released, then refunded',
};

function ReleasePill({ status }: { status: string }) {
  if (!RELEASE_LABEL[status]) return null;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${RELEASE_STYLE[status]}`}
      data-testid={`release-${status}`}
    >
      {RELEASE_LABEL[status]}
    </span>
  );
}

function Pill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[status] ?? STATUS_STYLE.draft}`}
      data-testid={`status-${status}`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

/** Payments tab in the job file: office and homeowner see the same invoices; the server hides office-only fields. */
export function JobPaymentsPanel({ jobId, homeowner }: { jobId: string; homeowner: boolean }) {
  const [params] = useSearchParams();
  const [data, setData] = useState<JobPaymentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [player, setPlayer] = useState<{ url: string; at: number } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .jobPayments(jobId)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load payments.'));
  }, [jobId]);
  useEffect(load, [load]);

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusyId(null);
    }
  };

  const pay = async (inv: JobInvoice) => {
    setBusyId(inv.id);
    setError(null);
    try {
      const { url } = await api.payJobInvoice(jobId, inv.id);
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the payment.');
      setBusyId(null);
    }
  };

  const openClip = async (ev: InvoiceEvidence) => {
    try {
      const { url } = await api.proofVideoUrl(ev.proofId);
      setPlayer({ url, at: ev.atSeconds ?? 0 });
    } catch {
      setError('That video is not available.');
    }
  };

  if (!data) {
    return <p className="px-1 py-4 text-sm text-ink-600">{error ?? 'Loading…'}</p>;
  }
  if (!data.available) {
    return (
      <p className="rounded-lg border border-line px-4 py-3 text-sm text-ink-600" data-testid="payments-unavailable">
        Payments are not turned on yet.
      </p>
    );
  }

  const paymentBanner = params.get('payment');

  return (
    <div className="flex flex-col gap-4 pb-6" data-testid="job-payments">
      {data.testMode ? (
        <p className="rounded-lg bg-caution-50 px-3 py-2 text-xs font-medium text-caution-600 ring-1 ring-caution-200">
          Test mode: no real money moves. Use Stripe test card 4242 4242 4242 4242.
        </p>
      ) : null}
      {paymentBanner === 'success' ? (
        <p className="rounded-lg bg-success-50 px-3 py-2 text-sm text-success-600 ring-1 ring-success-200" data-testid="payment-success">
          Payment received. Bank transfers can take a few business days to clear.
        </p>
      ) : null}
      {error ? <p className="text-sm text-danger-700">{error}</p> : null}

      {!homeowner && data.canManage && !data.payoutsReady ? (
        <p className="rounded-lg border border-line px-4 py-3 text-sm text-ink-600">
          Homeowners can pay once the account owner sets up payouts in Settings → Billing.
        </p>
      ) : null}

      <section className="rounded-xl border border-line bg-paper-50 p-4 sm:p-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-ink-900">Invoices</h3>
            <p className="mt-0.5 text-xs text-ink-500">
              {homeowner
                ? 'From your contractor. Each line links the video that shows the work. Your payment is held until your contractor confirms each line is done.'
                : 'Each line maps to a scope item and links the video, moment and words that prove it. Paid lines are held until you confirm and release them.'}
            </p>
          </div>
          {!homeowner && data.canManage && !building ? (
            <Button size="sm" onClick={() => setBuilding(true)} data-testid="new-invoice">
              New invoice
            </Button>
          ) : null}
        </header>

        {building ? (
          <InvoiceBuilder
            jobId={jobId}
            scopeItems={data.scopeItems ?? []}
            onCancel={() => setBuilding(false)}
            onSaved={() => {
              setBuilding(false);
              load();
            }}
          />
        ) : null}

        <div className="mt-4 flex flex-col gap-3">
          {data.invoices.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line px-4 py-3 text-sm text-ink-600">No invoices yet.</p>
          ) : (
            data.invoices.map((inv) => (
              <article key={inv.id} className="rounded-lg border border-line bg-white/60" data-testid="invoice-card">
                <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-semibold text-ink-900">
                        #{inv.number} · {inv.title}
                      </h4>
                      <Pill status={inv.status} />
                      <span className="text-[11px] text-ink-500">{KIND_LABEL[inv.kind]}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {inv.status === 'paid' ? `Paid ${day(inv.paidAt)}` : inv.sentAt ? `Sent ${day(inv.sentAt)}` : `Created ${day(inv.createdAt)}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold tabular-nums text-ink-900">{usd(inv.totalCents)}</p>
                    {!homeowner && inv.applicationFeeCents !== undefined ? (
                      <p className="text-[11px] text-ink-500">
                        You receive {usd(inv.totalCents - inv.applicationFeeCents)} · Atmosphere fee {usd(inv.applicationFeeCents)}
                      </p>
                    ) : null}
                  </div>
                </header>
                <ul className="divide-y divide-line">
                  {inv.lines.map((line, i) => (
                    <li key={line.id ?? i} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3 text-sm">
                        <span className="min-w-0 text-ink-900">
                          {line.description}
                          {line.quantity !== 1 ? (
                            <span className="text-ink-500"> · {line.quantity} × {usd(line.unitCents)}</span>
                          ) : null}
                          {line.scopeTitle ? <span className="mt-0.5 block text-[11px] text-ink-500">Scope: {line.scopeTitle}</span> : null}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {line.release ? <ReleasePill status={line.release.status} /> : null}
                          <span className="tabular-nums text-ink-900">{usd(line.amountCents ?? line.unitCents)}</span>
                        </span>
                      </div>
                      {line.evidence.length ? (
                        <div className="mt-2 flex flex-col gap-1.5" data-testid="line-evidence">
                          {line.evidence.map((ev, j) => (
                            <button
                              key={`${ev.proofId}-${j}`}
                              type="button"
                              onClick={() => openClip(ev)}
                              className="flex w-full items-start gap-2 rounded-md bg-paper-100 px-2.5 py-1.5 text-left text-xs text-ink-700 ring-1 ring-line hover:bg-paper-200/60"
                            >
                              <span aria-hidden className="mt-px text-brand-700">▶</span>
                              <span className="min-w-0">
                                <span className="font-medium text-ink-900">
                                  {ev.clipTitle || 'Job video'}
                                  {ev.atSeconds !== null ? ` at ${clock(ev.atSeconds)}` : ''}
                                </span>
                                {ev.capturedAt ? <span className="text-ink-500"> · {day(ev.capturedAt)}</span> : null}
                                {ev.quote ? <span className="mt-0.5 block italic text-ink-600">“{ev.quote}”</span> : null}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {!homeowner && line.release && line.release.status !== 'unpaid' ? (
                        <LineReleaseBar
                          line={line}
                          canManage={data.canManage}
                          busy={busyId === line.id}
                          confirming={confirming === line.id}
                          onAsk={() => setConfirming(line.id ?? null)}
                          onCancel={() => setConfirming(null)}
                          onRecheck={() => line.id && act(line.id, () => api.verifyInvoiceLine(jobId, inv.id, line.id!))}
                          onRelease={() =>
                            line.id &&
                            act(line.id, async () => {
                              await api.releaseInvoiceLine(jobId, inv.id, line.id!);
                              setConfirming(null);
                            })
                          }
                        />
                      ) : null}
                      {homeowner && line.release?.status === 'released' ? (
                        <p className="mt-1.5 text-[11px] text-success-600">Your contractor confirmed this work; payment released {day(line.release.releasedAt)}.</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {inv.homeownerNote ? <p className="border-t border-line px-4 py-2 text-xs text-ink-600">{inv.homeownerNote}</p> : null}
                {!homeowner && inv.internalNote ? (
                  <p className="border-t border-line bg-paper-100/60 px-4 py-2 text-xs text-ink-500">Internal: {inv.internalNote}</p>
                ) : null}
                <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">
                  {homeowner && inv.status === 'sent' ? (
                    <Button
                      size="md"
                      loading={busyId === inv.id}
                      disabled={!data.payoutsReady || busyId !== null}
                      onClick={() => pay(inv)}
                      data-testid="pay-invoice"
                    >
                      Pay {usd(inv.totalCents)}
                    </Button>
                  ) : null}
                  {!homeowner && data.canManage && inv.status === 'draft' ? (
                    <Button size="sm" loading={busyId === inv.id} onClick={() => act(inv.id, () => api.sendJobInvoice(jobId, inv.id))} data-testid="send-invoice">
                      Send to homeowner
                    </Button>
                  ) : null}
                  {!homeowner && data.canManage && (inv.status === 'draft' || inv.status === 'sent') ? (
                    <Button size="sm" variant="ghost" disabled={busyId !== null} onClick={() => act(inv.id, () => api.voidJobInvoice(jobId, inv.id))}>
                      Void
                    </Button>
                  ) : null}
                  {homeowner && inv.status === 'paid' ? <span className="text-sm text-success-600">Paid, thank you</span> : null}
                </footer>
              </article>
            ))
          )}
        </div>
      </section>

      <PaymentsList
        payments={data.payments}
        homeowner={homeowner}
        canManage={Boolean(data.canManage)}
        busyId={busyId}
        onRefund={(p, amountCents) => act(`refund-${p.id}`, () => api.refundJobPayment(jobId, p.id, { amountCents }))}
      />

      {player ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setPlayer(null)}>
          <video
            src={`${player.url}#t=${player.at}`}
            controls
            autoPlay
            className="max-h-[80vh] max-w-full rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );
}

function LineReleaseBar(props: {
  line: JobInvoice['lines'][number];
  canManage: boolean;
  busy: boolean;
  confirming: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onRecheck: () => void;
  onRelease: () => void;
}) {
  const r = props.line.release!;
  const amount = props.line.amountCents ?? props.line.unitCents;
  return (
    <div
      className={`mt-2 rounded-md px-3 py-2 text-xs ring-1 ${r.status === 'released' ? 'bg-success-50/60 ring-success-200' : r.status === 'verified' ? 'bg-brand-50/60 ring-brand-200' : 'bg-caution-50/60 ring-caution-200'}`}
      data-testid="line-release"
    >
      {r.status === 'frozen' ? (
        <p className="text-danger-700" data-testid="line-frozen">
          The homeowner disputed this charge with their bank. Release is paused until the dispute closes.
        </p>
      ) : r.status === 'refunded' ? (
        <p className="text-ink-600">Refunded {usd(r.refundedCents ?? 0)} to the homeowner before release.</p>
      ) : r.status === 'reversed' ? (
        <p className="text-ink-600">
          Released, then {usd(r.reversedCents ?? 0)} pulled back from the payout account for a refund.
        </p>
      ) : r.status === 'released' ? (
        <p className="text-success-700">
          Released {r.releasedCents !== null ? usd(r.releasedCents) : ''} to your payout account on {day(r.releasedAt)}
          {r.mode === 'ai_auto' ? ' (AI auto-release)' : ' after GC confirmation'}.
          {r.disputeFlag ? <span className="ml-1 font-semibold text-danger-700">Charge disputed: Stripe may pull this back.</span> : null}
          {r.reversedCents ? <span className="ml-1 text-ink-600">{usd(r.reversedCents)} pulled back for a refund.</span> : null}
        </p>
      ) : (
        <>
          <p className="font-medium text-ink-900">
            {r.status === 'verified' ? 'AI checked the linked clips against this scope item.' : 'Paid by the homeowner and held until you confirm the work.'}
          </p>
          {r.verdict?.reasons?.length ? (
            <ul className="mt-1 list-disc pl-4 text-ink-600" data-testid="ai-verdict">
              {r.verdict.reasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          ) : null}
          {props.canManage ? (
            props.confirming ? (
              <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="release-confirm">
                <span className="text-ink-700">
                  Release {usd(amount)} (less Atmosphere fee) to the contractor account? This cannot be undone here.
                </span>
                <Button size="sm" loading={props.busy} onClick={props.onRelease} data-testid="release-confirm-button">
                  Confirm &amp; release
                </Button>
                <Button size="sm" variant="ghost" disabled={props.busy} onClick={props.onCancel}>
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" onClick={props.onAsk} data-testid="release-line">
                  {r.status === 'verified' ? 'Confirm & release' : 'Release without AI check'}
                </Button>
                <Button size="sm" variant="ghost" loading={props.busy} onClick={props.onRecheck} data-testid="recheck-line">
                  Re-check with AI
                </Button>
              </div>
            )
          ) : null}
        </>
      )}
    </div>
  );
}

function PaymentsList({
  payments,
  homeowner,
  canManage = false,
  busyId = null,
  onRefund,
}: {
  payments: JobPayment[];
  homeowner: boolean;
  canManage?: boolean;
  busyId?: string | null;
  onRefund?: (p: JobPayment, amountCents?: number) => void;
}) {
  const [refunding, setRefunding] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const showActions = !homeowner && canManage && Boolean(onRefund);
  return (
    <section className="rounded-xl border border-line bg-paper-50 p-4 sm:p-5" data-testid="payments-list">
      <h3 className="text-base font-semibold text-ink-900">Payments</h3>
      {payments.length === 0 ? (
        <p className="mt-3 text-sm text-ink-600">No payments yet.</p>
      ) : (
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-xs text-ink-500">
            <tr>
              <th className="py-1.5 font-medium">Date</th>
              <th className="py-1.5 font-medium">Amount</th>
              <th className="py-1.5 font-medium">Method</th>
              <th className="py-1.5 font-medium">Status</th>
              {!homeowner ? <th className="py-1.5 text-right font-medium">Atmosphere fee</th> : null}
              {showActions ? <th className="py-1.5" /> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {payments.map((p) => (
              <tr key={p.id}>
                <td className="py-2 text-ink-700">{day(p.paidAt ?? p.createdAt)}</td>
                <td className="py-2 tabular-nums text-ink-900">{usd(p.amountCents)}</td>
                <td className="py-2 text-ink-700">{p.method === 'us_bank_account' ? 'Bank (ACH)' : p.method === 'card' ? 'Card' : '—'}</td>
                <td className="py-2">
                  <Pill status={p.status} />
                  {p.testMode ? <span className="ml-1.5 text-[10px] font-semibold uppercase text-caution-600">test</span> : null}
                  {p.refundedCents && p.status !== 'refunded' ? (
                    <span className="ml-1.5 text-[11px] text-ink-500">{usd(p.refundedCents)} refunded</span>
                  ) : null}
                </td>
                {!homeowner ? (
                  <td className="py-2 text-right tabular-nums text-ink-600">{usd(p.applicationFeeCents ?? 0)}</td>
                ) : null}
                {showActions ? (
                  <td className="py-2 text-right">
                    {p.status === 'paid' || p.status === 'partially_refunded' ? (
                      refunding === p.id ? (
                        <span className="inline-flex flex-wrap items-center justify-end gap-2" data-testid="refund-form">
                          <input
                            className="w-24 rounded-md border border-line px-2 py-1 text-right text-sm"
                            inputMode="decimal"
                            placeholder={((p.amountCents - (p.refundedCents ?? 0)) / 100).toFixed(2)}
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            aria-label="Refund amount"
                          />
                          <Button
                            size="sm"
                            variant="danger"
                            loading={busyId === `refund-${p.id}`}
                            onClick={() => {
                              const cents = amount.trim() ? Math.round(Number(amount) * 100) : undefined;
                              onRefund!(p, cents);
                              setRefunding(null);
                              setAmount('');
                            }}
                            data-testid="refund-confirm"
                          >
                            Refund
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setRefunding(null)}>
                            Cancel
                          </Button>
                        </span>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setRefunding(p.id)} data-testid="refund-open">
                          Refund
                        </Button>
                      )
                    ) : p.status === 'disputed' ? (
                      <span className="text-[11px] text-danger-700">Bank dispute open</span>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

type DraftLine = {
  description: string;
  quantity: string;
  unit: string;
  scopeItemId: string;
  evidence: Array<{ proofId: string; at: string; quote: string }>;
};
const blankLine = (): DraftLine => ({ description: '', quantity: '1', unit: '', scopeItemId: '', evidence: [] });

function parseClock(value: string): number | null {
  const v = value.trim();
  if (!v) return null;
  const parts = v.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function clipLabel(v: ProofVideoRecord): string {
  const summary = (v.aiSummary ?? '').split(/[.\n]/)[0]?.trim();
  const when = day(v.capturedAt ?? v.workDate);
  return `${summary ? summary.slice(0, 60) : `${v.phase} video`} · ${when}`;
}

function InvoiceBuilder({ jobId, scopeItems, onCancel, onSaved }: { jobId: string; scopeItems: Array<{ id: string; title: string }>; onCancel: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<JobInvoice['kind']>('invoice');
  const [note, setNote] = useState('');
  const [internal, setInternal] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [videos, setVideos] = useState<ProofVideoRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.jobProofs(jobId).then((r) => setVideos(r.videos ?? [])).catch(() => setVideos([]));
  }, [jobId]);

  const total = useMemo(
    () => lines.reduce((sum, l) => sum + Math.round((Number(l.quantity) || 0) * Math.round((Number(l.unit) || 0) * 100)), 0),
    [lines],
  );
  const setLine = (i: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const save = async () => {
    setSaving(true);
    setError(null);
    const input: JobInvoiceInput = {
      title: title.trim() || 'Invoice',
      kind,
      homeownerNote: note.trim() || null,
      internalNote: internal.trim() || null,
      lines: lines
        .filter((l) => l.description.trim())
        .map((l) => ({
          description: l.description.trim(),
          quantity: Number(l.quantity) || 1,
          unitCents: Math.round((Number(l.unit) || 0) * 100),
          scopeItemId: l.scopeItemId || null,
          evidence: l.evidence
            .filter((e) => e.proofId)
            .map((e) => ({ proofId: e.proofId, atSeconds: parseClock(e.at), quote: e.quote.trim() || null })),
        })),
    };
    try {
      await api.createJobInvoice(jobId, input);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setSaving(false);
    }
  };

  const field = 'rounded-md border border-line bg-white px-2.5 py-1.5 text-sm text-ink-900';

  return (
    <div className="mt-4 rounded-lg border border-brand-200 bg-white/70 p-4" data-testid="invoice-builder">
      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <input className={field} placeholder="Title, e.g. Water mitigation" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="invoice-title" />
        <select className={field} value={kind} onChange={(e) => setKind(e.target.value as JobInvoice['kind'])}>
          <option value="invoice">Invoice</option>
          <option value="deductible">Deductible</option>
          <option value="out_of_pocket">Out-of-pocket</option>
        </select>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {lines.map((line, i) => (
          <div key={i} className="rounded-md border border-line p-3" data-testid="builder-line">
            <div className="grid gap-2 sm:grid-cols-[1fr_80px_120px]">
              <input className={field} placeholder="Line item" value={line.description} onChange={(e) => setLine(i, { description: e.target.value })} />
              <input className={field} inputMode="decimal" placeholder="Qty" value={line.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
              <input className={field} inputMode="decimal" placeholder="Unit $" value={line.unit} onChange={(e) => setLine(i, { unit: e.target.value })} />
            </div>
            <select
              className={`${field} mt-2 w-full`}
              value={line.scopeItemId}
              onChange={(e) => setLine(i, { scopeItemId: e.target.value })}
              data-testid="builder-scope"
            >
              <option value="">Scope item this line bills for…</option>
              {scopeItems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
            {line.evidence.map((ev, k) => (
              <div key={k} className="mt-2 grid gap-2 sm:grid-cols-[1fr_80px_1fr_auto]" data-testid="builder-evidence">
                <select
                  className={field}
                  value={ev.proofId}
                  onChange={(e) => setLine(i, { evidence: line.evidence.map((x, m) => (m === k ? { ...x, proofId: e.target.value } : x)) })}
                >
                  <option value="">Pick a video…</option>
                  {videos.map((v) => (
                    <option key={v.id} value={v.id}>
                      {clipLabel(v)}
                    </option>
                  ))}
                </select>
                <input
                  className={field}
                  placeholder="m:ss"
                  value={ev.at}
                  onChange={(e) => setLine(i, { evidence: line.evidence.map((x, m) => (m === k ? { ...x, at: e.target.value } : x)) })}
                />
                <input
                  className={field}
                  placeholder="Quote from the transcript (optional)"
                  value={ev.quote}
                  onChange={(e) => setLine(i, { evidence: line.evidence.map((x, m) => (m === k ? { ...x, quote: e.target.value } : x)) })}
                />
                <Button size="sm" variant="ghost" onClick={() => setLine(i, { evidence: line.evidence.filter((_, m) => m !== k) })}>
                  Remove
                </Button>
              </div>
            ))}
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={videos.length === 0}
                onClick={() => setLine(i, { evidence: [...line.evidence, { proofId: videos[0]?.id ?? '', at: '', quote: '' }] })}
                data-testid="add-evidence"
              >
                + Link proof
              </Button>
              {lines.length > 1 ? (
                <Button size="sm" variant="ghost" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                  Remove line
                </Button>
              ) : null}
            </div>
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={() => setLines((ls) => [...ls, blankLine()])} className="self-start">
          + Add line
        </Button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <textarea className={field} rows={2} placeholder="Note to the homeowner (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <textarea className={field} rows={2} placeholder="Internal note, never shown to the homeowner" value={internal} onChange={(e) => setInternal(e.target.value)} />
      </div>

      {error ? <p className="mt-2 text-xs text-danger-700">{error}</p> : null}
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold tabular-nums text-ink-900">Total {usd(total)}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" loading={saving} disabled={saving || total <= 0} onClick={save} data-testid="save-invoice">
            Save draft
          </Button>
        </div>
      </div>
    </div>
  );
}
