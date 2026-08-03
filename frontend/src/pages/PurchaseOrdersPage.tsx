import { useEffect, useMemo, useState } from 'react';
import { AppShell, EmptyState, PageHeader, PanelSpinner } from '../components/AppShell';
import {
  api,
  type PurchaseOrder,
  type PurchaseOrderEvent,
  type PurchaseOrderLine,
  type PurchaseOrderStatus,
  type SupplierId,
  type SupplierStatus,
  type TakeoffResult,
  type TakeoffSource,
} from '../lib/api';
import { AlertIcon, CheckIcon, PlusIcon, SpinnerIcon, TrashIcon } from '../components/icons';

/**
 * Purchase orders — the estimate's quantities turned into a shopping list.
 *
 * The takeoff does the arithmetic (square feet into sheets, aggregated across
 * rooms before rounding, waste applied once), and a person does the judgment:
 * every line is editable and deletable before the draft exists, and nothing
 * is ordered until somebody whose name goes on the record approves it.
 *
 * Prices are labelled for what they are. Until a store has quoted the cart,
 * every figure on this screen is a catalog estimate — the approval line says
 * so, because approving "$743, estimated" and approving "$743" are different
 * acts and the screen should not blur them.
 */

const STATUS_STYLE: Record<PurchaseOrderStatus, string> = {
  draft: 'bg-caution-50 text-caution-600',
  approved: 'bg-brand-600/10 text-brand-600',
  placed: 'bg-success-50 text-success-600',
  cancelled: 'bg-paper-200/60 text-ink-500',
};

const STATUS_WORD: Record<PurchaseOrderStatus, string> = {
  draft: 'draft — awaiting approval',
  approved: 'approved',
  placed: 'placed',
  cancelled: 'cancelled',
};

const SUPPLIER_WORD: Record<SupplierId, string> = {
  home_depot: 'The Home Depot',
  lowes: "Lowe's",
  manual: 'Another supplier',
};

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** An editable material line, shared by the takeoff builder and draft edits. */
interface EditableLine {
  materialKey: string;
  description: string;
  detail: string | null;
  quantity: number;
  unit: string;
  unitPrice: number | null;
  sourceSummary: string | null;
  note?: string;
}

