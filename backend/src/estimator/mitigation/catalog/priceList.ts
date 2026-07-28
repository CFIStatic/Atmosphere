import { round } from '../lib/geometry.js';
import { CATALOG, type CatalogItem } from './lineItems.js';
import type { Unit } from '../types.js';

/**
 * Price-list resolution and reconciliation.
 *
 * An estimate is only as good as the price list behind it. Xactimate price lists
 * are regional and refreshed monthly, and the codes themselves move between
 * versions — so the seeded catalog in `lineItems.ts` is treated as a guess until
 * it has been checked against the price list on the user's own Xactimate
 * account.
 *
 * `reconcileCatalog` is that check. It matches every seeded entry to a real
 * price-list entry — by code first, then by description — and returns a catalog
 * whose prices, descriptions and units come from the account rather than from
 * this repository. Anything it cannot match stays `verified: false` and is
 * surfaced to the user instead of being quietly billed at a made-up price.
 */

/** One row of a real Xactimate price list, as returned by the account. */
export interface PriceListEntry {
  code: string;
  description: string;
  unit: string;
  unitPrice: number;
  /** Some price lists carry a separate labour/material split. */
  laborPrice?: number;
  materialPrice?: number;
  equipmentPrice?: number;
}

export interface PriceList {
  /** Xactimate price-list identifier, e.g. 'FLMI8X_JAN26'. */
  id: string;
  /** Human label shown in the UI. */
  name: string;
  /** ISO date the list took effect. Stale lists get flagged. */
  effectiveDate?: string;
  entries: PriceListEntry[];
}

/**
 * The org's internal cost basis, which Xactimate never supplies — Xactimate
 * prices what the carrier pays, not what the work costs the contractor. Without
 * these numbers margin analysis is impossible, so they are org-owned settings.
 */
export interface CostBasis {
  /** Cost per unit, keyed by catalog code. Overrides `defaultUnitCost`. */
  overrides: Record<string, number>;
  /**
   * Multiplier applied to every default cost when no explicit override exists.
   * A crew with higher burden than the seeded assumptions sets this above 1.
   */
  costMultiplier: number;
}

export const DEFAULT_COST_BASIS: CostBasis = { overrides: {}, costMultiplier: 1 };

export interface ResolvedPrice {
  unitPrice: number;
  unitCost: number;
  unit: Unit;
  description: string;
  /** True only when this price came from the account's own price list. */
  verified: boolean;
}

/** Normalise a price-list unit string onto our `Unit` union. */
function normalizeUnit(raw: string, fallback: Unit): Unit {
  const key = raw.trim().toUpperCase().replace(/\./g, '');
  const known: Unit[] = ['SF', 'LF', 'SY', 'CF', 'EA', 'DA', 'HR', 'WK', 'CY'];
  if ((known as string[]).includes(key)) return key as Unit;
  if (key === 'DAY' || key === 'DAYS') return 'DA';
  if (key === 'HOUR' || key === 'HOURS' || key === 'HRS') return 'HR';
  if (key === 'EACH') return 'EA';
  return fallback;
}

/** Resolve the price and cost the estimate should use for one catalog item. */
export function resolvePrice(
  item: CatalogItem,
  priceList: PriceList | null,
  costBasis: CostBasis = DEFAULT_COST_BASIS,
): ResolvedPrice {
  const entry = priceList?.entries.find((row) => row.code === item.code);

  const unitCost =
    costBasis.overrides[item.code] ?? round(item.defaultUnitCost * costBasis.costMultiplier);

  if (!entry) {
    return {
      unitPrice: item.defaultUnitPrice,
      unitCost,
      unit: item.unit,
      description: item.description,
      verified: false,
    };
  }

  return {
    unitPrice: entry.unitPrice,
    unitCost,
    unit: normalizeUnit(entry.unit, item.unit),
    description: entry.description || item.description,
    verified: true,
  };
}

/* ------------------------------------------------------------------ *
 * Reconciliation
 * ------------------------------------------------------------------ */

