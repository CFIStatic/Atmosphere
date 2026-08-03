import {
  DEMANDS_BY_CODE,
  MATERIAL_BY_KEY,
  MATERIAL_ORDER,
  NO_MATERIALS_REASON,
} from './materials.js';

/**
 * From work to a shopping list.
 *
 * The one rule that makes the arithmetic honest: aggregate first, round last.
 * Two rooms needing 100 SF and 60 SF of drywall need 160 SF — six sheets with
 * waste — not four sheets for one room plus three for the other. Rounding up
 * per room quietly over-orders on every multi-room job, which is exactly the
 * kind of error nobody ever traces back.
 *
 * Everything in the estimate lands in one of three buckets, and the three
 * together account for every line: materials to order, work that consumes no
 * materials (with the reason), and codes this table has never met. The last
 * bucket is a warning, not a silence — an unmapped code means a person checks,
 * it never means the material was ruled out.
 */

/** The slice of an estimate line the takeoff needs. */
export interface WorkLine {
  id: string;
  /** The estimator catalog's stable key. */
  catalogKey: string;
  description: string;
  roomName?: string;
  quantity: number;
  unit: string;
}

export interface MaterialLine {
  materialKey: string;
  description: string;
  detail: string;
  orderUnit: string;
  /** Whole purchase units, after aggregation, waste, and ceil. */
  quantity: number;
  estUnitPrice: number;
  estTotal: number;
  /** Why this many — the work lines it was computed from, in words. */
  sourceSummary: string;
  sourceLineIds: string[];
  note?: string;
}

export interface TakeoffResult {
  lines: MaterialLine[];
  /** Work that needs nothing from a store, with the grounds for saying so. */
  noMaterials: Array<{ catalogKey: string; description: string; reason: string }>;
  /** Codes the mapping table does not know. A person decides, not a default. */
  unmapped: Array<{ catalogKey: string; description: string; quantity: number; unit: string }>;
  /** Lines skipped because their quantity was zero. */
  zeroQuantity: number;
  estTotal: number;
}

interface Accumulated {
  raw: number;
  waste: number;
  lineIds: string[];
  /** quantity-by-source-description, for the summary. */
  sources: Map<string, { quantity: number; unit: string; rooms: Set<string> }>;
}

export function buildTakeoff(work: WorkLine[]): TakeoffResult {
  const acc = new Map<string, Accumulated>();
  const noMaterials = new Map<string, { catalogKey: string; description: string; reason: string }>();
  const unmapped = new Map<
    string,
    { catalogKey: string; description: string; quantity: number; unit: string }
  >();
  let zeroQuantity = 0;

  for (const line of work) {
    if (!(line.quantity > 0)) {
      zeroQuantity += 1;
      continue;
    }

    const demands = DEMANDS_BY_CODE[line.catalogKey];
    if (!demands) {
      const reason = NO_MATERIALS_REASON[line.catalogKey];
      if (reason) {
        noMaterials.set(line.catalogKey, {
          catalogKey: line.catalogKey,
          description: line.description,
          reason,
        });
      } else {
        const existing = unmapped.get(line.catalogKey);
        if (existing) {
          existing.quantity += line.quantity;
        } else {
          unmapped.set(line.catalogKey, {
            catalogKey: line.catalogKey,
            description: line.description,
            quantity: line.quantity,
            unit: line.unit,
          });
        }
      }
      continue;
    }

    for (const demand of demands) {
      let bucket = acc.get(demand.materialKey);
      if (!bucket) {
        bucket = { raw: 0, waste: demand.waste, lineIds: [], sources: new Map() };
        acc.set(demand.materialKey, bucket);
      }
      // Raw need is in source units divided by coverage — kept fractional
      // until every contributing line is in.
      bucket.raw += line.quantity / demand.coverage;
      // The largest waste factor any contributor asks for wins; mixing rates
      // within one material would make the rounding unexplainable.
      bucket.waste = Math.max(bucket.waste, demand.waste);
      bucket.lineIds.push(line.id);

      const source = bucket.sources.get(line.description) ?? {
        quantity: 0,
        unit: line.unit,
        rooms: new Set<string>(),
      };
      source.quantity += line.quantity;
      if (line.roomName) source.rooms.add(line.roomName);
      bucket.sources.set(line.description, source);
    }
  }

  const lines: MaterialLine[] = [];
  for (const [materialKey, bucket] of acc) {
    const material = MATERIAL_BY_KEY.get(materialKey);
    if (!material) continue; // A demand row naming a missing material is a bug; skip loudly-typed.

    const quantity = Math.ceil(bucket.raw * (1 + bucket.waste));
    if (quantity <= 0) continue;

    const summaryParts = [...bucket.sources.entries()].map(([description, s]) => {
      const rooms = s.rooms.size > 0 ? ` (${[...s.rooms].join(', ')})` : '';
      return `${trimQty(s.quantity)} ${s.unit} — ${description}${rooms}`;
    });

    lines.push({
      materialKey,
      description: material.description,
      detail: material.detail,
      orderUnit: material.orderUnit,
      quantity,
      estUnitPrice: material.estUnitPrice,
      estTotal: round2(quantity * material.estUnitPrice),
      sourceSummary: summaryParts.join('; '),
      sourceLineIds: [...new Set(bucket.lineIds)],
      note: material.note,
    });
  }

  lines.sort(
    (a, b) =>
      (MATERIAL_ORDER.get(a.materialKey) ?? Number.MAX_SAFE_INTEGER) -
      (MATERIAL_ORDER.get(b.materialKey) ?? Number.MAX_SAFE_INTEGER),
  );

  return {
    lines,
    noMaterials: [...noMaterials.values()],
    unmapped: [...unmapped.values()],
    zeroQuantity,
    estTotal: round2(lines.reduce((sum, l) => sum + l.estTotal, 0)),
  };
}

/** Pull the takeoff's input out of a stored mitigation estimate payload. */
export function workLinesOf(payload: unknown): WorkLine[] {
  const items = (payload as { lineItems?: unknown[] } | null)?.lineItems;
  if (!Array.isArray(items)) return [];
  const lines: WorkLine[] = [];
  for (const item of items) {
    const row = item as Record<string, unknown>;
    if (typeof row.catalogKey !== 'string' || typeof row.quantity !== 'number') continue;
    lines.push({
      id: typeof row.id === 'string' ? row.id : `${row.catalogKey}:${lines.length}`,
      catalogKey: row.catalogKey,
      description: typeof row.description === 'string' ? row.description : row.catalogKey,
      roomName: typeof row.roomName === 'string' ? row.roomName : undefined,
      quantity: row.quantity,
      unit: typeof row.unit === 'string' ? row.unit : '',
    });
  }
  return lines;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const trimQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