export function PurchaseOrdersPage() {
  const [orders, setOrders] = useState<PurchaseOrder[] | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierStatus[]>([]);
  const [view, setView] = useState<'list' | 'new'>('list');
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadOrders() {
    try {
      const res = await api.purchaseOrders();
      setOrders(res.orders);
    } catch (err) {
      setOrders([]);
      setError(err instanceof Error ? err.message : 'Could not load purchase orders.');
    }
  }

  useEffect(() => {
    void loadOrders();
    api.purchasingSuppliers().then((r) => setSuppliers(r.suppliers)).catch(() => {});
  }, []);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Operations"
        title="Purchase orders"
        description="Quantities come straight from the estimate; nothing is ordered until a named person approves it."
        action={
          view === 'list' && (
            <button
              onClick={() => {
                setOpenId(null);
                setView('new');
              }}
              className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-ink-900 transition hover:bg-brand-700"
            >
              <PlusIcon width={16} height={16} />
              New order from an estimate
            </button>
          )
        }
      />

      {error && (
        <p role="alert" className="mb-4 rounded-lg border border-danger-200 bg-danger-50 px-4 py-2 text-sm text-danger-600">
          {error}
        </p>
      )}

      <SupplierStrip suppliers={suppliers} />

      {view === 'new' ? (
        <NewOrderBuilder
          suppliers={suppliers}
          onDone={async (id) => {
            setView('list');
            setOpenId(id);
            await loadOrders();
          }}
          onCancel={() => setView('list')}
        />
      ) : orders === null ? (
        <PanelSpinner label="Loading orders" />
      ) : orders.length === 0 ? (
        <EmptyState
          title="No purchase orders yet"
          hint="Start from an estimate — its quantities become the shopping list."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <ul className="space-y-2">
            {orders.map((order) => (
              <li key={order.id}>
                <button
                  onClick={() => setOpenId(order.id)}
                  className={`w-full rounded-xl glass-card p-4 text-left transition hover:ring-2 hover:ring-brand-200 ${
                    openId === order.id ? 'ring-2 ring-brand-400' : ''
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-ink-900">{order.jobName}</span>
                    <span className="shrink-0 text-xs font-semibold text-ink-700">
                      {usd(order.estTotal ?? 0)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-500">
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${STATUS_STYLE[order.status]}`}>
                      {STATUS_WORD[order.status]}
                    </span>
                    <span>{SUPPLIER_WORD[order.supplier]}</span>
                    <span>
                      {order.lineCount} lines · {day(order.createdAt)}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <div className="min-w-0">
            {openId ? (
              <OrderDetail id={openId} onChanged={loadOrders} />
            ) : (
              <EmptyState title="Pick an order" hint="Its lines, approval record, and history open here." />
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}

/** Which stores are wired up — status only, the credential never comes back. */
function SupplierStrip({ suppliers }: { suppliers: SupplierStatus[] }) {
  if (suppliers.length === 0) return null;
  return (
    <div className="mb-4 flex flex-wrap gap-2 text-[11px]">
      {suppliers.map((s) => (
        <span
          key={s.id}
          className={`rounded-full px-3 py-1 font-medium ${
            s.connected ? 'bg-success-50 text-success-600' : 'glass-card text-ink-500'
          }`}
        >
          {s.label}
          {s.connected
            ? ` — connected${s.accountLabel ? ` as ${s.accountLabel}` : ''}`
            : ' — not connected; orders are recorded, not transmitted'}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * New order: estimate → takeoff → editable draft
 * ------------------------------------------------------------------ */

function NewOrderBuilder({
  suppliers,
  onDone,
  onCancel,
}: {
  suppliers: SupplierStatus[];
  onDone: (orderId: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [sources, setSources] = useState<TakeoffSource[] | null>(null);
  const [source, setSource] = useState<TakeoffSource | null>(null);
  const [takeoff, setTakeoff] = useState<TakeoffResult | null>(null);
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [supplier, setSupplier] = useState<SupplierId>('home_depot');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .purchasingSources()
      .then((r) => setSources(r.sources))
      .catch(() => setSources([]));
  }, []);

  async function pick(src: TakeoffSource) {
    setBusy(true);
    setError(null);
    try {
      const res = await api.purchasingTakeoff(src.estimateId);
      setSource(res.source);
      setTakeoff(res.takeoff);
      setLines(
        res.takeoff.lines.map((l) => ({
          materialKey: l.materialKey,
          description: l.description,
          detail: l.detail,
          quantity: l.quantity,
          unit: l.orderUnit,
          unitPrice: l.estUnitPrice,
          sourceSummary: l.sourceSummary,
          note: l.note,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build the takeoff.');
    } finally {
      setBusy(false);
    }
  }

  const total = useMemo(
    () => lines.reduce((sum, l) => sum + l.quantity * (l.unitPrice ?? 0), 0),
    [lines],
  );

  async function createDraft() {
    if (!source || lines.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.createPurchaseOrder({
        estimateId: source.estimateId,
        jobName: source.jobName,
        claimNumber: source.claimNumber,
        supplier,
        note: note.trim() || null,
        lines: lines.map((l) => ({
          materialKey: l.materialKey,
          description: l.description,
          detail: l.detail,
          quantity: l.quantity,
          unit: l.unit,
          unitPrice: l.unitPrice,
          sourceSummary: l.sourceSummary,
        })),
      });
      await onDone(res.order.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the draft.');
      setBusy(false);
    }
  }

  if (!source) {
    return (
      <section className="rounded-xl glass-card p-5">
        <h2 className="text-base font-semibold text-ink-900">Start from an estimate</h2>
        <p className="mt-1 text-xs text-ink-500">
          The takeoff turns the estimate's work quantities into purchase units — square feet into
          sheets, feet into sticks — aggregated across rooms before anything is rounded up.
        </p>
        {error && <p className="mt-2 text-xs text-danger-600">{error}</p>}
        {sources === null ? (
          <PanelSpinner label="Loading estimates" />
        ) : sources.length === 0 ? (
          <EmptyState title="No estimates yet" hint="Write one under Estimating first — orders start from its quantities." />
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {sources.map((src) => (
              <li key={src.estimateId}>
                <button
                  onClick={() => void pick(src)}
                  disabled={busy}
                  className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-paper-200/30 disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink-900">{src.jobName}</span>
                    <span className="block text-[11px] text-ink-500">
                      {src.claimNumber ? `Claim ${src.claimNumber} · ` : ''}
                      estimated {day(src.createdAt)}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-ink-700">
                    {busy ? <SpinnerIcon className="animate-spin" width={14} height={14} /> : usd(src.total ?? 0)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button onClick={onCancel} className="mt-4 text-xs text-ink-500 hover:text-ink-900">
          Back to orders
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-xl glass-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-ink-900">Materials for {source.jobName}</h2>
        <span className="text-xs text-ink-500">from the estimate of {day(source.createdAt)}</span>
      </div>

      {takeoff && (takeoff.unmapped.length > 0 || takeoff.noMaterials.length > 0) && (
        <div className="mt-3 space-y-2">
          {takeoff.unmapped.length > 0 && (
            <p className="flex items-start gap-2 rounded-lg border border-caution-200 bg-caution-50 px-3 py-2 text-xs text-caution-600">
              <AlertIcon width={14} height={14} className="mt-0.5 shrink-0" />
              <span>
                {takeoff.unmapped.length} estimate line{takeoffPlural(takeoff.unmapped.length)} had no
                material mapping —{' '}
                {takeoff.unmapped.map((u) => `${u.description} (${u.quantity} ${u.unit})`).join('; ')}.
                Add what they need by hand before approving.
              </span>
            </p>
          )}
          {takeoff.noMaterials.length > 0 && (
            <details className="rounded-lg glass-card px-3 py-2 text-xs text-ink-500">
              <summary className="cursor-pointer font-medium text-ink-600">
                {takeoff.noMaterials.length} estimate lines need nothing from a store
              </summary>
              <ul className="mt-2 space-y-1">
                {takeoff.noMaterials.map((n) => (
                  <li key={n.catalogKey}>
                    {n.description} — <span className="text-ink-400">{n.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <LineEditor lines={lines} onChange={setLines} />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <fieldset className="flex flex-wrap gap-2">
          {(['home_depot', 'lowes', 'manual'] as SupplierId[]).map((id) => {
            const status = suppliers.find((s) => s.id === id);
            return (
              <label
                key={id}
                className={`flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
                  supplier === id ? 'bg-brand-600 text-ink-900' : 'glass-card text-ink-600'
                }`}
              >
                <input
                  type="radio"
                  name="supplier"
                  className="sr-only"
                  checked={supplier === id}
                  onChange={() => setSupplier(id)}
                />
                {SUPPLIER_WORD[id]}
                {status && !status.connected && supplier === id && (
                  <span className="text-[10px] opacity-75">(recorded, not transmitted)</span>
                )}
              </label>
            );
          })}
        </fieldset>
        <span className="text-sm font-semibold text-ink-900">
          {usd(total)} <span className="text-[11px] font-normal text-ink-500">estimated</span>
        </span>
      </div>

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Delivery or pickup note (optional)"
        className="mt-3 w-full rounded-lg glass-field px-3 py-2 text-sm text-ink-900 outline-none placeholder:text-ink-400 focus:ring-2 focus:ring-brand-200"
      />

      {error && <p className="mt-2 text-xs text-danger-600">{error}</p>}

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={() => void createDraft()}
          disabled={busy || lines.length === 0}
          className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-ink-900 transition hover:bg-brand-700 disabled:opacity-50"
        >
          {busy && <SpinnerIcon className="animate-spin" width={14} height={14} />}
          Save draft for approval
        </button>
        <button onClick={onCancel} className="text-xs text-ink-500 hover:text-ink-900">
          Discard
        </button>
      </div>
    </section>
  );
}

const takeoffPlural = (n: number) => (n === 1 ? '' : 's');

function LineEditor({
  lines,
  onChange,
}: {
  lines: EditableLine[];
  onChange: (lines: EditableLine[]) => void;
}) {
  return (
    <ul className="mt-3 divide-y divide-line">
      {lines.map((line, index) => (
        <li key={line.materialKey} className="flex items-start gap-3 py-3">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-ink-900">
              {line.description}
              {line.detail && <span className="font-normal text-ink-500"> — {line.detail}</span>}
            </span>
            {line.sourceSummary && (
              <span className="block text-[11px] text-ink-500">Why: {line.sourceSummary}</span>
            )}
            {line.note && (
              <span className="mt-0.5 block text-[11px] text-caution-600">{line.note}</span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <input
              type="number"
              min={1}
              value={line.quantity}
              onChange={(e) => {
                const quantity = Math.max(1, Math.round(Number(e.target.value) || 1));
                onChange(lines.map((l, i) => (i === index ? { ...l, quantity } : l)));
              }}
              className="w-16 rounded-lg glass-field px-2 py-1 text-right text-sm text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
            />
            <span className="w-12 text-[11px] text-ink-500">{line.unit}</span>
            <span className="w-16 text-right text-xs font-medium text-ink-700">
              {usd(line.quantity * (line.unitPrice ?? 0))}
            </span>
            <button
              onClick={() => onChange(lines.filter((_, i) => i !== index))}
              aria-label={`Remove ${line.description}`}
              className="text-ink-400 hover:text-danger-600"
            >
              <TrashIcon width={14} height={14} />
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ *
 * Order detail: the record, and the two verbs
 * ------------------------------------------------------------------ */

function OrderDetail({ id, onChanged }: { id: string; onChanged: () => Promise<void> }) {
  const [order, setOrder] = useState<PurchaseOrder | null>(null);
  const [lines, setLines] = useState<PurchaseOrderLine[]>([]);
  const [events, setEvents] = useState<PurchaseOrderEvent[]>([]);
  const [estTotal, setEstTotal] = useState(0);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api.purchaseOrder(id);
      setOrder(res.order);
      setLines(res.lines);
      setEvents(res.events);
      setEstTotal(res.estTotal);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load that order.');
    }
  }

  useEffect(() => {
    setOrder(null);
    setError(null);
    setReference('');
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function act(name: string, fn: () => Promise<unknown>) {
    setBusy(name);
    setError(null);
    try {
      await fn();
      await load();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not go through.');
    } finally {
      setBusy(null);
    }
  }

  if (!order) return error ? <p className="text-sm text-danger-600">{error}</p> : <PanelSpinner />;

  const estimatedOnly = lines.some((l) => l.priceBasis === 'estimate');

  return (
    <section className="min-w-0 space-y-4">
      <div className="rounded-xl glass-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-ink-900">{order.jobName}</h2>
            <p className="mt-0.5 text-[11px] text-ink-500">
              {SUPPLIER_WORD[order.supplier]}
              {order.claimNumber ? ` · claim ${order.claimNumber}` : ''}
              {order.externalRef ? ` · ref ${order.externalRef}` : ''}
            </p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLE[order.status]}`}>
            {STATUS_WORD[order.status]}
          </span>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-ink-400">
                <th className="py-1.5 pr-3 font-medium">Material</th>
                <th className="py-1.5 pr-3 text-right font-medium">Qty</th>
                <th className="py-1.5 pr-3 font-medium">Unit</th>
                <th className="py-1.5 text-right font-medium">Est. total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {lines.map((line) => (
                <tr key={line.id}>
                  <td className="py-2 pr-3">
                    <span className="font-medium text-ink-900">{line.description}</span>
                    {line.detail && <span className="text-ink-500"> — {line.detail}</span>}
                    {line.sourceSummary && (
                      <span className="block text-[11px] text-ink-500">Why: {line.sourceSummary}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-ink-700">{line.quantity}</td>
                  <td className="py-2 pr-3 text-ink-500">{line.unit}</td>
                  <td className="py-2 text-right tabular-nums text-ink-700">
                    {line.unitPrice === null ? '—' : usd(line.quantity * line.unitPrice)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2">
          <span className="text-[11px] text-ink-500">
            {estimatedOnly
              ? 'Catalog estimates — the store’s checkout price is what you will actually pay.'
              : 'Supplier-quoted prices.'}
          </span>
          <span className="text-sm font-semibold text-ink-900">{usd(estTotal)}</span>
        </div>

        {order.note && <p className="mt-2 text-xs text-ink-600">Note: {order.note}</p>}
        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-600">
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {order.status === 'draft' && (
            <>
              <button
                onClick={() => void act('approve', () => api.approvePurchaseOrder(order.id))}
                disabled={busy !== null}
                className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-ink-900 transition hover:bg-brand-700 disabled:opacity-50"
              >
                {busy === 'approve' ? (
                  <SpinnerIcon className="animate-spin" width={14} height={14} />
                ) : (
                  <CheckIcon width={14} height={14} />
                )}
                Approve — {usd(estTotal)} estimated
              </button>
              <button
                onClick={() => void act('cancel', () => api.cancelPurchaseOrder(order.id))}
                disabled={busy !== null}
                className="text-xs text-ink-500 hover:text-danger-600"
              >
                Cancel order
              </button>
            </>
          )}

          {order.status === 'approved' && (
            <>
              {order.supplier !== 'manual' && (
                <button
                  onClick={() => void act('place', () => api.placePurchaseOrder(order.id))}
                  disabled={busy !== null}
                  className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-ink-900 transition hover:bg-brand-700 disabled:opacity-50"
                >
                  {busy === 'place' && <SpinnerIcon className="animate-spin" width={14} height={14} />}
                  Place with {SUPPLIER_WORD[order.supplier]}
                </button>
              )}
              <span className="flex items-center gap-1.5">
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Order number from the store"
                  className="w-44 rounded-lg glass-field px-3 py-2 text-xs text-ink-900 outline-none placeholder:text-ink-400 focus:ring-2 focus:ring-brand-200"
                />
                <button
                  onClick={() => void act('record', () => api.placePurchaseOrder(order.id, reference))}
                  disabled={busy !== null || !reference.trim()}
                  className="rounded-lg glass-card px-3 py-2 text-xs font-semibold text-ink-700 hover:text-ink-900 disabled:opacity-50"
                >
                  {busy === 'record' ? 'Recording…' : 'Record as placed'}
                </button>
              </span>
              <button
                onClick={() => void act('reopen', () => api.reopenPurchaseOrder(order.id))}
                disabled={busy !== null}
                className="text-xs text-ink-500 hover:text-ink-900"
              >
                Reopen draft
              </button>
            </>
          )}

          {order.status === 'placed' && (
            <p className="text-xs text-success-600">
              Placed {order.placedAt ? day(order.placedAt) : ''}
              {order.externalRef ? ` — reference ${order.externalRef}` : ''}. This order is now a
              record; changes go through the store.
            </p>
          )}
        </div>
      </div>

      {events.length > 0 && (
        <div className="rounded-xl glass-card p-5">
          <h3 className="text-sm font-semibold text-ink-900">History</h3>
          <ul className="mt-2 space-y-1.5 text-xs text-ink-600">
            {events.map((e) => (
              <li key={e.id} className="flex items-baseline gap-2">
                <span className="shrink-0 tabular-nums text-ink-400">{day(e.at)}</span>
                <span>
                  <span className="font-medium text-ink-800">{e.actorName}</span> {e.action}
                  {e.detail ? ` — ${e.detail}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