export interface ReconcileResult {
  /** The catalog with real codes, descriptions, units and prices where matched. */
  catalog: CatalogItem[];
  matched: number;
  /** Seeded codes that had no counterpart in the price list. */
  unmatched: string[];
  /** Seeded codes whose real selector turned out to be different. */
  remapped: Array<{ from: string; to: string; description: string }>;
  warnings: string[];
}

/**
 * Reconcile the seeded catalog against a real price list.
 *
 * Matching runs in two passes. An exact code match is taken as authoritative.
 * Failing that, the entry's `searchTerms` are scored against price-list
 * descriptions and the best-scoring row wins, provided it clears a confidence
 * threshold — a weak match is worse than no match, because a wrong code on a
 * submitted estimate is a rejected estimate.
 */
export function reconcileCatalog(
  priceList: PriceList,
  seedCatalog: readonly CatalogItem[] = CATALOG,
): ReconcileResult {
  const warnings: string[] = [];
  const unmatched: string[] = [];
  const remapped: ReconcileResult['remapped'] = [];
  let matched = 0;

  const catalog = seedCatalog.map((item) => {
    const exact = priceList.entries.find((row) => row.code === item.code);
    if (exact) {
      matched += 1;
      return applyEntry(item, exact);
    }

    const fuzzy = bestDescriptionMatch(item, priceList.entries);
    if (fuzzy) {
      matched += 1;
      remapped.push({ from: item.code, to: fuzzy.entry.code, description: fuzzy.entry.description });
      return applyEntry(item, fuzzy.entry);
    }

    unmatched.push(item.code);
    return { ...item, verified: false };
  });

  if (unmatched.length > 0) {
    warnings.push(
      `${unmatched.length} of ${seedCatalog.length} catalog items had no match in price list ${priceList.id}. Lines using them are flagged as unverified and must be priced by hand.`,
    );
  }
  if (remapped.length > 0) {
    warnings.push(
      `${remapped.length} items matched by description rather than by code — review the remapping before the estimate is submitted.`,
    );
  }
  if (isStale(priceList.effectiveDate)) {
    warnings.push(
      `Price list ${priceList.id} is more than 90 days old. Pull the current list before submitting, or the carrier will re-price the estimate down.`,
    );
  }

  return { catalog, matched, unmatched, remapped, warnings };
}

function applyEntry(item: CatalogItem, entry: PriceListEntry): CatalogItem {
  return {
    ...item,
    // `key` is deliberately untouched — the mapping rules resolve through it, so
    // a renamed selector must not orphan every rule that produces this item.
    code: entry.code,
    description: entry.description || item.description,
    unit: normalizeUnit(entry.unit, item.unit),
    defaultUnitPrice: entry.unitPrice,
    verified: true,
  };
}

/** Minimum score before a description match is trusted. */
const MATCH_THRESHOLD = 0.6;

function bestDescriptionMatch(
  item: CatalogItem,
  entries: PriceListEntry[],
): { entry: PriceListEntry; score: number } | null {
  let best: { entry: PriceListEntry; score: number } | null = null;

  for (const entry of entries) {
    const haystack = `${entry.description} ${entry.code}`.toLowerCase();
    const hits = item.searchTerms.filter((term) => haystack.includes(term.toLowerCase())).length;
    if (hits === 0) continue;

    let score = hits / item.searchTerms.length;
    // A matching unit is strong corroboration; a clashing one is a red flag.
    if (normalizeUnit(entry.unit, item.unit) === item.unit) score += 0.15;
    else score -= 0.25;
    // Same Xactimate category is another point of agreement.
    if (entry.code.toUpperCase().startsWith(item.category)) score += 0.15;

    if (score >= MATCH_THRESHOLD && (!best || score > best.score)) best = { entry, score };
  }

  return best;
}

function isStale(effectiveDate: string | undefined): boolean {
  if (!effectiveDate) return false;
  const parsed = Date.parse(effectiveDate);
  if (Number.isNaN(parsed)) return false;
  return Date.now() - parsed > 90 * 86_400_000;
}
