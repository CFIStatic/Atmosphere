import { useMemo, useState, type ReactNode } from 'react';
import { COMPUTER_ACTION_LABEL, type ComputerApprovalField, type ComputerTaskApproval } from '../../lib/computer';
import {
  formatCents,
  ORDER_FLAG_LABEL,
  parseOrderApproval,
  startsChecked,
  type ComputerOrderSelection,
  type OrderLine,
  type OrderLineFlag,
  type ParsedOrderApproval,
} from '../../lib/supplyOrderApproval';

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function isCosmeticApprovalField(label: string, value = ''): boolean {
  const l = label.toLowerCase();
  const v = value.toLowerCase();
  if (/\b(font|font-family|font family|font size|fontsize|typeface|text style)\b/.test(l)) return true;
  if (/\b(arial|calibri|times new roman|helvetica)\b/.test(v) && /font/.test(l)) return true;
  return false;
}

function isMailBodyField(label: string): boolean {
  return /^(to|subject|body|message)\b/i.test(label.trim());
}

function isOrderPriorityField(label: string): boolean {
  return /^(job material|matched product|quantity|unit price|line total|cart total|not priced yet|fulfillment|delivery|stock|payment|substitution)\b/i.test(
    label.trim(),
  );
}

function linkify(value: string): ReactNode {
  const parts = value.split(/(https?:\/\/[^\s]+)/g);
  if (parts.length === 1) return value;
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noreferrer"
        className="break-all text-brand-700 underline decoration-brand-200 underline-offset-2 hover:decoration-brand-600"
      >
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function approvalTitle(approval: ComputerTaskApproval, host: string | null): string {
  const isOrder =
    approval.actionKind === 'pay' || /place\s+(?:your\s+)?order/i.test(approval.buttonLabel);
  if (!isOrder) {
    return `Click “${approval.buttonLabel}”${host ? ` on ${host}` : ''}?`;
  }
  const hay = `${host ?? ''} ${approval.summary ?? ''} ${approval.pageUrl ?? ''}`.toLowerCase();
  if (/homedepot|home depot/.test(hay)) return 'Place this Home Depot order?';
  if (/lowe/.test(hay)) return "Place this Lowe's order?";
  if (/abc\s*supply|abcsupply/.test(hay)) return 'Place this ABC Supply order?';
  if (/\bsrs\b/.test(hay)) return 'Place this SRS order?';
  return 'Place this supply order?';
}

type RowStatus = OrderLineFlag | 'qty_entered' | 'confirmed';

const STATUS_LABEL: Record<RowStatus, string> = {
  ...ORDER_FLAG_LABEL,
  qty_entered: 'Qty entered by you',
  confirmed: 'Confirmed by you',
};

const STATUS_TONE: Record<RowStatus, string> = {
  ready: 'bg-success-50 text-success-600',
  confirmed: 'bg-success-50 text-success-600',
  qty_entered: 'bg-paper-200 text-ink-700',
  needs_choice: 'bg-danger-50 text-danger-600',
  qty_unknown: 'bg-caution-50 text-caution-600',
  price_pending: 'bg-caution-50 text-caution-600',
};

function StatusPill({ status }: { status: RowStatus }) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[status]}`}
      data-testid="order-line-flag"
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function hostLabel(url: string | null): string {
  return (hostOf(url) ?? 'site').replace(/^www\./, '');
}

/** Field value with any raw URL replaced by a short link. */
function valueWithoutRawUrl(value: string): ReactNode {
  const url = value.match(/https?:\/\/\S+/)?.[0];
  if (!url) return value;
  const text = value.replace(url, '').replace(/\s*·\s*$/, '').trim();
  return (
    <>
      {text}{' '}
      <a href={url} target="_blank" rel="noreferrer" className="text-brand-700 underline decoration-brand-200 underline-offset-2">
        Open on {hostLabel(url)}
      </a>
    </>
  );
}

const GRID =
  'sm:grid sm:grid-cols-[1.25rem_minmax(0,1fr)_4.5rem_5rem_5.75rem_8.25rem] sm:items-start sm:gap-x-3';

/** One cart line after the person's edits on the card. */
export interface OrderRowState {
  line: OrderLine;
  qty: number | null;
  typedQty: string;
  canCheck: boolean;
  checked: boolean;
  lineCents: number | null;
  statuses: RowStatus[];
}

function parseTypedQty(raw: string | undefined): number | null {
  if (!raw || !/^\d{1,3}$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n >= 1 && n <= 999 ? n : null;
}

function rowStates(order: ParsedOrderApproval, checked: Record<string, boolean>, typed: Record<string, string>): OrderRowState[] {
  return order.lines.map((line) => {
    const typedQty = typed[line.key] ?? '';
    const qty = line.qtyNumber ?? parseTypedQty(typedQty);
    const canCheck = qty != null;
    const isChecked = canCheck && Boolean(checked[line.key]);
    const statuses: RowStatus[] = [];
    if (line.flags.includes('needs_choice')) statuses.push(isChecked ? 'confirmed' : 'needs_choice');
    if (line.flags.includes('qty_unknown')) statuses.push(qty != null ? 'qty_entered' : 'qty_unknown');
    if (line.flags.includes('price_pending')) statuses.push('price_pending');
    if (!statuses.length) statuses.push('ready');
    return {
      line,
      qty,
      typedQty,
      canCheck,
      checked: isChecked,
      lineCents: qty != null && line.unitPriceCents != null ? Math.round(line.unitPriceCents * qty) : null,
      statuses,
    };
  });
}

/**
 * Summary line for the order card, computed from the same row state as the
 * total and the Approve button so the three always agree.
 */
function liveOrderSummary(rows: OrderRowState[], totalCents: number): string {
  const checkedRows = rows.filter((r) => r.checked);
  const needQty = rows.filter((r) => r.line.flags.includes('qty_unknown') && r.qty == null).length;
  const needChoice = rows.filter((r) => r.line.flags.includes('needs_choice') && !r.checked).length;
  const unpriced = checkedRows.filter((r) => r.lineCents == null).length;
  const head =
    checkedRows.length === rows.length
      ? `All ${rows.length} ${rows.length === 1 ? 'item' : 'items'} checked, ${formatCents(totalCents)}.`
      : `${checkedRows.length} of ${rows.length} items checked, ${formatCents(totalCents)}.`;
  const todo: string[] = [];
  if (needQty) todo.push(`${needQty} still ${needQty === 1 ? 'needs' : 'need'} a quantity`);
  if (needChoice) todo.push(`${needChoice} ${needChoice === 1 ? 'needs' : 'need'} your choice`);
  const parts = [head];
  if (todo.length) parts.push(`${todo.join(' and ')}.`.replace(/^./, (c) => c.toUpperCase()));
  if (unpriced) parts.push(`${unpriced} checked ${unpriced === 1 ? 'item has' : 'items have'} no price yet and ${unpriced === 1 ? "isn't" : "aren't"} in the total.`);
  return parts.join(' ');
}

function OrderLineRow({
  row,
  onToggle,
  onQty,
}: {
  row: OrderRowState;
  onToggle: (checked: boolean) => void;
  onQty: (value: string) => void;
}) {
  const { line } = row;
  const name = line.productName ?? line.material;
  return (
    <li
      className={`px-2.5 py-2 text-[13px] transition-opacity ${GRID} ${row.checked ? '' : 'bg-paper-50/60'}`}
      data-testid="order-line"
      data-checked={row.checked ? 'true' : 'false'}
    >
      <div className="float-left mr-2 pt-0.5 sm:float-none sm:mr-0">
        <input
          type="checkbox"
          className="h-4 w-4 cursor-pointer accent-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
          checked={row.checked}
          disabled={!row.canCheck}
          onChange={(e) => onToggle(e.target.checked)}
          aria-label={`Order ${name}`}
          title={row.canCheck ? undefined : 'Enter a quantity first'}
          data-testid="order-line-check"
        />
      </div>
      <div className={`min-w-0 ${row.checked ? '' : 'opacity-60'}`}>
        {line.productName && line.productUrl ? (
          <a
            href={line.productUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-brand-700 underline decoration-brand-200 underline-offset-2 hover:decoration-brand-600"
            data-testid="order-line-product"
          >
            {line.productName}
          </a>
        ) : (
          <span className="font-medium text-ink-900">{line.productName ?? 'No match yet'}</span>
        )}
        <p className="text-[11px] text-ink-500">For {line.material}</p>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-ink-800 sm:contents">
        <span data-testid="order-line-qty">
          {line.qtyNumber != null ? (
            line.qty
          ) : (
            <input
              type="text"
              inputMode="numeric"
              value={row.typedQty}
              onChange={(e) => onQty(e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
              placeholder="Qty"
              aria-label={`Quantity for ${name}`}
              className="w-14 rounded-md border border-line bg-paper-0 px-1.5 py-0.5 text-[13px] text-ink-900 placeholder:text-ink-400 focus:border-brand-400 focus:outline-none"
              data-testid="order-line-qty-input"
            />
          )}
        </span>
        <span className={`tabular-nums ${row.checked ? '' : 'opacity-60'}`}>
          {line.unitPrice ?? <span className="text-ink-500">—</span>}
        </span>
        <span className="tabular-nums" data-testid="order-line-total">
          {!row.checked ? (
            <span className="text-ink-500">Not in order</span>
          ) : row.lineCents != null ? (
            <span className="font-semibold text-ink-900">{formatCents(row.lineCents)}</span>
          ) : (
            <span className="text-ink-500">Not priced</span>
          )}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1 sm:mt-0">
        {row.statuses.map((s) => (
          <StatusPill key={s} status={s} />
        ))}
      </div>
    </li>
  );
}

function SourceMark({ field }: { field: ComputerApprovalField }) {
  return (
    <span className={`text-[11px] ${field.verified ? 'text-success-600' : 'font-semibold text-danger-600'}`}>
      {field.verified ? '✓ ' : '⚠ '}
      {field.source}
    </span>
  );
}

function SupplyOrderSummary({
  order,
  rows,
  totalCents,
  onToggle,
  onQty,
}: {
  order: ParsedOrderApproval;
  rows: OrderRowState[];
  totalCents: number;
  onToggle: (key: string, checked: boolean) => void;
  onQty: (key: string, value: string) => void;
}) {
  const checkedCount = rows.filter((r) => r.checked).length;
  const unpricedChecked = rows.filter((r) => r.checked && r.lineCents == null).length;
  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-lg border border-line bg-paper-0" data-testid="order-lines">
        <div className={`hidden bg-paper-50 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500 ${GRID}`}>
          <span aria-hidden="true" />
          <span>Item</span>
          <span>Qty</span>
          <span>Unit price</span>
          <span>Line total</span>
          <span>Status</span>
        </div>
        <ul className="divide-y divide-line" aria-label="Cart lines">
          {rows.map((row) => (
            <OrderLineRow
              key={row.line.key}
              row={row}
              onToggle={(c) => onToggle(row.line.key, c)}
              onQty={(v) => onQty(row.line.key, v)}
            />
          ))}
        </ul>
        <div className={`border-t border-line bg-paper-50 px-2.5 py-2 text-[13px] ${GRID}`} data-testid="order-total">
          <span className="hidden sm:block" />
          <span className="font-semibold text-ink-900">Total for checked items</span>
          <span className="hidden sm:block" />
          <span className="hidden sm:block" />
          <span className="font-semibold tabular-nums text-ink-900" data-testid="order-total-amount">
            {formatCents(totalCents)}
          </span>
          <span className="text-[11px] text-ink-500">
            {checkedCount} of {rows.length} checked
            {unpricedChecked ? ` · ${unpricedChecked} not priced` : ''}
          </span>
        </div>
      </div>

      {order.notAdded.length ? (
        <div className="rounded-lg border border-line bg-paper-0 px-2.5 py-2" data-testid="order-not-added">
          <p className="text-[12px] font-semibold text-ink-800">Not added ({order.notAdded.length})</p>
          <ul className="mt-1 space-y-0.5 text-[12px] text-ink-700">
            {order.notAdded.map((n) => (
              <li key={n.item} className="grid gap-x-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
                <span className="font-medium text-ink-900">{n.item}</span>
                <span>{n.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {order.fulfillment ? (
        <p className="text-[12px] text-ink-700" data-testid="order-fulfillment">
          <span className="font-semibold text-ink-800">Delivery or pickup:</span>{' '}
          {order.fulfillment.verified ? (
            order.fulfillment.value
          ) : (
            <span className="font-semibold text-danger-600">⚠ {order.fulfillment.value}</span>
          )}
        </p>
      ) : null}

      <details className="rounded-lg border border-line bg-paper-0 text-[12px]" data-testid="order-details">
        <summary className="cursor-pointer select-none px-2.5 py-1.5 font-semibold text-ink-700">Details</summary>
        <div className="divide-y divide-line border-t border-line">
          {order.lines.map((line) => (
            <div key={line.key} className="space-y-1 px-2.5 py-2">
              <p className="font-semibold text-ink-900">{line.material}</p>
              {line.fields.slice(1).map((f, j) => (
                <div key={`${f.label}-${j}`} className="grid gap-x-3 sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,12rem)]">
                  <span className="text-ink-500">{f.label}</span>
                  <span className="break-words text-ink-800">{valueWithoutRawUrl(f.value)}</span>
                  <SourceMark field={f} />
                </div>
              ))}
            </div>
          ))}
          {order.other.map((f, i) => (
            <div key={`${f.label}-${i}`} className="grid gap-x-3 px-2.5 py-2 sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,12rem)]">
              <span className="text-ink-500">{f.label}</span>
              <span className="break-words text-ink-800">{valueWithoutRawUrl(f.value)}</span>
              <SourceMark field={f} />
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

/**
 * The one place a person lets Computer submit, send, pay, delete, sign,
 * accept terms or upload. Shows the page as it is now and every filled
 * field with its value and where that value came from (checked in code).
 * For Home Depot (and later supply) carts, order lines and totals are listed
 * first. Nothing is purchased without Approve.
 */
export function ComputerApprovalCard({
  approval,
  busy,
  onApprove,
  onTakeControl,
  onCancel,
}: {
  approval: ComputerTaskApproval;
  busy?: boolean;
  /** Supply orders pass the checked lines; other approvals pass nothing. */
  onApprove: (selection?: ComputerOrderSelection) => void;
  onTakeControl: () => void;
  onCancel: () => void;
}) {
  const host = hostOf(approval.pageUrl);
  const fields = approval.fields.filter((f) => !isCosmeticApprovalField(f.label, f.value));
  const unverified = fields.filter((f) => !f.verified).length;
  const mailFields = fields.filter((f) => isMailBodyField(f.label));
  const orderFields = fields.filter((f) => isOrderPriorityField(f.label));
  const otherFields = fields.filter((f) => !isMailBodyField(f.label) && !isOrderPriorityField(f.label));
  const ordered =
    approval.actionKind === 'pay' || orderFields.length >= 2
      ? [...orderFields, ...mailFields, ...otherFields]
      : [...mailFields, ...orderFields, ...otherFields];
  const isOrder = approval.actionKind === 'pay' || /place\s+(?:your\s+)?order/i.test(approval.buttonLabel);
  const title = approvalTitle(approval, host);
  const rawFields = approval.fields;
  const order = useMemo(
    () => (isOrder ? parseOrderApproval(rawFields.filter((f) => !isCosmeticApprovalField(f.label, f.value))) : null),
    [isOrder, rawFields],
  );
  // Parents key this card on approval.id, so a new approval starts from these defaults.
  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries((order?.lines ?? []).map((l) => [l.key, startsChecked(l)])),
  );
  const [typedQty, setTypedQty] = useState<Record<string, string>>({});
  const rows = order ? rowStates(order, checked, typedQty) : [];
  const selected = rows.filter((r) => r.checked);
  const totalCents = selected.reduce((sum, r) => sum + (r.lineCents ?? 0), 0);
  const onQty = (key: string, value: string) => {
    const wasValid = parseTypedQty(typedQty[key]) != null;
    setTypedQty((prev) => ({ ...prev, [key]: value }));
    // Fixing an unknown quantity checks the line; the person can still uncheck it.
    if (!wasValid && parseTypedQty(value) != null) setChecked((prev) => ({ ...prev, [key]: true }));
  };
  const approveOrder = () =>
    onApprove({
      lines: selected.map((r) => (r.line.qtyNumber == null && r.qty != null ? { key: r.line.key, quantity: r.qty } : { key: r.line.key })),
    });
  const approveLabel = order
    ? selected.length
      ? `Approve ${selected.length} ${selected.length === 1 ? 'item' : 'items'}, ${formatCents(totalCents)}`
      : 'Check an item to approve'
    : `Approve “${approval.buttonLabel}”`;
  return (
    <div className="space-y-3 rounded-xl border border-caution-600/40 bg-caution-50 p-3" data-testid="computer-approval-card">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-caution-600">
          Needs your approval · {COMPUTER_ACTION_LABEL[approval.actionKind]}
        </p>
        <p className="mt-0.5 text-[15px] font-semibold text-ink-900" data-testid="computer-approval-title">
          {title}
        </p>
        <p className="mt-1 text-sm text-ink-700" data-testid={order ? 'order-live-summary' : undefined}>
          {order ? liveOrderSummary(rows, totalCents) : approval.summary}
        </p>
        {isOrder ? (
          <p className="mt-1 text-[12px] font-medium text-ink-700" data-testid="computer-approval-order-note">
            {order?.payment
              ? `Payment: ${order.payment.value}`
              : 'Payment: the card already saved on this account. Atmosphere never sees card numbers.'}
          </p>
        ) : null}
      </div>
      {approval.screenshot ? (
        <img
          src={approval.screenshot}
          alt={`The page before clicking ${approval.buttonLabel}`}
          className="mx-auto max-h-64 w-auto max-w-full rounded-lg border border-line bg-paper-0 object-contain"
          data-testid="computer-approval-screenshot"
        />
      ) : null}
      {order ? (
        <SupplyOrderSummary
          order={order}
          rows={rows}
          totalCents={totalCents}
          onToggle={(key, c) => setChecked((prev) => ({ ...prev, [key]: c }))}
          onQty={onQty}
        />
      ) : ordered.length ? (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-paper-0" aria-label="Filled fields">
          {ordered.map((f, i) => (
            <li
              key={`${f.label}-${i}`}
              className="grid gap-x-3 gap-y-0.5 px-2.5 py-2 text-[13px] sm:grid-cols-[minmax(7rem,1fr)_minmax(0,1.4fr)_minmax(0,1.4fr)]"
              data-testid="computer-approval-field"
            >
              <span className="text-[12px] text-ink-600 sm:text-[13px]">{f.label}</span>
              <span className="break-words font-medium text-ink-900">{linkify(f.value)}</span>
              <span className={`text-[12px] ${f.verified ? 'text-success-600' : 'font-semibold text-danger-600'}`}>
                {f.verified ? '✓ ' : '⚠ '}
                {f.source}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-600">Computer did not list any filled fields.</p>
      )}
      {unverified && !order ? (
        <p className="text-[12px] font-medium text-danger-600">
          {unverified === 1 ? '1 value' : `${unverified} values`} did not come from this job or your message. Check before
          approving, or take control and fix it.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || (order != null && selected.length === 0)}
          onClick={order ? approveOrder : () => onApprove()}
          className="rounded-full bg-brand-600 px-3.5 py-1.5 text-[13px] font-semibold text-ink-900 transition hover:bg-brand-700 disabled:opacity-50"
          data-testid="computer-approval-approve"
        >
          {approveLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onTakeControl}
          className="rounded-full border border-line bg-paper-0 px-3.5 py-1.5 text-[13px] font-semibold text-ink-800 transition hover:border-brand-200 disabled:opacity-50"
        >
          Take control
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded-full border border-line bg-paper-0 px-3.5 py-1.5 text-[13px] font-medium text-ink-600 transition hover:border-danger-600/40 hover:text-danger-600 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      <p className="text-[11px] text-ink-500">
        {isOrder
          ? 'Nothing is purchased until you press Approve. Unchecked items are removed from the Home Depot cart before checkout. Your name, the time, and the approved lines are logged.'
          : 'One approval covers one irreversible click. Nothing is submitted until you approve. Your name and time are logged.'}
      </p>
    </div>
  );
}
