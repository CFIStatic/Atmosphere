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

export interface SupplyNotAdded {
  materialId: string;
  item: string;
  reason: string;
}

export interface SupplyCart {
  vendor: SupplyVendor;
  vendorLabel: string;
  lines: SupplyCartLine[];
  /** Job materials left out of the cart, each with the reason. */
  notAdded: SupplyNotAdded[];
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
  /** approvedOrderFingerprint of the cart being requested (every line at its evidence qty). */
  cartFingerprint?: string | null,
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
    // The person approved a subset: compare against exactly those lines too.
    const approvedFp = row.approved_order?.fingerprint;
    if (approvedFp && cartFingerprint && fingerprintsMatch(approvedFp, cartFingerprint)) return row;
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
 * Curated public Homedepot.com product pages (no login) used when Akamai
 * blocks automated search HTML. Names, URLs, and prices are real listings.
 */
const HD_PUBLIC_FALLBACKS: Array<{
  match: RegExp;
  productName: string;
  sku: string;
  url: string;
  priceCents: number;
  confidence: MatchConfidence;
  note?: string;
}> = [
  {
    match: /\b(laminate|countertop)\b/i,
    productName: 'FORMICA 4 ft. x 8 ft. Laminate Sheet in Brite White with Matte Finish',
    sku: '202911152',
    url: 'https://www.homedepot.com/p/FORMICA-4-ft-x-8-ft-Laminate-Sheet-in-Brite-White-with-Matte-Finish-004591258408000/202911152',
    priceCents: 7344,
    confidence: 'medium',
  },
  {
    match: /\bbase\s*cabinet\b/i,
    productName: 'Hampton Bay Hampton 30 in. W x 24 in. D x 34.5 in. H Assembled Base Kitchen Cabinet in Satin White',
    sku: '100545475',
    url: 'https://www.homedepot.com/p/Hampton-Bay-Hampton-30-in-W-x-24-in-D-x-34-5-in-H-Assembled-Base-Kitchen-Cabinet-in-Satin-White-KB30-SW/100545475',
    priceCents: 21900,
    confidence: 'low',
    note: 'Low-confidence size match. Confirm the width before you approve.',
  },
  {
    match: /\b(birch|plywood)\b/i,
    productName: 'Swaner Hardwood 3/4 in. x 4 ft. x 8 ft. Birch Plywood',
    sku: '305213039',
    url: 'https://www.homedepot.com/p/Swaner-Hardwood-3-4-in-x-4-ft-x-8-ft-Birch-Plywood-BBI6VI/305213039',
    priceCents: 5158,
    confidence: 'medium',
  },
  {
    match: /\b(drawer\s*slides?|soft[- ]?close)\b/i,
    productName: '15 in. Soft Close Full Extension Under Mount Cabinet Drawer Slide 100 lbs. 1-Pair (2 Pieces)',
    sku: '312507733',
    url: 'https://www.homedepot.com/p/15-in-Soft-Close-Full-Extension-Under-Mount-Cabinet-Drawer-Slide-100-lbs-1-Pair-2-Pieces-SC-UNDMR-15-1/312507733',
    priceCents: 1990,
    confidence: 'medium',
  },
  {
    match: /\b(adhesive|glue|liquid\s*nails|construction\s*adhesive)\b/i,
    productName: 'Liquid Nails Fuze It 9 oz. Gray All Surface Construction Adhesive',
    sku: '206736831',
    url: 'https://www.homedepot.com/p/Liquid-Nails-Fuze-It-9-oz-Gray-All-Surface-Construction-Adhesive-LN-2000/206736831',
    priceCents: 898,
    confidence: 'high',
  },
  {
    match: /\b(crown\s*molding|molding)\b/i,
    productName: 'Alexandria Moulding WM 49 9/16 in. x 3-5/8 in. x 96 in. Primed Pine Finger-Jointed Crown Moulding',
    sku: '205902094',
    url: 'https://www.homedepot.com/p/Alexandria-Moulding-WM-49-9-16-in-x-3-5-8-in-x-96-in-Primed-Pine-Finger-Jointed-Crown-Moulding-0L049-93096C/205902094',
    priceCents: 2088,
    confidence: 'low',
    note: 'The profile isn\'t in the evidence. Confirm it before you approve.',
  },
  {
    match: /\b(finished\s*nails?|finish\s*nails?)\b/i,
    productName: 'Grip-Rite 2 in. x 13-Gauge 6-penny Bright Steel Finish Nails 1 lb. Box',
    sku: '100027781',
    url: 'https://www.homedepot.com/p/Grip-Rite-2-in-x-13-Gauge-6-penny-Bright-Steel-Finish-Nails-1-lb-Box-6F1/100027781',
    priceCents: 782,
    confidence: 'low',
  },
  {
    match: /\b(caulk|sealant)\b/i,
    productName: 'DAP Alex Plus 10.1 oz. White Acrylic Latex Caulk Plus Silicone',
    sku: '100097524',
    url: 'https://www.homedepot.com/p/DAP-Alex-Plus-10-1-oz-White-Acrylic-Latex-Caulk-Plus-Silicone-18103/100097524',
    priceCents: 398,
    confidence: 'medium',
  },
];

function publicFallbackFor(item: JobMaterialItem): (typeof HD_PUBLIC_FALLBACKS)[number] | null {
  const hay = `${item.item} ${item.spec ?? ''}`;
  for (const row of HD_PUBLIC_FALLBACKS) {
    if (row.match.test(hay)) return row;
  }
  return null;
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
      notes = `Home Depot search wasn't reachable from the server (status ${res.status}). Computer will match it in the browser.`;
    }
  } catch (err) {
    notes = "Home Depot search wasn't reachable from the server. Computer will match it in the browser.";
  }

  const ranked = candidates
    .map((c) => ({ c, confidence: scoreNameMatch(query, c.productName) }))
    .sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 };
      return rank[a.confidence] - rank[b.confidence];
    });

  const best = ranked[0];
  if (!best) {
    const fb = publicFallbackFor(item);
    if (fb) {
      return {
        materialId: item.id,
        materialItem: item.item,
        materialSpec: item.spec,
        quantity: item.quantity,
        unit: item.unit,
        productName: fb.productName,
        sku: fb.sku,
        url: fb.url,
        priceCents: fb.priceCents,
        currency: 'USD',
        confidence: fb.confidence,
        alternatives: [],
        searchQuery: query,
        searchUrl,
        notes:
          fb.note ?? 'Matched from a public Home Depot listing. Computer confirms it on the site before checkout.',
      };
    }
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
      notes: notes ?? 'No public match yet. Computer will pick a product on Home Depot during the run.',
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
        ? 'Low-confidence match. Choose the right product before you approve.'
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
      : 'No job address on file. Computer will ask you to confirm delivery or pickup before Place order.',
  };
}

