import { CATALOG, type CatalogItem } from './lineItems.js';
import { findPriceListEntry } from './codeSearch.js';
import {
  type CostBasis,
  type PriceList,
  type PriceListEntry,
  DEFAULT_COST_BASIS,
} from './priceList.js';
import { normalizeUnitString } from './units.js';
import { round } from '../lib/geometry.js';

/**
 * Build the working catalog from the account's live Xactimate price list.
 *
 * ## Authority
 *
 * The seeded file (`lineItems.ts`) is **domain knowledge**, not an authority on
 * codes or prices. It knows that "LGR dehumidifier per day" is a distinct line
 * from a conventional dehumidifier, what evidence an adjuster will demand, and
 * roughly what the work costs the contractor. The *selector* and the *unit
 * price* come only from the account's price list — the one the carrier will
 * re-price against.
 *
 * ## What this function does
 *
 * For every knowledge profile, resolve the account's real code:
 *   1. Org remaps (human-approved) win.
 *   2. Exact code match on the price list.
 *   3. Fuzzy match on searchTerms vs description (with a confidence floor).
 *
 * Matched items carry `verified: true` and the account's code/price/unit.
 * Unmatched items stay in the catalog as knowledge with `verified: false` so
 * the mapping layer can still propose them — but the UI and push gate refuse to
 * treat them as submittable until a human picks a real account code.
 */

/** Org-approved knowledge-key → account-code bindings. */
export type CatalogRemaps = Record<string, string>;

export interface AccountCatalogResult {
  /** Working catalog used by mapping / pricing. */
  catalog: CatalogItem[];
  matched: number;
  unmatched: string[];
  remapped: Array<{ from: string; to: string; description: string; via: 'remap' | 'exact' | 'fuzzy' }>;
  warnings: string[];
  /** True when a live price list powered this catalog. */
  live: boolean;
}

export interface BuildAccountCatalogOptions {
  /** Human-approved remaps. Highest priority. */
  remaps?: CatalogRemaps;
  /** Knowledge profiles. Defaults to the seeded mitigation knowledge base. */
  knowledge?: readonly CatalogItem[];
  /** Minimum fuzzy score (0–1). Default 0.6. */
  matchThreshold?: number;
}

/**
 * Build the catalog the estimator will use for this run.
 *
 * When `priceList` is null, returns the knowledge profiles unchanged and a loud
 * warning — every price is a placeholder until the account list is connected.
 */
export function buildAccountCatalog(
  priceList: PriceList | null,
  options: BuildAccountCatalogOptions = {},
): AccountCatalogResult {
  const knowledge = options.knowledge ?? CATALOG;
  const remaps = options.remaps ?? {};
  const threshold = options.matchThreshold ?? 0.6;
  const warnings: string[] = [];
  const unmatched: string[] = [];
  const remapped: AccountCatalogResult['remapped'] = [];
  let matched = 0;

  if (!priceList) {
    warnings.push(
      'No Xactimate price list is connected. Codes and prices below are knowledge defaults — connect the account (or upload an exported price list) and pick real selectors before submitting.',
    );
    return {
      catalog: knowledge.map((item) => ({ ...item, verified: false })),
      matched: 0,
      unmatched: knowledge.map((item) => item.key),
      remapped: [],
      warnings,
      live: false,
    };
  }

  const catalog = knowledge.map((item) => {
    const resolved = resolveKnowledgeToEntry(item, priceList, remaps, threshold);
    if (!resolved) {
      unmatched.push(item.key);
      return { ...item, verified: false };
    }

    matched += 1;
    if (resolved.via !== 'exact' || resolved.entry.code !== item.code) {
      remapped.push({
        from: item.code,
        to: resolved.entry.code,
        description: resolved.entry.description,
        via: resolved.via,
      });
    }
    return applyAccountEntry(item, resolved.entry);
  });

  if (unmatched.length > 0) {
    warnings.push(
      `${unmatched.length} of ${knowledge.length} knowledge items have no match in price list ${priceList.id}. Pick an account code for each before pushing — or extend the remaps.`,
    );
  }
  if (remapped.some((r) => r.via === 'fuzzy')) {
    const fuzzyCount = remapped.filter((r) => r.via === 'fuzzy').length;
    warnings.push(
      `${fuzzyCount} item${fuzzyCount === 1 ? '' : 's'} matched by description. Review and lock remaps so the next build uses the approved account codes.`,
    );
  }
  if (isStale(priceList.effectiveDate)) {
    warnings.push(
      `Price list ${priceList.id} is more than 90 days old. Pull the current list before submitting, or the carrier will re-price the estimate down.`,
    );
  }

  return { catalog, matched, unmatched, remapped, warnings, live: true };
}

