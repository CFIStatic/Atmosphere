/**
 * Supply ordering for Computer: product matching, store/fulfillment hints,
 * cart preview fields for the Approve card, and pay/place-order fingerprints
 * (same pattern as send-fingerprint in PR #659) so a double Approve cannot
 * place two orders.
 *
 * Home Depot first; Lowe's, ABC Supply, and SRS use the same shapes later.
 * Checkout never runs without Approve. Card numbers never pass through here.
 */
import { createHash } from 'node:crypto';
import type { ApprovalField, ConsequentialKind } from './types.js';
import type { ComputerApprovalRow } from './store.js';
import type { JobMaterialItem, JobMaterialsList } from '../shared/jobMaterials.js';
import { actionFingerprint, fingerprintsMatch } from './sendIdempotency.js';

export type SupplyVendor = 'home_depot' | 'lowes' | 'abc_supply' | 'srs';

export const SUPPLY_VENDOR_META: Record<
  SupplyVendor,
  { label: string; host: string; searchUrl: (q: string) => string; aliases: string[] }
> = {
  home_depot: {
    label: 'Home Depot',
    host: 'www.homedepot.com',
    searchUrl: (q) => `https://www.homedepot.com/s/${encodeURIComponent(q)}`,
    aliases: ['home depot', 'homedepot', 'hd.com', 'the home depot'],
  },
  lowes: {
    label: "Lowe's",
    host: 'www.lowes.com',
    searchUrl: (q) => `https://www.lowes.com/search?searchTerm=${encodeURIComponent(q)}`,
    aliases: ['lowe', "lowe's", 'lowes'],
  },
  abc_supply: {
    label: 'ABC Supply',
    host: 'www.abcsupply.com',
    searchUrl: (q) => `https://www.abcsupply.com/search?q=${encodeURIComponent(q)}`,
    aliases: ['abc supply', 'abcsupply', 'abc'],
  },
  srs: {
    label: 'SRS Distribution',
    host: 'www.srsdistribution.com',
    searchUrl: (q) => `https://www.srsdistribution.com/search?q=${encodeURIComponent(q)}`,
    aliases: ['srs', 'srs distribution', 'srsdistribution'],
  },
};

export type MatchConfidence = 'high' | 'medium' | 'low';

export interface MatchedProduct {
  materialId: string;
  materialItem: string;
  materialSpec: string | null;
  quantity: number | null;
  unit: string | null;
  productName: string | null;
  sku: string | null;
  url: string | null;
  priceCents: number | null;
  currency: 'USD';
  confidence: MatchConfidence;
  /** When low, person should pick from these. */
  alternatives: Array<{ productName: string; sku: string | null; url: string | null; priceCents: number | null }>;
  searchQuery: string;
  searchUrl: string;
  notes: string | null;
}

export type FulfillmentMode = 'delivery' | 'pickup' | 'unknown';

export interface FulfillmentCheck {
  mode: FulfillmentMode;
  jobAddress: string | null;
  storeName: string | null;
  storeAddress: string | null;
  stockStatus: 'in_stock' | 'limited' | 'out_of_stock' | 'unknown';
  deliveryDateHint: string | null;
  notes: string | null;
}

export interface SupplyCartLine {
  match: MatchedProduct;
  lineTotalCents: number | null;
  outOfStock: boolean;
  substitution: string | null;
}

export interface SupplyCart {
  vendor: SupplyVendor;
  vendorLabel: string;
  lines: SupplyCartLine[];
  subtotalCents: number | null;
  fulfillment: FulfillmentCheck;
  /** Fields ready for the Approve card. */
  approvalFields: ApprovalField[];
  summary: string;
  /** Fingerprint payload (cart contents + address + vendor). */
  orderKey: string;
}

const PLACE_ORDER_LABEL =
  /\b(place\s+(?:your\s+)?order|place\s+order|complete\s+(?:your\s+)?purchase|buy\s+now|pay\s+now|confirm\s+(?:and\s+)?(?:pay|purchase|order)|submit\s+order|checkout)\b/i;

export function isPlaceOrderLikeApproval(
  buttonLabel: string,
  kind?: ConsequentialKind | null,
): boolean {
  if (kind === 'pay') return true;
  return PLACE_ORDER_LABEL.test(String(buttonLabel ?? ''));
}

function norm(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9@._+\-:/ ]+/g, '').trim();
}

