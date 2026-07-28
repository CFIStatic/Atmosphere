import { round, toSquareYards } from '../lib/geometry.js';
import { uniqueCitations } from '../standards/s500.js';
import { CATALOG, type CatalogItem } from '../catalog/lineItems.js';
import { catalogItemFromAccountCode } from '../catalog/accountCatalog.js';
import { findPriceListEntry, searchPriceList } from '../catalog/codeSearch.js';
import {
  resolvePrice,
  type CostBasis,
  type PriceList,
  DEFAULT_COST_BASIS,
} from '../catalog/priceList.js';
import type { AssessedRoom, EstimateLineItem, ScopeItem, Unit } from '../types.js';

/**
 * Scope → Xactimate line items.
 *
 * Picking the right selector is the part of this job that separates an estimate
 * that gets paid from one that comes back with half its lines struck. Authority
 * for *which code* is the account's price list — knowledge profiles (tags) only
 * propose a candidate, and a human override always wins.
 *
 * Resolution order per scope item:
 *   1. Explicit override (catalogKey or scope item id → account code)
 *   2. Tag → knowledge key → catalog entry (already reconciled to account codes)
 *   3. Live price-list search from the knowledge profile's searchTerms
 *
 * Unmapped items are never dropped — they surface as open questions so an
 * estimator can pick a real account code.
 */

export interface MappingContext {
  rooms: AssessedRoom[];
  priceList: PriceList | null;
  costBasis?: CostBasis;
  /** Account-reconciled catalog when one is available; otherwise knowledge defaults. */
  catalog?: readonly CatalogItem[];
  /**
   * Human-picked account codes, keyed by knowledge catalog key or scope item id.
   * These always beat automatic resolution.
   */
  codeOverrides?: Record<string, string>;
}

/**
 * Tag sets that resolve to a specific knowledge profile, most specific first.
 *
 * Entries are addressed by stable `key` (the knowledge id), never by the live
 * Xactimate selector — a price-list sync rewrites `code`, and a table keyed on
 * the selector would silently stop matching the moment a region renamed one.
 */
const MAPPINGS: Array<{ tags: string[]; code: string; when?: (item: ScopeItem) => boolean }> = [
  // Extraction — carpet and hard surface are different codes at different rates.
  { tags: ['extraction', 'carpet', 'heavy'], code: 'WTRXTRCHV' },
  { tags: ['extraction', 'carpet'], code: 'WTRXTRC' },
  { tags: ['extraction', 'hard_surface'], code: 'WTRXTRHD' },

  // Tear-out.
  { tags: ['tear_out', 'carpet_pad'], code: 'WTRTCPP' },
  { tags: ['tear_out', 'carpet'], code: 'WTRTCP' },
  { tags: ['tear_out', 'insulation'], code: 'WTRINS' },
  { tags: ['tear_out', 'baseboard'], code: 'WTRBB' },
  { tags: ['tear_out', 'ceiling'], code: 'WTRTCEIL' },
  { tags: ['tear_out', 'flood_cut'], code: 'WTRDRYWL' },
  { tags: ['tear_out', 'drywall'], code: 'WTRDRYWL' },
  { tags: ['tear_out', 'cabinetry'], code: 'WTRTOEK' },
  { tags: ['tear_out', 'hard_flooring'], code: 'WTRTFLR' },

  // Equipment — resolve to the specific machine that was actually on site.
  { tags: ['equipment', 'axial_air_mover'], code: 'WTRAMHAX' },
  { tags: ['equipment', 'air_mover'], code: 'WTRAMH' },
  { tags: ['equipment', 'dehumidifier_lgr'], code: 'WTRDHMLGR' },
  { tags: ['equipment', 'dehumidifier_desiccant'], code: 'WTRDHMDES' },
  { tags: ['equipment', 'dehumidifier_conventional'], code: 'WTRDHM' },
  { tags: ['equipment', 'air_scrubber'], code: 'WTRNAF' },
  { tags: ['equipment', 'injectidry'], code: 'WTRINJD' },
  { tags: ['equipment', 'heater'], code: 'WTRHEAT' },

  // Labour.
  { tags: ['labor', 'emergency'], code: 'WTREMER' },
  { tags: ['labor', 'after_hours'], code: 'WTRDRYAH' },
  { tags: ['labor', 'monitoring'], code: 'WTRDRY' },
  { tags: ['contents', 'labor'], code: 'CLNCONT' },

  // Cleaning and treatment.
  { tags: ['antimicrobial'], code: 'CLNAM' },
  { tags: ['hepa'], code: 'CLNHEPAV' },
  { tags: ['deodorization'], code: 'CLNDEOD' },
  { tags: ['protection'], code: 'CLNFLRPR' },

  // Containment and disposal.
  { tags: ['containment', 'negative_pressure'], code: 'DMONEGP' },
  { tags: ['containment'], code: 'DMOCNTB' },
  { tags: ['ppe'], code: 'DMOPPE' },
  { tags: ['debris'], code: 'DMODUMP' },
];

