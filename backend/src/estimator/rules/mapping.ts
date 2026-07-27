import { round, toSquareYards } from '../lib/geometry.js';
import { CATALOG, type CatalogItem } from '../catalog/lineItems.js';
import { resolvePrice, type CostBasis, type PriceList, DEFAULT_COST_BASIS } from '../catalog/priceList.js';
import type { AssessedRoom, EstimateLineItem, ScopeItem, Unit } from '../types.js';

/**
 * Scope → Xactimate line items.
 *
 * Picking the right selector is the part of this job that separates an estimate
 * that gets paid from one that comes back with half its lines struck. Three
 * things decide it:
 *
 * - **Specificity.** `WTRDHMLGR` (LGR dehumidifier) pays materially more than
 *   `WTRDHM` (conventional) and is the correct code when an LGR was on site.
 *   Reaching for the generic code because it is easier to remember is a
 *   straight-line margin loss, so the mapping always resolves to the most
 *   specific entry the evidence supports.
 * - **Unit agreement.** A quantity in SF billed against an item priced by the
 *   square yard is off by 9×. Conversions are explicit here and never implicit.
 * - **One line per code per room.** Xactimate expects consolidated lines;
 *   duplicates are a review flag even when the arithmetic is right.
 */

export interface MappingContext {
  rooms: AssessedRoom[];
  priceList: PriceList | null;
  costBasis?: CostBasis;
  /** A reconciled catalog when one is available; otherwise the seeded one. */
  catalog?: readonly CatalogItem[];
}

/**
 * Tag sets that resolve to a specific catalog entry, most specific first.
 *
 * The scope layer emits domain tags; this table is the only place that knows
 * which catalog entry those tags mean. Entries are addressed by their stable
 * `key`, never by `code` — a price-list sync rewrites `code` to whatever the
 * account calls the item, and a table keyed on the selector would silently stop
 * matching the moment a region renamed one.
 */
const MAPPINGS: Array<{ tags: string[]; code: string; when?: (item: ScopeItem) => boolean }> = [
  // Extraction — carpet and hard surface are different codes at different rates.
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

  const unmapped: ScopeItem[] = [];
  /** Consolidation key → accumulated line. */
  const lines = new Map<string, EstimateLineItem>();

  for (const item of scope) {
    const key = resolveCode(item);
    const catalogItem = key ? byKey.get(key) : undefined;

    if (!catalogItem) {
      unmapped.push(item);
      continue;
    }

    const price = resolvePrice(catalogItem, context.priceList, costBasis);
    const quantity = convertQuantity(item.quantity, item.unit, price.unit);

    if (quantity === null) {
      unmapped.push(item);
      continue;
    }

    const room = item.roomId ? roomsById.get(item.roomId) : undefined;
    const consolidationKey = `${catalogItem.key}::${item.roomId ?? '__job__'}`;
    const existing = lines.get(consolidationKey);

    if (existing) {
      // Same code, same room — consolidate rather than emit a duplicate line.
      existing.quantity = round(existing.quantity + quantity);
      existing.rcv = round(existing.quantity * existing.unitPrice);
      existing.totalCost = round(existing.quantity * existing.unitCost);
      existing.scopeItemIds.push(item.id);
      existing.evidenceIds = [...new Set([...existing.evidenceIds, ...item.evidenceIds])];
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
      standardRef: item.standardRef,
      evidenceIds: item.evidenceIds,
      priceVerified: price.verified,
    });
  }

  return { lineItems: [...lines.values()], unmapped };
}

/** First mapping whose tags are all present on the scope item. */
function resolveCode(item: ScopeItem): string | undefined {
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
