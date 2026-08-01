/**
 * Derive an equipment / materials bill of work from a mitigation or
 * construction estimate — deterministic, no model.
 *
 * The estimate says what was scoped; this turns those line items into a plan
 * the PM can approve, then fulfill from inventory, rental, bid, or an
 * Atmosphere referral link (Home Depot / Lowe's / …).
 */

import type { ProposedPlanItem } from './types.js';

/** Minimal shape we accept from either estimator — avoid importing their trees. */
export interface EstimateEquipmentInput {
  source: 'mitigation_estimate' | 'construction_estimate';
  sourceRef?: string | null;
  /** Mitigation-style placements already on the assessment. */
  equipment?: Array<{
    kind: string;
    quantity?: number;
    days?: number;
    roomLabel?: string | null;
  }>;
  /** Xactimate / scope line items. */
  lineItems?: Array<{
    code?: string | null;
    description?: string | null;
    quantity?: number | null;
    unit?: string | null;
    category?: string | null;
  }>;
  /** Affected materials that imply tear-out / dumpster need. */
  materials?: Array<{
    material?: string | null;
    action?: string | null; // remove | dry_in_place | clean
    quantity?: number | null;
    unit?: string | null;
  }>;
  workType?: 'mitigation' | 'construction';
}

const EQUIPMENT_LABELS: Record<string, string> = {
  air_mover: 'Air mover',
  axial_air_mover: 'Axial air mover',
  dehumidifier_lgr: 'LGR dehumidifier',
  dehumidifier_conventional: 'Conventional dehumidifier',
  dehumidifier_desiccant: 'Desiccant dehumidifier',
  air_scrubber: 'Air scrubber',
  heater: 'Heater',
  hydroxyl: 'Hydroxyl generator',
  ozone: 'Ozone generator',
  generator: 'Generator',
};

/** Xactimate selectors that map cleanly onto physical gear. */
const CODE_TO_KIND: Record<string, { kind: string; label: string; fulfillment: ProposedPlanItem['fulfillment'] }> = {
  WTRAMH: { kind: 'air_mover', label: 'Air mover', fulfillment: 'inventory' },
  WTRDHM: { kind: 'dehumidifier', label: 'Dehumidifier', fulfillment: 'inventory' },
  WTRDHMLGR: { kind: 'dehumidifier_lgr', label: 'LGR dehumidifier', fulfillment: 'inventory' },
  WTRASB: { kind: 'air_scrubber', label: 'Air scrubber', fulfillment: 'inventory' },
};

const TEAR_OUT_ACTIONS = new Set(['remove', 'tear_out', 'dispose', 'demo', 'demolish']);

const DUMPSTER_MATERIAL_HINTS = [
  'drywall',
  'carpet',
  'pad',
  'insulation',
  'cabinet',
  'flooring',
  'debris',
  'content',
];

export interface DerivedEquipmentPlan {
  items: ProposedPlanItem[];
  dumpsterRequired: boolean;
  summary: string;
}

/**
 * Pure function: estimate facts → plan items.
 *
 * Dumpster need is inferred when tear-out materials or demo line items appear.
 * The PM still approves before any order is placed.
 */
export function deriveEquipmentPlan(input: EstimateEquipmentInput): DerivedEquipmentPlan {
  const byKey = new Map<string, ProposedPlanItem>();

  const add = (item: ProposedPlanItem) => {
    const key = `${item.itemKind}:${item.fulfillment}:${item.estimateCode ?? ''}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.quantity += item.quantity;
      return;
    }
    byKey.set(key, { ...item });
  };

  for (const eq of input.equipment ?? []) {
    const kind = eq.kind || 'other';
    add({
      itemKind: kind,
      label: EQUIPMENT_LABELS[kind] ?? kind.replace(/_/g, ' '),
      quantity: Math.max(1, Number(eq.quantity ?? 1)),
      unit: 'ea',
      fulfillment: 'inventory',
      notes: eq.roomLabel ? `For ${eq.roomLabel}` : eq.days ? `${eq.days} day(s) on estimate` : null,
      metadata: { days: eq.days ?? null },
    });
  }

  for (const line of input.lineItems ?? []) {
    const code = (line.code ?? '').toUpperCase();
    const mapped = CODE_TO_KIND[code];
    if (mapped) {
      add({
        itemKind: mapped.kind,
        label: mapped.label,
        quantity: Math.max(1, Number(line.quantity ?? 1)),
        unit: line.unit ?? 'ea',
        fulfillment: mapped.fulfillment,
        estimateCode: code,
        notes: line.description ?? null,
      });
      continue;
    }

    const desc = `${line.description ?? ''} ${line.category ?? ''}`.toLowerCase();
    if (/dumpster|roll[\s-]?off|debris\s*box/.test(desc)) {
      add({
        itemKind: 'dumpster',
        label: line.description?.trim() || 'Dumpster / roll-off',
        quantity: Math.max(1, Number(line.quantity ?? 1)),
        unit: line.unit ?? 'ea',
        fulfillment: 'bid',
        estimateCode: code || null,
        notes: 'Bid required — search local haulers',
      });
      continue;
    }

    // Construction materials that should go through a referral vendor.
    if (
      input.source === 'construction_estimate' &&
      /lumber|drywall|plywood|osb|paint|primer|screw|nail|insulation|underlayment|vinyl|tile/.test(desc)
    ) {
      add({
        itemKind: 'building_material',
        label: line.description?.trim() || code || 'Building material',
        quantity: Math.max(0.01, Number(line.quantity ?? 1)),
        unit: line.unit ?? 'ea',
        fulfillment: 'referral',
        estimateCode: code || null,
        notes: 'Order via Atmosphere referral link',
      });
    }
  }

  let dumpsterRequired = [...byKey.values()].some((i) => i.itemKind === 'dumpster');

  for (const mat of input.materials ?? []) {
    const action = String(mat.action ?? '').toLowerCase();
    const material = String(mat.material ?? '').toLowerCase();
    if (TEAR_OUT_ACTIONS.has(action) || DUMPSTER_MATERIAL_HINTS.some((h) => material.includes(h) && action.includes('remove'))) {
      dumpsterRequired = true;
    }
  }

  if (dumpsterRequired && ![...byKey.values()].some((i) => i.itemKind === 'dumpster')) {
    add({
      itemKind: 'dumpster',
      label: 'Dumpster / roll-off',
      quantity: 1,
      unit: 'ea',
      fulfillment: 'bid',
      notes: 'Inferred from tear-out scope — confirm size with the superintendent',
    });
  }

  const items = [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
  const parts = [
    `${items.length} item${items.length === 1 ? '' : 's'} from ${input.source.replace(/_/g, ' ')}`,
  ];
  if (dumpsterRequired) parts.push('dumpster required');
  const inventory = items.filter((i) => i.fulfillment === 'inventory').length;
  const referral = items.filter((i) => i.fulfillment === 'referral').length;
  const bid = items.filter((i) => i.fulfillment === 'bid').length;
  if (inventory) parts.push(`${inventory} from inventory`);
  if (referral) parts.push(`${referral} via referral`);
  if (bid) parts.push(`${bid} to bid`);

  return {
    items,
    dumpsterRequired,
    summary: parts.join(' · '),
  };
}