export interface MappingResult {
  lineItems: EstimateLineItem[];
  /** Scope items no catalog entry covered — surfaced, never dropped silently. */
  unmapped: ScopeItem[];
}

export function mapScopeToLineItems(scope: ScopeItem[], context: MappingContext): MappingResult {
  const catalog = context.catalog ?? CATALOG;
  const costBasis = context.costBasis ?? DEFAULT_COST_BASIS;
  const byKey = new Map(catalog.map((item) => [item.key, item]));
  const roomsById = new Map(context.rooms.map((room) => [room.id, room]));
  const overrides = context.codeOverrides ?? {};

  const unmapped: ScopeItem[] = [];
  /** Consolidation key → accumulated line. */
  const lines = new Map<string, EstimateLineItem>();

  for (const item of scope) {
    const catalogItem = resolveCatalogItem(item, byKey, catalog, context.priceList, costBasis, overrides);

    if (!catalogItem) {
      unmapped.push(item);
      continue;
    }

    const price = resolvePrice(catalogItem, context.priceList, costBasis);
    let quantity = convertQuantity(item.quantity, item.unit, price.unit);

    // A human-picked account code may not share the scope unit (e.g. they swapped
    // a day-rate machine for an each accessory). Prefer the pick over dropping
    // the line — the quantity stays as scoped and the adjuster sees the unit.
    if (quantity === null) {
      const wasOverridden = Boolean(
        overrides[item.id] ?? (catalogItem.key ? overrides[catalogItem.key] : undefined),
      );
      if (wasOverridden) {
        quantity = item.quantity;
      } else {
        unmapped.push(item);
        continue;
      }
    }

    const room = item.roomId ? roomsById.get(item.roomId) : undefined;
    const consolidationKey = `${catalogItem.key}::${item.roomId ?? '__job__'}`;
    const existing = lines.get(consolidationKey);

    if (existing) {
      existing.quantity = round(existing.quantity + quantity);
      existing.rcv = round(existing.quantity * existing.unitPrice);
      existing.totalCost = round(existing.quantity * existing.unitCost);
      existing.scopeItemIds.push(item.id);
      existing.evidenceIds = [...new Set([...existing.evidenceIds, ...item.evidenceIds])];
      existing.citations = uniqueCitations([...existing.citations, ...item.citations]);
      if (!existing.justification.includes(item.justification)) {
        existing.justification = `${existing.justification} ${item.justification}`;
      }
      continue;
    }

    lines.set(consolidationKey, {
      id: `line-${lines.size + 1}`,
      catalogKey: catalogItem.key,
      code: catalogItem.code,
      category: catalogItem.category,
      description: price.description,
      roomId: item.roomId,
      roomName: room?.name,
      quantity: round(quantity),
      unit: price.unit,
      unitPrice: price.unitPrice,
      rcv: round(quantity * price.unitPrice),
      unitCost: price.unitCost,
      totalCost: round(quantity * price.unitCost),
      scopeItemIds: [item.id],
      justification: item.justification,
      citations: item.citations,
      evidenceIds: item.evidenceIds,
      priceVerified: price.verified,
    });
  }

  return { lineItems: [...lines.values()], unmapped };
}

