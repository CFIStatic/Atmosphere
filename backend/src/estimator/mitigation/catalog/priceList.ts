import { round } from '../lib/geometry.js';
import { CATALOG, type CatalogItem } from './lineItems.js';
import { buildAccountCatalog, type CatalogRemaps } from './accountCatalog.js';
import { normalizeUnitString } from './units.js';
import type { Unit } from '../types.js';

/**
 * Price-list resolution and reconciliation.
 *
 * An estimate is only as good as the price list behind it. Xactimate price lists
 * are regional and refreshed monthly, and the codes themselves move between
 * versions — so the seeded knowledge in `lineItems.ts` is treated as a guess
 * until it has been checked against the price list on the user's own Xactimate
 * account.
 *
 * Prefer `buildAccountCatalog()` for new call sites. `reconcileCatalog` remains
 * as a thin compatibility wrapper used by older routes and the mock driver.
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

/** Resolve the price and cost the estimate should use for one catalog item. */
export function resolvePrice(
  item: CatalogItem,
  priceList: PriceList | null,
  costBasis: CostBasis = DEFAULT_COST_BASIS,
): ResolvedPrice {
  const entry = priceList?.entries.find(
    (row) => row.code.toUpperCase() === item.code.toUpperCase(),
  );

  const unitCost =
    costBasis.overrides[item.code] ??
    costBasis.overrides[item.key] ??
    round(item.defaultUnitCost * costBasis.costMultiplier);

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
    unit: normalizeUnitString(entry.unit, item.unit),
    description: entry.description || item.description,
    verified: true,
  };
}

/* ------------------------------------------------------------------ *
 * Reconciliation (compat wrapper around account catalog)
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
 * Reconcile knowledge profiles against a real price list.
 *
 * @deprecated Prefer `buildAccountCatalog` — same behaviour, richer remaps.
 */
export function reconcileCatalog(
  priceList: PriceList,
  seedCatalog: readonly CatalogItem[] = CATALOG,
  remaps: CatalogRemaps = {},
): ReconcileResult {
  const result = buildAccountCatalog(priceList, { knowledge: seedCatalog, remaps });
  return {
    catalog: result.catalog,
    matched: result.matched,
    unmatched: result.unmatched,
    remapped: result.remapped.map(({ from, to, description }) => ({ from, to, description })),
    warnings: result.warnings,
  };
}