/** Stable fingerprint for one irreversible place-order / pay. */
export function orderActionFingerprint(input: {
  kind: ConsequentialKind | string;
  origin: string | null | undefined;
  buttonLabel: string;
  fields: ApprovalField[];
  /** Optional precomputed cart key (vendor + skus + qtys + address). */
  orderKey?: string | null;
}): string {
  if (input.orderKey) {
    const payload = [
      String(input.kind || 'pay'),
      norm(String(input.origin ?? '')),
      norm(String(input.buttonLabel ?? '')),
      norm(input.orderKey),
    ].join('|');
    return createHash('sha256').update(payload).digest('hex');
  }
  // Fall back to the same field hashing used for Send (SKU/qty/total fields).
  return actionFingerprint({
    kind: input.kind,
    origin: input.origin,
    buttonLabel: input.buttonLabel,
    fields: input.fields,
  });
}

export const ALREADY_ORDERED_APPROVAL_MESSAGE =
  'This cart (same items, quantities, and delivery address) already has an approved Place order on this task. ' +
  'Confirm the order confirmation page or email before requesting approval again. ' +
  'If the order is already placed, call finish with submitted=true — do not request_approval again. ' +
  'Only request a new Place order approval if no confirmation exists for this cart.';

/** Prior approval on this task that already completed the same logical order. */
export function findConsumedMatchingOrderApproval(
  approvals: ComputerApprovalRow[],
  fingerprint: string,
): ComputerApprovalRow | null {
  for (const row of approvals) {
    if (row.status !== 'consumed' && row.status !== 'approved') continue;
    if (!isPlaceOrderLikeApproval(row.button_label, row.action_kind)) continue;
    const prior = orderActionFingerprint({
      kind: row.action_kind,
      origin: row.page_origin,
      buttonLabel: row.button_label,
      fields: Array.isArray(row.fields) ? row.fields : [],
    });
    if (fingerprintsMatch(prior, fingerprint)) return row;
  }
  return null;
}

export function detectSupplyVendor(question: string): SupplyVendor | null {
  const q = String(question ?? '').toLowerCase();
  for (const [id, meta] of Object.entries(SUPPLY_VENDOR_META) as Array<[SupplyVendor, (typeof SUPPLY_VENDOR_META)[SupplyVendor]]>) {
    if (meta.aliases.some((a) => q.includes(a)) || q.includes(meta.host)) return id;
  }
  return null;
}

export function looksLikeSupplyOrderAsk(question: string): boolean {
  const q = String(question ?? '').toLowerCase().trim();
  if (!q) return false;
  const orderVerb = /\b(order|buy|purchase|checkout|add\s+to\s+cart|place\s+(?:an?\s+)?order)\b/.test(q);
  const materials = /\b(materials?|supplies|bom|takeoff|shopping\s+list)\b/.test(q);
  const vendor = detectSupplyVendor(q) != null || /\b(home\s*depot|lowe'?s|abc\s*supply|srs)\b/.test(q);
  if (orderVerb && (materials || vendor)) return true;
  if (orderVerb && /\bfor\s+this\s+job\b/.test(q) && vendor) return true;
  return false;
}

function searchQueryFor(item: JobMaterialItem): string {
  return [item.item, item.spec].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function scoreNameMatch(query: string, productName: string): MatchConfidence {
  const q = norm(query);
  const p = norm(productName);
  if (!q || !p) return 'low';
  const qTokens = q.split(' ').filter((t) => t.length > 2);
  if (!qTokens.length) return 'low';
  const hits = qTokens.filter((t) => p.includes(t)).length;
  const ratio = hits / qTokens.length;
  if (ratio >= 0.8 && hits >= 2) return 'high';
  if (ratio >= 0.5) return 'medium';
  return 'low';
}

function parsePriceToCents(raw: string): number | null {
  const m = String(raw).replace(/,/g, '').match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/**
 * Parse a thin slice of Home Depot search HTML for product cards.
 * Best-effort; failures return empty so Computer can match in-browser.
 */
export function parseHomeDepotSearchHtml(html: string): Array<{
  productName: string;
  sku: string | null;
  url: string | null;
  priceCents: number | null;
}> {
  const out: Array<{ productName: string; sku: string | null; url: string | null; priceCents: number | null }> = [];
  const seen = new Set<string>();
  // Common patterns: product titles with /p/ links and itemIds.
  const linkRe =
    /href="(https:\/\/www\.homedepot\.com\/p\/[^"]+)"[^>]*>[\s\S]{0,200}?([A-Z0-9][^<]{8,120})/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) && out.length < 8) {
    const url = m[1].split('?')[0];
    const productName = m[2].replace(/\s+/g, ' ').trim();
    if (seen.has(url) || productName.length < 8) continue;
    seen.add(url);
    const skuMatch = url.match(/(?:\/|-)(\d{5,12})(?:$|\?)/) || html.slice(m.index, m.index + 400).match(/itemId[=:]"?(\d{5,12})/i);
    const priceSlice = html.slice(m.index, m.index + 800);
    const priceCents = parsePriceToCents(priceSlice.match(/\$\s*\d[\d,]*(?:\.\d{2})?/)?.[0] ?? '');
    out.push({
      productName,
      sku: skuMatch ? skuMatch[1] : null,
      url,
      priceCents,
    });
  }
  // JSON-LD Product fallback
  const ld = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  for (const block of ld) {
    const body = block.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/i, '');
    try {
      const data = JSON.parse(body) as unknown;
      const nodes = Array.isArray(data) ? data : [data];
      for (const node of nodes) {
        const n = node as Record<string, unknown>;
        if (String(n['@type'] ?? '') !== 'Product' && !String(n['@type'] ?? '').includes('Product')) continue;
        const name = String(n.name ?? '').trim();
        const url = typeof n.url === 'string' ? n.url : null;
        const sku = n.sku != null ? String(n.sku) : null;
        const offers = n.offers as Record<string, unknown> | Array<Record<string, unknown>> | undefined;
        const offer = Array.isArray(offers) ? offers[0] : offers;
        const priceCents = offer?.price != null ? parsePriceToCents(String(offer.price)) : null;
        if (name && url && !seen.has(url)) {
          seen.add(url);
          out.push({ productName: name, sku, url, priceCents });
        }
      }
    } catch {
      /* ignore bad JSON-LD */
    }
  }
  return out.slice(0, 8);
}

