import type { PriceList, PriceListEntry } from './priceList.js';
import { normalizeUnitString } from './units.js';
import type { Unit } from '../types.js';

/**
 * Search the account's live Xactimate price list.
 *
 * The mitigation agent knows *what work* to bill; the account's price list is
 * the only authority for *which selector* and *what price*. This module is the
 * bridge — estimators (and the mapping layer) query the live list by code or
 * description and pick a real row instead of inventing one.
 */

export interface CodeSearchHit {
  code: string;
  description: string;
  unit: Unit;
  unitPrice: number;
  /** 0–1 relevance. Exact code match is 1. */
  score: number;
  match: 'exact_code' | 'prefix_code' | 'description' | 'token';
}

export interface CodeSearchOptions {
  /** Cap results. Default 25. */
  limit?: number;
  /** Prefer a specific unit when ranking. */
  preferUnit?: Unit;
  /** Prefer a category prefix (WTR, CLN, DMO, …). */
  preferCategory?: string;
  /** Drop hits below this score. Default 0.15. */
  minScore?: number;
}

/** Full-text / code search over a synced price list. */
export function searchPriceList(
  priceList: PriceList | null | undefined,
  query: string,
  options: CodeSearchOptions = {},
): CodeSearchHit[] {
  if (!priceList?.entries.length) return [];

  const raw = query.trim();
  if (!raw) return [];

  const limit = options.limit ?? 25;
  const minScore = options.minScore ?? 0.15;
  const needle = raw.toLowerCase();
  const tokens = needle.split(/[\s,/|_-]+/).filter((t) => t.length >= 2);
  const preferCategory = options.preferCategory?.toUpperCase();

  const hits: CodeSearchHit[] = [];

  for (const entry of priceList.entries) {
    const hit = scoreEntry(entry, needle, tokens, preferCategory, options.preferUnit);
    if (hit && hit.score >= minScore) hits.push(hit);
  }

  hits.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
  return hits.slice(0, limit);
}

/** Look up one code exactly (case-insensitive). */
export function findPriceListEntry(
  priceList: PriceList | null | undefined,
  code: string,
): PriceListEntry | undefined {
  if (!priceList || !code.trim()) return undefined;
  const target = code.trim().toUpperCase();
  return priceList.entries.find((row) => row.code.toUpperCase() === target);
}

function scoreEntry(
  entry: PriceListEntry,
  needle: string,
  tokens: string[],
  preferCategory: string | undefined,
  preferUnit: Unit | undefined,
): CodeSearchHit | null {
  const code = entry.code.toUpperCase();
  const desc = (entry.description ?? '').toLowerCase();
  const unit = normalizeUnitString(entry.unit, 'EA');

  let score = 0;
  let match: CodeSearchHit['match'] = 'token';

  if (code === needle.toUpperCase()) {
    score = 1;
    match = 'exact_code';
  } else if (code.startsWith(needle.toUpperCase()) && needle.length >= 3) {
    score = 0.85;
    match = 'prefix_code';
  } else if (desc.includes(needle) && needle.length >= 3) {
    score = 0.7;
    match = 'description';
  } else if (tokens.length > 0) {
    const haystack = `${desc} ${code.toLowerCase()}`;
    const hits = tokens.filter((t) => haystack.includes(t)).length;
    if (hits === 0) return null;
    score = (hits / tokens.length) * 0.65;
    match = 'token';
  } else {
    return null;
  }

  if (preferUnit && unit === preferUnit) score += 0.08;
  if (preferCategory && code.startsWith(preferCategory)) score += 0.1;

  return {
    code: entry.code,
    description: entry.description,
    unit,
    unitPrice: entry.unitPrice,
    score: Math.min(1, score),
    match,
  };
}