/**
 * Materialise a single CatalogItem from an explicit account code the user picked.
 * Used when an estimator overrides a line or maps an unmapped scope item.
 */
export function catalogItemFromAccountCode(
  code: string,
  priceList: PriceList,
  knowledge: CatalogItem | undefined,
  costBasis: CostBasis = DEFAULT_COST_BASIS,
): CatalogItem | null {
  const entry = findPriceListEntry(priceList, code);
  if (!entry) return null;

  const unit = normalizeUnitString(entry.unit, knowledge?.unit ?? 'EA');
  const inferredCategory = entry.code.replace(/[^A-Za-z].*$/, '').slice(0, 3).toUpperCase();
  const category = knowledge?.category ?? (inferredCategory || 'WTR');

  const unitCost =
    costBasis.overrides[entry.code] ??
    (knowledge
      ? round(knowledge.defaultUnitCost * costBasis.costMultiplier)
      : round(entry.unitPrice * 0.4 * costBasis.costMultiplier));

  return {
    key: knowledge?.key ?? entry.code,
    code: entry.code,
    category,
    description: entry.description || knowledge?.description || entry.code,
    unit,
    defaultUnitPrice: entry.unitPrice,
    defaultUnitCost: unitCost,
    tags: knowledge?.tags ?? [],
    searchTerms: knowledge?.searchTerms ?? [entry.description],
    requiresEvidence: knowledge?.requiresEvidence,
    evidenceTags: knowledge?.evidenceTags,
    verified: true,
    note: knowledge?.note,
  };
}

interface ResolvedEntry {
  entry: PriceListEntry;
  via: 'remap' | 'exact' | 'fuzzy';
}

function resolveKnowledgeToEntry(
  item: CatalogItem,
  priceList: PriceList,
  remaps: CatalogRemaps,
  threshold: number,
): ResolvedEntry | null {
  const remappedCode = remaps[item.key] ?? remaps[item.code];
  if (remappedCode) {
    const entry = findPriceListEntry(priceList, remappedCode);
    if (entry) return { entry, via: 'remap' };
  }

  const exact = findPriceListEntry(priceList, item.code);
  if (exact) return { entry: exact, via: 'exact' };

  const fuzzy = bestDescriptionMatch(item, priceList.entries, threshold);
  if (fuzzy) return { entry: fuzzy, via: 'fuzzy' };

  return null;
}

function applyAccountEntry(item: CatalogItem, entry: PriceListEntry): CatalogItem {
  return {
    ...item,
    // `key` stays — mapping rules address knowledge by key.
    code: entry.code,
    description: entry.description || item.description,
    unit: normalizeUnitString(entry.unit, item.unit),
    defaultUnitPrice: entry.unitPrice,
    verified: true,
  };
}

function bestDescriptionMatch(
  item: CatalogItem,
  entries: PriceListEntry[],
  threshold: number,
): PriceListEntry | null {
  let best: { entry: PriceListEntry; score: number } | null = null;

  for (const entry of entries) {
    const haystack = `${entry.description} ${entry.code}`.toLowerCase();
    const hits = item.searchTerms.filter((term) => haystack.includes(term.toLowerCase())).length;
    if (hits === 0) continue;

    let score = hits / item.searchTerms.length;
    if (normalizeUnitString(entry.unit, item.unit) === item.unit) score += 0.15;
    else score -= 0.25;
    if (entry.code.toUpperCase().startsWith(item.category)) score += 0.15;

    if (score >= threshold && (!best || score > best.score)) best = { entry, score };
  }

  return best?.entry ?? null;
}

function isStale(effectiveDate: string | undefined): boolean {
  if (!effectiveDate) return false;
  const parsed = Date.parse(effectiveDate);
  if (Number.isNaN(parsed)) return false;
  return Date.now() - parsed > 90 * 86_400_000;
}