export type SearchFetch = (url: string) => Promise<{ ok: boolean; text: string; status: number }>;

async function defaultFetch(url: string): Promise<{ ok: boolean; text: string; status: number }> {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'AtmosphereBot/1.0 (+https://atmosphere.app; supply-match; respectful public search)',
      Accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(12_000),
  });
  const text = await res.text();
  return { ok: res.ok, text, status: res.status };
}

/** Match one material via public Home Depot search (no login). */
export async function matchHomeDepotProduct(
  item: JobMaterialItem,
  fetchImpl: SearchFetch = defaultFetch,
): Promise<MatchedProduct> {
  const query = searchQueryFor(item);
  const meta = SUPPLY_VENDOR_META.home_depot;
  const searchUrl = meta.searchUrl(query);
  let candidates: ReturnType<typeof parseHomeDepotSearchHtml> = [];
  let notes: string | null = null;
  try {
    const res = await fetchImpl(searchUrl);
    if (res.ok) {
      candidates = parseHomeDepotSearchHtml(res.text);
    } else {
      notes = `Public search returned HTTP ${res.status}; Computer will match in the browser.`;
    }
  } catch (err) {
    notes = `Public search unavailable (${err instanceof Error ? err.message : 'error'}); Computer will match in the browser.`;
  }

  const ranked = candidates
    .map((c) => ({ c, confidence: scoreNameMatch(query, c.productName) }))
    .sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 };
      return rank[a.confidence] - rank[b.confidence];
    });

  const best = ranked[0];
  if (!best) {
    return {
      materialId: item.id,
      materialItem: item.item,
      materialSpec: item.spec,
      quantity: item.quantity,
      unit: item.unit,
      productName: null,
      sku: null,
      url: null,
      priceCents: null,
      currency: 'USD',
      confidence: 'low',
      alternatives: [],
      searchQuery: query,
      searchUrl,
      notes: notes ?? 'No public match yet — pick a product on Home Depot during the Computer run.',
    };
  }

  return {
    materialId: item.id,
    materialItem: item.item,
    materialSpec: item.spec,
    quantity: item.quantity,
    unit: item.unit,
    productName: best.c.productName,
    sku: best.c.sku,
    url: best.c.url,
    priceCents: best.c.priceCents,
    currency: 'USD',
    confidence: best.confidence,
    alternatives: ranked.slice(1, 4).map(({ c }) => ({
      productName: c.productName,
      sku: c.sku,
      url: c.url,
      priceCents: c.priceCents,
    })),
    searchQuery: query,
    searchUrl,
    notes:
      best.confidence === 'low'
        ? 'Low-confidence match — please choose the right product before Approve.'
        : notes,
  };
}

