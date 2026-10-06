/**
 * Groups a supply-order approval's flat fields (Job material / Matched product /
 * Quantity / Unit price / Line total … per item) into one row per cart line,
 * so the Approve card can show a compact table instead of repeated labels.
 */
import type { ComputerApprovalField } from './computer';

export type OrderLineFlag = 'ready' | 'needs_choice' | 'qty_unknown' | 'price_pending';

export interface OrderLine {
  /** Same key the server rebuilds: `L<n>:<sku or material slug>`. */
  key: string;
  material: string;
  productName: string | null;
  productUrl: string | null;
  sku: string | null;
  qty: string | null;
  /** Numeric quantity from evidence; null when unknown. */
  qtyNumber: number | null;
  unitPrice: string | null;
  unitPriceCents: number | null;
  lineTotal: string | null;
  flags: OrderLineFlag[];
  note: string | null;
  /** The original evidence fields, for the Details disclosure. */
  fields: ComputerApprovalField[];
}

export interface ParsedOrderApproval {
  lines: OrderLine[];
  notAdded: Array<{ item: string; reason: string }>;
  total: string | null;
  fulfillment: ComputerApprovalField | null;
  payment: ComputerApprovalField | null;
  other: ComputerApprovalField[];
}

const URL_RE = /https?:\/\/\S+/;
const MONEY_RE = /\$\s?\d[\d,]*(?:\.\d{2})?/;

function label(f: ComputerApprovalField): string {
  return f.label.trim().toLowerCase();
}

/** Null unless the fields look like a supply cart (at least one material + product). */
export function parseOrderApproval(fields: ComputerApprovalField[]): ParsedOrderApproval | null {
  if (!fields.some((f) => label(f) === 'job material') || !fields.some((f) => label(f) === 'matched product')) {
    return null;
  }
  const out: ParsedOrderApproval = { lines: [], notAdded: [], total: null, fulfillment: null, payment: null, other: [] };
  let line: OrderLine | null = null;
  let qtyKnown = true;
  let priced = false;
  let choice = false;

  const close = () => {
    if (!line) return;
    const flags: OrderLineFlag[] = [];
    if (choice) flags.push('needs_choice');
    if (!qtyKnown) flags.push('qty_unknown');
    else if (!priced) flags.push('price_pending');
    line.flags = flags.length ? flags : ['ready'];
    line.key = orderLineKey(out.lines.length, line.sku, line.material);
    out.lines.push(line);
    line = null;
  };

  for (const f of fields) {
    const l = label(f);
    if (l === 'job material') {
      close();
      choice = /low-confidence/i.test(f.value);
      qtyKnown = true;
      priced = false;
      line = {
        key: '',
        material: f.value.replace(/\s*·\s*low-confidence match\s*$/i, '').trim(),
        productName: null,
        productUrl: null,
        sku: null,
        qty: null,
        qtyNumber: null,
        unitPrice: null,
        unitPriceCents: null,
        lineTotal: null,
        flags: [],
        note: null,
        fields: [f],
      };
      continue;
    }
    if (line && ['matched product', 'quantity', 'unit price', 'line total', 'stock / substitution'].includes(l)) {
      line.fields.push(f);
      if (l === 'matched product') {
        const url = f.value.match(URL_RE)?.[0] ?? null;
        const noMatch = /^no match yet/i.test(f.value);
        line.productUrl = url;
        line.productName = noMatch ? null : f.value.split(' · ')[0].trim() || null;
        line.sku = f.value.match(/Internet #\s*(\d+)/i)?.[1] ?? null;
        if (!f.verified) choice = true;
      } else if (l === 'quantity') {
        qtyKnown = f.verified;
        line.qty = f.verified ? f.value : null;
        const n = f.verified ? f.value.match(/^(\d+(?:\.\d+)?)/) : null;
        line.qtyNumber = n ? Number(n[1]) : null;
      } else if (l === 'unit price') {
        line.unitPrice = f.value.match(MONEY_RE)?.[0] ?? null;
        line.unitPriceCents = line.unitPrice ? Math.round(Number(line.unitPrice.replace(/[$,\s]/g, '')) * 100) : null;
      } else if (l === 'line total') {
        priced = f.verified;
        line.lineTotal = f.verified ? (f.value.match(MONEY_RE)?.[0] ?? f.value) : null;
      } else if (l === 'stock / substitution') {
        line.note = f.value;
      }
      continue;
    }
    close();
    if (l === 'cart total') out.total = f.value.match(MONEY_RE)?.[0] ?? null;
    else if (l === 'not priced yet') continue; // shown per row
    else if (l === 'not added') {
      const [item, ...rest] = f.value.split(' — ');
      out.notAdded.push({ item: item.trim(), reason: rest.join(' — ').trim() || 'Left out of the cart.' });
    } else if (l === 'fulfillment' || l === 'delivery') out.fulfillment = f;
    else if (l === 'payment') out.payment = f;
    else out.other.push(f);
  }
  close();
  return out;
}

export const ORDER_FLAG_LABEL: Record<OrderLineFlag, string> = {
  ready: 'Ready',
  needs_choice: 'Needs your choice',
  qty_unknown: 'Qty unknown',
  price_pending: 'Price pending',
};

function slugKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';
}

export function orderLineKey(index: number, sku: string | null, material: string): string {
  return `L${index + 1}:${sku || slugKey(material)}`;
}

/** Sent to POST /approvals/:id/approve. */
export interface ComputerOrderSelection {
  lines: Array<{ key: string; quantity?: number }>;
}

/** Checked by default only when the line needs nothing from the person. */
export function startsChecked(line: OrderLine): boolean {
  return !line.flags.includes('needs_choice') && !line.flags.includes('qty_unknown');
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