function resolveCatalogItem(
  item: ScopeItem,
  byKey: Map<string, CatalogItem>,
  catalog: readonly CatalogItem[],
  priceList: PriceList | null,
  costBasis: CostBasis,
  overrides: Record<string, string>,
): CatalogItem | undefined {
  const knowledgeKey = resolveKnowledgeKey(item);

  // 1. Explicit override — by scope item id or knowledge key.
  const overrideCode =
    overrides[item.id] ?? (knowledgeKey ? overrides[knowledgeKey] : undefined) ?? undefined;
  if (overrideCode && priceList) {
    const knowledge = knowledgeKey ? byKey.get(knowledgeKey) : undefined;
    const fromAccount = catalogItemFromAccountCode(overrideCode, priceList, knowledge, costBasis);
    if (fromAccount) return fromAccount;
  }

  // 2. Knowledge key → reconciled catalog entry.
  if (knowledgeKey) {
    const direct = byKey.get(knowledgeKey);
    if (direct) {
      // If the catalog entry is unverified but the price list has this code (or a
      // strong search hit), prefer the live row so we never bill a placeholder
      // when the account already has the selector.
      if (!direct.verified && priceList) {
        const live =
          findPriceListEntry(priceList, direct.code) ??
          searchPriceList(priceList, direct.searchTerms.join(' '), {
            preferUnit: direct.unit,
            preferCategory: direct.category,
            limit: 1,
            minScore: 0.55,
          })[0];
        if (live) {
          const fromAccount = catalogItemFromAccountCode(live.code, priceList, direct, costBasis);
          if (fromAccount) return fromAccount;
        }
      }
      return direct;
    }
  }

  // 3. Last-resort: search the live list from scope tags / description.
  if (priceList) {
    const query = [...item.tags, item.description].join(' ');
    const hit = searchPriceList(priceList, query, {
      preferUnit: item.unit,
      limit: 1,
      minScore: 0.7,
    })[0];
    if (hit) {
      const knowledge = knowledgeKey ? catalog.find((c) => c.key === knowledgeKey) : undefined;
      return catalogItemFromAccountCode(hit.code, priceList, knowledge, costBasis) ?? undefined;
    }
  }

  return undefined;
}

/** First mapping whose tags are all present on the scope item. */
function resolveKnowledgeKey(item: ScopeItem): string | undefined {
  for (const mapping of MAPPINGS) {
    if (!mapping.tags.every((tag) => item.tags.includes(tag))) continue;
    if (mapping.when && !mapping.when(item)) continue;
    return mapping.code;
  }
  return undefined;
}

/**
 * Convert between compatible units.
 *
 * Returns `null` for incompatible pairs rather than guessing — an SF quantity
 * silently billed against an hourly item would be a four-figure error that looks
 * plausible on the page. Better to surface it as unmapped.
 */
export function convertQuantity(quantity: number, from: Unit, to: Unit): number | null {
  if (from === to) return quantity;
  if (from === 'SF' && to === 'SY') return toSquareYards(quantity);
  if (from === 'SY' && to === 'SF') return round(quantity * 9);
  if (from === 'DA' && to === 'WK') return round(quantity / 7);
  if (from === 'WK' && to === 'DA') return round(quantity * 7);
  if (from === 'CF' && to === 'CY') return round(quantity / 27);
  if (from === 'CY' && to === 'CF') return round(quantity * 27);
  return null;
}

/** Exported for tests and the code-picker UI (shows which key a tag set resolves to). */
export function knowledgeKeyForTags(tags: string[]): string | undefined {
  for (const mapping of MAPPINGS) {
    if (!mapping.tags.every((tag) => tags.includes(tag))) continue;
    return mapping.code;
  }
  return undefined;
}