export async function matchMaterialsForVendor(
  list: JobMaterialsList,
  vendor: SupplyVendor,
  fetchImpl: SearchFetch = defaultFetch,
): Promise<MatchedProduct[]> {
  if (vendor !== 'home_depot') {
    // Same design for later vendors — return search URLs only for now.
    const meta = SUPPLY_VENDOR_META[vendor];
    return list.items.map((item) => {
      const query = searchQueryFor(item);
      return {
        materialId: item.id,
        materialItem: item.item,
        materialSpec: item.spec,
        quantity: item.quantity,
        unit: item.unit,
        productName: null,
        sku: null,
        url: null,
        priceCents: null,
        currency: 'USD' as const,
        confidence: 'low' as const,
        alternatives: [],
        searchQuery: query,
        searchUrl: meta.searchUrl(query),
        notes: `${meta.label} matching will use the same Computer flow as Home Depot (not enabled for automated public search yet).`,
      };
    });
  }
  const out: MatchedProduct[] = [];
  for (const item of list.items) {
    out.push(await matchHomeDepotProduct(item, fetchImpl));
  }
  return out;
}

export function checkFulfillment(input: {
  jobAddress: string | null;
  matches: MatchedProduct[];
}): FulfillmentCheck {
  const addr = String(input.jobAddress ?? '').trim() || null;
  const anyOut = input.matches.some((m) => m.notes?.toLowerCase().includes('out of stock'));
  return {
    mode: addr ? 'delivery' : 'unknown',
    jobAddress: addr,
    storeName: null,
    storeAddress: null,
    stockStatus: anyOut ? 'out_of_stock' : 'unknown',
    deliveryDateHint: null,
    notes: addr
      ? 'Delivery to the job address when the site offers it; otherwise pickup at the nearest store. Computer will confirm stock and options on the live page before Approve.'
      : 'No job address on file — Computer will ask you to confirm delivery or pickup before Place order.',
  };
}

function formatMoney(cents: number | null): string {
  if (cents == null) return 'price pending';
  return `$${(cents / 100).toFixed(2)}`;
}

export function buildSupplyCart(input: {
  vendor: SupplyVendor;
  matches: MatchedProduct[];
  fulfillment: FulfillmentCheck;
}): SupplyCart {
  const meta = SUPPLY_VENDOR_META[input.vendor];
  const lines: SupplyCartLine[] = input.matches.map((match) => {
    const qty = match.quantity;
    const lineTotalCents =
      match.priceCents != null && qty != null && Number.isFinite(qty) ? Math.round(match.priceCents * qty) : null;
    return {
      match,
      lineTotalCents,
      outOfStock: match.notes?.toLowerCase().includes('out of stock') ?? false,
      substitution: match.confidence === 'low' && match.alternatives[0]
        ? `Alt: ${match.alternatives[0].productName}`
        : null,
    };
  });

  const priced = lines.map((l) => l.lineTotalCents).filter((n): n is number => n != null);
  const subtotalCents = priced.length === lines.length && lines.length > 0 ? priced.reduce((a, b) => a + b, 0) : null;

  const approvalFields: ApprovalField[] = [];
  for (const line of lines) {
    const m = line.match;
    const qtyLabel =
      m.quantity != null ? `${m.quantity}${m.unit ? ` ${m.unit}` : ''}` : 'quantity unknown — confirm before Approve';
    approvalFields.push({
      label: 'Job material',
      value: `${m.materialItem}${m.materialSpec ? ` (${m.materialSpec})` : ''}`,
      source: 'Job file materials list',
      verified: true,
    });
    approvalFields.push({
      label: 'Matched product',
      value: m.productName
        ? `${m.productName}${m.sku ? ` · SKU ${m.sku}` : ''}${m.url ? ` · ${m.url}` : ''}`
        : `No match yet — search: ${m.searchUrl}`,
      source: m.confidence === 'high' ? 'Home Depot public search' : 'Needs your choice',
      verified: m.confidence === 'high' || m.confidence === 'medium',
    });
    approvalFields.push({
      label: 'Quantity',
      value: qtyLabel,
      source: m.quantity != null ? 'Job file evidence' : 'Unknown in evidence — do not guess',
      verified: m.quantity != null,
    });
    approvalFields.push({
      label: 'Unit price',
      value: formatMoney(m.priceCents),
      source: m.priceCents != null ? 'Home Depot listing' : 'Pending on site',
      verified: m.priceCents != null,
    });
    if (line.outOfStock || line.substitution) {
      approvalFields.push({
        label: 'Stock / substitution',
        value: [line.outOfStock ? 'Out of stock' : null, line.substitution].filter(Boolean).join(' · ') || '—',
        source: 'Catalog check',
        verified: !line.outOfStock,
      });
    }
  }

  approvalFields.push({
    label: 'Cart total',
    value: subtotalCents != null ? formatMoney(subtotalCents) : 'Total pending until every line has a price and quantity',
    source: 'Sum of matched lines',
    verified: subtotalCents != null,
  });
  approvalFields.push({
    label: 'Fulfillment',
    value:
      input.fulfillment.mode === 'delivery' && input.fulfillment.jobAddress
        ? `Delivery to ${input.fulfillment.jobAddress}`
        : input.fulfillment.mode === 'pickup'
          ? `Pickup${input.fulfillment.storeName ? ` at ${input.fulfillment.storeName}` : ''}`
          : 'Confirm delivery or pickup on the site',
    source: input.fulfillment.jobAddress ? 'Job address' : 'Needs confirmation',
    verified: Boolean(input.fulfillment.jobAddress),
  });
  if (input.fulfillment.deliveryDateHint) {
    approvalFields.push({
      label: 'Delivery date',
      value: input.fulfillment.deliveryDateHint,
      source: 'Site estimate',
      verified: true,
    });
  }
  approvalFields.push({
    label: 'Payment',
    value: 'Use the card already saved on the Home Depot account. Atmosphere never handles raw card numbers.',
    source: 'Account on file',
    verified: true,
  });

  const orderKey = [
    input.vendor,
    ...lines.map((l) =>
      [
        l.match.sku || l.match.url || l.match.searchQuery,
        l.match.quantity ?? 'unk',
        l.match.unit ?? '',
      ].join(':'),
    ),
    input.fulfillment.jobAddress ?? '',
  ].join('|');

  const low = lines.filter((l) => l.match.confidence === 'low').length;
  const summaryParts = [
    `${meta.label} cart for ${lines.length} material${lines.length === 1 ? '' : 's'}`,
    subtotalCents != null ? `estimated ${formatMoney(subtotalCents)}` : 'prices pending',
    input.fulfillment.jobAddress ? `deliver to job address` : 'fulfillment TBD',
  ];
  if (low) summaryParts.push(`${low} low-confidence match${low === 1 ? '' : 'es'} to confirm`);

  return {
    vendor: input.vendor,
    vendorLabel: meta.label,
    lines,
    subtotalCents,
    fulfillment: input.fulfillment,
    approvalFields,
    summary: summaryParts.join(' · ') + '. Nothing is purchased until you press Approve.',
    orderKey,
  };
}