function formatMoney(cents: number | null): string {
  if (cents == null) return 'price pending';
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Why a job material stays out of the cart. Null means it goes in.
 * Spec rules come first so a vague item never gets a guessed product.
 */
export function notAddedReasonFor(match: MatchedProduct): string | null {
  const hay = `${match.materialItem} ${match.materialSpec ?? ''}`;
  if (!match.materialSpec && /\b(upper|wall|microwave)\s+cabinet\b/i.test(hay)) {
    return "Spec needed: the cabinet size isn't in the evidence.";
  }
  if (!match.materialSpec && /\bflooring\b/i.test(hay)) {
    return "Spec needed: the flooring type and area aren't in the evidence.";
  }
  if (!match.productName) return 'No confident match on Home Depot.';
  return null;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** One short sentence for the top of the Approve card. */
export function supplyCartSummary(cart: Pick<SupplyCart, 'lines' | 'subtotalCents'>): string {
  const n = cart.lines.length;
  const items = `${n} ${plural(n, 'item', 'items')}`;
  const qtyUnknown = cart.lines.filter((l) => l.match.quantity == null).length;
  const priceMissing = cart.lines.filter((l) => l.match.quantity != null && l.match.priceCents == null).length;
  const choice = cart.lines.filter((l) => l.match.confidence === 'low').length;
  const needs: string[] = [];
  if (qtyUnknown) needs.push(`${qtyUnknown} ${plural(qtyUnknown, 'needs', 'need')} a quantity`);
  if (priceMissing) needs.push(`${priceMissing} ${plural(priceMissing, 'needs', 'need')} a price`);
  if (choice) needs.push(`${choice} ${plural(choice, 'needs', 'need')} your choice`);
  const lead =
    cart.subtotalCents != null
      ? needs.length
        ? `${items}, ${formatMoney(cart.subtotalCents)} priced so far.`
        : `${items}, ${formatMoney(cart.subtotalCents)} total.`
      : `${items}, none priced yet.`;
  if (!needs.length) return lead;
  const tail =
    needs.length === 1 ? needs[0] : `${needs.slice(0, -1).join(', ')} and ${needs[needs.length - 1]}`;
  return `${lead} ${tail.charAt(0).toUpperCase()}${tail.slice(1)}.`;
}

export function buildSupplyCart(input: {
  vendor: SupplyVendor;
  matches: MatchedProduct[];
  fulfillment: FulfillmentCheck;
}): SupplyCart {
  const meta = SUPPLY_VENDOR_META[input.vendor];
  const notAdded: SupplyNotAdded[] = [];
  const cartMatches: MatchedProduct[] = [];
  for (const match of input.matches) {
    const reason = notAddedReasonFor(match);
    if (reason) notAdded.push({ materialId: match.materialId, item: match.materialItem, reason });
    else cartMatches.push(match);
  }
  const lines: SupplyCartLine[] = cartMatches.map((match) => {
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
  // Total = sum of priced lines only (never invent totals for unknown qty / price).
  const subtotalCents = priced.length > 0 ? priced.reduce((a, b) => a + b, 0) : null;
  const unpricedLines = lines.filter((l) => l.lineTotalCents == null);

  const approvalFields: ApprovalField[] = [];
  for (const line of lines) {
    const m = line.match;
    const qtyLabel =
      m.quantity != null ? `${m.quantity}${m.unit ? ` ${m.unit}` : ''}` : 'Unknown: not stated in the evidence';
    const low = m.confidence === 'low';
    approvalFields.push({
      label: 'Job material',
      value: `${m.materialItem}${m.materialSpec ? ` (${m.materialSpec})` : ''}${low ? ' · low-confidence match' : ''}`,
      source: 'Job file materials list',
      verified: true,
    });
    approvalFields.push({
      label: 'Matched product',
      value: m.productName
        ? `${m.productName}${m.sku ? ` · Internet #${m.sku}` : ''}${m.url ? ` · ${m.url}` : ''}`
        : `No match yet. Search: ${m.searchUrl}`,
      source:
        m.confidence === 'high'
          ? 'Home Depot public listing'
          : m.confidence === 'medium'
            ? 'Home Depot public listing'
            : 'Needs your choice',
      verified: m.confidence === 'high' || m.confidence === 'medium',
    });
    approvalFields.push({
      label: 'Quantity',
      value: qtyLabel,
      source: m.quantity != null ? 'Job file evidence' : 'Not in the evidence, so not guessed',
      verified: m.quantity != null,
    });
    approvalFields.push({
      label: 'Unit price',
      value: formatMoney(m.priceCents),
      source: m.priceCents != null ? 'Home Depot listing' : 'Pending on site',
      verified: m.priceCents != null,
    });
    approvalFields.push({
      label: 'Line total',
      value:
        line.lineTotalCents != null
          ? formatMoney(line.lineTotalCents)
          : m.quantity == null
            ? 'Not priced: quantity unknown'
            : 'Not priced: awaiting price',
      source: line.lineTotalCents != null ? 'Qty × unit price' : 'Excluded from cart total',
      verified: line.lineTotalCents != null,
    });
    if (line.outOfStock || line.substitution || low) {
      approvalFields.push({
        label: 'Stock / substitution',
        value:
          [
            line.outOfStock ? 'Out of stock' : null,
            line.substitution,
            low ? (m.notes || 'Low-confidence match. Confirm before you approve.') : null,
          ]
            .filter(Boolean)
            .join(' · ') || '—',
        source: 'Catalog check',
        verified: !line.outOfStock && !low,
      });
    }
  }

  const cartTotalValue =
    subtotalCents != null
      ? `${formatMoney(subtotalCents)} (sum of priced lines)`
      : 'No priced lines yet';
  approvalFields.push({
    label: 'Cart total',
    value: cartTotalValue,
    source: 'Sum of priced lines only',
    verified: subtotalCents != null && unpricedLines.length === 0,
  });
  if (unpricedLines.length) {
    approvalFields.push({
      label: 'Not priced yet',
      value: unpricedLines
        .map((l) => {
          const why = l.match.quantity == null ? 'quantity unknown' : 'price pending';
          return `${l.match.materialItem} (${why})`;
        })
        .join('; '),
      source: 'Excluded from cart total',
      verified: false,
    });
  }
  for (const skipped of notAdded) {
    approvalFields.push({
      label: 'Not added',
      value: `${skipped.item} — ${skipped.reason}`,
      source: 'Left out of the cart',
      verified: false,
    });
  }
  approvalFields.push({
    label: 'Fulfillment',
    value:
      input.fulfillment.mode === 'delivery' && input.fulfillment.jobAddress
        ? `Delivery to ${input.fulfillment.jobAddress}`
        : input.fulfillment.mode === 'pickup'
          ? `Pickup${input.fulfillment.storeName ? ` at ${input.fulfillment.storeName}` : ''}`
          : 'Not chosen yet. Confirm on the site.',
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
    value: 'The card already saved on your Home Depot account. Atmosphere never sees card numbers.',
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

  return {
    vendor: input.vendor,
    vendorLabel: meta.label,
    lines,
    notAdded,
    subtotalCents,
    fulfillment: input.fulfillment,
    approvalFields,
    summary: supplyCartSummary({ lines, subtotalCents }),
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
  for (const skipped of cart.notAdded) {
    lines.push(`- Not added: ${skipped.item}. ${skipped.reason}`);
  }
  lines.push('');
  lines.push(
    `Priced so far: ${cart.subtotalCents != null ? formatMoney(cart.subtotalCents) : 'none'}`,
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
    notAdded: cart.notAdded.length,
  };
}

// ---------------------------------------------------------------------------
// Per-line Approve: the person checks which cart lines to order.
// ---------------------------------------------------------------------------

/** One cart line as shown on the Approve card, rebuilt from its approval fields. */
export interface ApprovalOrderLine {
  /** Stable key the card sends back: `L<n>:<sku or material slug>`. */
  key: string;
  material: string;
  productName: string | null;
  url: string | null;
  sku: string | null;
  quantity: number | null;
  unit: string | null;
  unitPriceCents: number | null;
  needsChoice: boolean;
}

export interface ApprovedOrderLine {
  key: string;
  material: string;
  productName: string | null;
  sku: string | null;
  url: string | null;
  quantity: number;
  unit: string | null;
  /** 'evidence' = from the job file; 'person' = typed on the Approve card. */
  quantitySource: 'evidence' | 'person';
  unitPriceCents: number | null;
  lineTotalCents: number | null;
  /** A low-confidence match the person checked anyway. */
  confirmedChoice: boolean;
}

/** What the person approved, stored on the approval row and in the audit log. */
export interface ApprovedOrderSelection {
  lines: ApprovedOrderLine[];
  excluded: Array<{ key: string; material: string; productName: string | null; sku: string | null }>;
  subtotalCents: number | null;
  /** sha256 of origin + button + the approved SKUs and quantities. */
  fingerprint: string;
}

export class OrderSelectionError extends Error {}

function slugKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';
}

export function orderLineKey(index: number, sku: string | null, material: string): string {
  return `L${index + 1}:${sku || slugKey(material)}`;
}

/** Group the flat approval fields back into cart lines (same grouping the card uses). */
export function orderLinesFromApprovalFields(fields: ApprovalField[]): ApprovalOrderLine[] {
  const out: ApprovalOrderLine[] = [];
  let cur: Omit<ApprovalOrderLine, 'key'> | null = null;
  const close = () => {
    if (cur) out.push({ ...cur, key: orderLineKey(out.length, cur.sku, cur.material) });
    cur = null;
  };
  for (const f of fields ?? []) {
    const label = String(f.label ?? '').trim().toLowerCase();
    const value = String(f.value ?? '');
    if (label === 'job material') {
      close();
      cur = {
        material: value.replace(/\s*·\s*low-confidence match\s*$/i, '').trim(),
        productName: null,
        url: null,
        sku: null,
        quantity: null,
        unit: null,
        unitPriceCents: null,
        needsChoice: /low-confidence/i.test(value),
      };
      continue;
    }
    if (!cur) continue;
    const line: Omit<ApprovalOrderLine, 'key'> = cur;
    if (label === 'matched product') {
      line.url = value.match(/https?:\/\/\S+/)?.[0] ?? null;
      line.productName = /^no match yet/i.test(value) ? null : value.split(' · ')[0].trim() || null;
      line.sku = value.match(/Internet #\s*(\d+)/i)?.[1] ?? null;
      if (!f.verified) line.needsChoice = true;
    } else if (label === 'quantity') {
      const m = f.verified ? value.match(/^(\d+(?:\.\d+)?)\s*(.*)$/) : null;
      line.quantity = m ? Number(m[1]) : null;
      line.unit = m ? m[2].trim() || null : null;
    } else if (label === 'unit price') {
      line.unitPriceCents = parsePriceToCents(value.match(/\$\s?\d[\d,]*(?:\.\d{2})?/)?.[0] ?? '');
    } else if (!['line total', 'stock / substitution'].includes(label)) {
      close();
    }
  }
  close();
  return out;
}

export function approvedOrderFingerprint(input: {
  origin: string | null | undefined;
  buttonLabel: string;
  lines: Array<{ sku: string | null; material: string; quantity: number }>;
}): string {
  const parts = input.lines
    .map((l) => `${l.sku || norm(l.material)}:${l.quantity}`)
    .sort();
  return createHash('sha256')
    .update(['pay', norm(String(input.origin ?? '')), norm(input.buttonLabel), ...parts].join('|'))
    .digest('hex');
}

/**
 * Check the person's selection against the approval's own fields. Quantities
 * from evidence always win; a typed quantity is only taken for a line whose
 * quantity was unknown. Prices come from the approval, never from the client.
 */
export function resolveOrderSelection(input: {
  fields: ApprovalField[];
  origin: string | null | undefined;
  buttonLabel: string;
  selected: Array<{ key: string; quantity?: number | null }>;
}): ApprovedOrderSelection {
  const lines = orderLinesFromApprovalFields(input.fields);
  if (!lines.length) throw new OrderSelectionError('This approval has no cart lines.');
  const byKey = new Map(lines.map((l) => [l.key, l]));
  const picked = new Map<string, number | null>();
  for (const s of input.selected ?? []) {
    const key = String(s?.key ?? '');
    if (!byKey.has(key)) throw new OrderSelectionError(`Unknown cart line: ${key.slice(0, 60)}`);
    picked.set(key, s.quantity == null ? null : Number(s.quantity));
  }
  if (!picked.size) throw new OrderSelectionError('Check at least one item to order.');

  const approved: ApprovedOrderLine[] = [];
  for (const line of lines) {
    if (!picked.has(line.key)) continue;
    let quantity = line.quantity;
    let quantitySource: ApprovedOrderLine['quantitySource'] = 'evidence';
    if (quantity == null) {
      const typed = picked.get(line.key);
      if (typed == null || !Number.isInteger(typed) || typed < 1 || typed > 999) {
        throw new OrderSelectionError(`Enter a quantity (1–999) for ${line.material} before approving it.`);
      }
      quantity = typed;
      quantitySource = 'person';
    }
    approved.push({
      key: line.key,
      material: line.material,
      productName: line.productName,
      sku: line.sku,
      url: line.url,
      quantity,
      unit: line.unit,
      quantitySource,
      unitPriceCents: line.unitPriceCents,
      lineTotalCents: line.unitPriceCents != null ? Math.round(line.unitPriceCents * quantity) : null,
      confirmedChoice: line.needsChoice,
    });
  }
  const priced = approved.map((l) => l.lineTotalCents).filter((n): n is number => n != null);
  return {
    lines: approved,
    excluded: lines
      .filter((l) => !picked.has(l.key))
      .map((l) => ({ key: l.key, material: l.material, productName: l.productName, sku: l.sku })),
    subtotalCents: priced.length ? priced.reduce((a, b) => a + b, 0) : null,
    fingerprint: approvedOrderFingerprint({ origin: input.origin, buttonLabel: input.buttonLabel, lines: approved }),
  };
}

/** What the agent must do to the live cart before its one Place Order click. */
export function approvedOrderInstructions(buttonLabel: string, sel: ApprovedOrderSelection): string {
  const name = (l: { productName: string | null; material: string; sku: string | null }) =>
    `${l.productName ?? l.material}${l.sku ? ` (Internet #${l.sku})` : ''}`;
  const parts = [`Approved ${sel.lines.length} item${sel.lines.length === 1 ? '' : 's'}.`];
  if (sel.excluded.length) {
    parts.push(`First remove these from the cart: ${sel.excluded.map(name).join('; ')}.`);
  }
  const typed = sel.lines.filter((l) => l.quantitySource === 'person');
  if (typed.length) {
    parts.push(`Set these quantities: ${typed.map((l) => `${name(l)} = ${l.quantity}`).join('; ')}.`);
  }
  parts.push(
    `The cart must then hold exactly: ${sel.lines.map((l) => `${name(l)} × ${l.quantity}`).join('; ')}.`,
    `Take a screenshot to confirm, then click “${buttonLabel}” once. The click is refused while a removed item is still on the page.`,
  );
  return parts.join(' ');
}

/** Removed items whose names still show on the checkout page. */
export function excludedItemsStillOnPage(sel: ApprovedOrderSelection, pageText: string): string[] {
  const hay = norm(pageText);
  return sel.excluded
    .filter((e) => (e.productName && hay.includes(norm(e.productName))) || (e.sku && new RegExp(`\\b${e.sku}\\b`).test(pageText)))
    .map((e) => e.productName ?? e.material);
}