/** Chat-facing cart preview (no AI dollar labels — just the numbers). */
export function formatSupplyCartForChat(cart: SupplyCart): string {
  const lines = [
    `Draft ${cart.vendorLabel} order (Approve required before checkout):`,
    '',
  ];
  for (const line of cart.lines) {
    const m = line.match;
    const qty = m.quantity != null ? `${m.quantity}${m.unit ? ` ${m.unit}` : ''}` : 'qty unknown';
    const prod = m.productName ?? '(choose on site)';
    const price = m.priceCents != null ? formatMoney(m.priceCents) : 'price pending';
    const conf = m.confidence === 'high' ? '' : ` [${m.confidence} confidence]`;
    lines.push(`- ${m.materialItem}${m.materialSpec ? ` (${m.materialSpec})` : ''}: ${prod} × ${qty} @ ${price}${conf}`);
    if (m.url) lines.push(`  Link: ${m.url}`);
  }
  lines.push('');
  lines.push(
    `Total: ${cart.subtotalCents != null ? formatMoney(cart.subtotalCents) : 'pending'}`,
  );
  if (cart.fulfillment.jobAddress) {
    lines.push(`Delivery address: ${cart.fulfillment.jobAddress}`);
  }
  lines.push('');
  lines.push(
    'I will open Home Depot with your saved Login (if any), fill the cart, and show an Approve card before Place order. Nothing is purchased until you Approve. Card numbers never leave the site account.',
  );
  return lines.join('\n');
}

/** Audit detail (no secrets, no clip bytes). */
export function supplyOrderAuditDetail(cart: SupplyCart): Record<string, unknown> {
  return {
    vendor: cart.vendor,
    lineCount: cart.lines.length,
    orderKeyHash: createHash('sha256').update(cart.orderKey).digest('hex'),
    subtotalCents: cart.subtotalCents,
    fulfillmentMode: cart.fulfillment.mode,
    hasAddress: Boolean(cart.fulfillment.jobAddress),
    lowConfidence: cart.lines.filter((l) => l.match.confidence === 'low').length,
  };
}
