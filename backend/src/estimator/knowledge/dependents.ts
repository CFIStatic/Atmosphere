import { CATALOG, codeFor, keyForCode, type CatalogKey } from '../pricing/catalog.js';
import { round2 } from '../scope/quantities.js';
import type { RoomMeasurements, ScopeItem, Unit } from '../types.js';

/**
 * Dependent-item expansion — the difference between a partial list and a
 * complete rebuild assembly.
 *
 * A flood-cut drywall line is not finished work. It implies primer, paint
 * (already often present), corner bead on outside corners, outlet/switch
 * detach-reset where wall board came off, masking, and dust control. Carpet
 * replacement without tack strip, pad, and binder bars is incomplete. An
 * estimator who ships only the substrate gets the estimate sent back.
 *
 * This module is the construction knowledge base for those companions. Rules
 * are declarative: when a parent key appears in a room, produce the children
 * unless they are already present. Expansion is idempotent and merges through
 * the same dedupe the scope builder uses.
 */

export interface DependentContext {
  room: RoomMeasurements | null;
  roomId: string;
  roomName: string;
  /** All items already in this room (parents + previously expanded). */
  roomItems: ScopeItem[];
  /** Parent item that triggered this dependent. */
  parent: ScopeItem;
  parentKey: CatalogKey;
}

interface ProducedDependent {
  key: CatalogKey;
  quantity: (ctx: DependentContext) => number;
  confidence?: number;
  needsReview?: boolean;
  rationale: (ctx: DependentContext) => string;
}

interface DependentRule {
  id: string;
  /** Fire when any of these keys are present in the room. */
  when: CatalogKey[];
  /** Skip if any of these are already present (optional gate). */
  unless?: CatalogKey[];
  /** Only expand once per room even if multiple parents match. */
  oncePerRoom?: boolean;
  produces: ProducedDependent[];
}

function parentQty(ctx: DependentContext): number {
  return ctx.parent.quantity;
}

function roomFloor(ctx: DependentContext): number {
  return ctx.room?.floorAreaSqFt ?? parentQty(ctx);
}

function roomPerimeter(ctx: DependentContext): number {
  return ctx.room?.perimeterLf ?? parentQty(ctx);
}

/** Rough outlet count: ~1 per 12 LF of perimeter on walls that were opened. */
function outletCount(ctx: DependentContext): number {
  const perimeter = roomPerimeter(ctx);
  return Math.max(1, Math.ceil(perimeter / 12));
}

/** Rough switch count: at least one per room with wall work, plus one per door. */
function switchCount(ctx: DependentContext): number {
  const doors = ctx.room?.openings.filter((o) => o.kind === 'door').length ?? 1;
  return Math.max(1, doors);
}

/** Outside-corner bead: half the openings that create corners, floored at 8 LF. */
function cornerBeadLength(ctx: DependentContext): number {
  const openings = ctx.room?.openings.length ?? 2;
  return round2(Math.max(8, openings * 8));
}

/** Transition strips at doorways between dissimilar floors. */
function doorwayTransitions(ctx: DependentContext): number {
  const doors =
    ctx.room?.openings.filter((o) => o.kind === 'door' || o.kind === 'cased_opening') ?? [];
  if (doors.length === 0) return 3; // one typical doorway width when scan lacks openings
  return round2(doors.reduce((sum, o) => sum + o.width, 0));
}

function hasKey(items: ScopeItem[], key: CatalogKey): boolean {
  const code = codeFor(key);
  return items.some((item) => item.code === code);
}

/**
 * Assembly rules. Ordered so that later rules can see earlier expansions when
 * the expander runs iteratively to a fixed point.
 */
export const DEPENDENT_RULES: DependentRule[] = [
  /* ---- Drywall assembly ------------------------------------------- */
  {
    id: 'drywall_primer',
    when: ['drywall_half', 'drywall_five_eighths'],
    oncePerRoom: true,
    produces: [
      {
        key: 'drywall_primer',
        quantity: (ctx) => {
          // Prime the new board; if paint is wall-to-wall, prime at least the
          // replaced area (paint still covers full walls separately).
          const drywall = ctx.roomItems
            .filter((item) =>
              [codeFor('drywall_half'), codeFor('drywall_five_eighths')].includes(item.code),
            )
            .reduce((sum, item) => sum + item.quantity, 0);
          return round2(Math.max(drywall, parentQty(ctx)));
        },
        rationale: () =>
          'New drywall must be primed before finish paint — skipping primer shows telegraphing joints.',
      },
    ],
  },
  {
    id: 'drywall_corner_bead',
    when: ['drywall_half', 'drywall_five_eighths'],
    oncePerRoom: true,
    produces: [
      {
        key: 'drywall_corner_bead',
        quantity: cornerBeadLength,
        confidence: 0.7,
        needsReview: true,
        rationale: () =>
          'Outside corners on replaced drywall need corner bead. Confirm lengths against the room.',
      },
    ],
  },
  {
    id: 'drywall_mask',
    when: ['drywall_half', 'drywall_five_eighths', 'paint_walls', 'paint_ceiling'],
    oncePerRoom: true,
    produces: [
      {
        key: 'mask_and_cover',
        quantity: (ctx) => round2(roomFloor(ctx) * 0.5),
        confidence: 0.8,
        rationale: () =>
          'Mask and cover adjacent finishes before sanding and painting so dust and overspray do not ruin them.',
      },
    ],
  },
  {
    id: 'drywall_electrical',
    when: ['drywall_half', 'drywall_five_eighths'],
    oncePerRoom: true,
    produces: [
      {
        key: 'outlet_reset',
        quantity: outletCount,
        confidence: 0.75,
        needsReview: true,
        rationale: () =>
          'Wall board removal forces outlets to be detached and reset. Count devices against the open walls.',
      },
      {
        key: 'switch_reset',
        quantity: switchCount,
        confidence: 0.75,
        needsReview: true,
        rationale: () =>
          'Switches in the opened walls must be detached and reset with the new board.',
      },
      {
        key: 'cover_plate',
        quantity: (ctx) => outletCount(ctx) + switchCount(ctx),
        confidence: 0.7,
        needsReview: true,
        rationale: () => 'Cover plates are replaced after device reset — originals rarely survive demo.',
      },
    ],
  },
  {
    id: 'drywall_hvac',
    when: ['drywall_half', 'drywall_five_eighths'],
    oncePerRoom: true,
    produces: [
      {
        key: 'register_reset',
        quantity: () => 1,
        confidence: 0.65,
        needsReview: true,
        rationale: () =>
          'Wall/ceiling openings typically include at least one HVAC register that must be reset. Confirm count.',
      },
    ],
  },
  {
    id: 'drywall_baseboard_if_missing',
    when: ['drywall_half', 'drywall_five_eighths'],
    unless: ['baseboard'],
    oncePerRoom: true,
    produces: [
      {
        key: 'baseboard',
        quantity: (ctx) => round2(Math.max(roomPerimeter(ctx) - doorwayTransitions(ctx), 0)),
        confidence: 0.75,
        needsReview: true,
        rationale: () =>
          'Wall drywall replacement removes the baseboard whether or not mitigation billed it separately.',
      },
      {
        key: 'paint_baseboard',
        quantity: (ctx) => round2(Math.max(roomPerimeter(ctx) - doorwayTransitions(ctx), 0)),
        confidence: 0.75,
        needsReview: true,
        rationale: () => 'New baseboard is painted.',
      },
    ],
  },

  /* ---- Carpet assembly -------------------------------------------- */
  {
    id: 'carpet_system',
    when: ['carpet'],
    oncePerRoom: true,
    produces: [
      {
        key: 'carpet_pad',
        quantity: parentQty,
        confidence: 0.85,
        rationale: () => 'Carpet is installed over pad — pad is part of the carpet system.',
      },
      {
        key: 'carpet_tack_strip',
        quantity: (ctx) => roomPerimeter(ctx),
        confidence: 0.85,
        rationale: () => 'Tack strip runs the perimeter of every carpeted room.',
      },
      {
        key: 'carpet_binder_bar',
        quantity: doorwayTransitions,
        confidence: 0.7,
        needsReview: true,
        rationale: () => 'Binder / transition bars at doorways where carpet meets another finish.',
      },
      {
        key: 'content_manipulation',
        quantity: roomFloor,
        confidence: 0.8,
        rationale: () => 'Contents must be moved to replace flooring.',
      },
    ],
  },

  /* ---- Hard flooring assembly ------------------------------------- */
  {
    id: 'hard_floor_system',
    when: ['luxury_vinyl_plank', 'engineered_wood', 'sheet_vinyl'],
    oncePerRoom: true,
    produces: [
      {
        key: 'floor_underlayment',
        quantity: parentQty,
        confidence: 0.8,
        rationale: () => 'Underlayment is required under floating / glued resilient floors.',
      },
      {
        key: 'floor_prep',
        quantity: parentQty,
        confidence: 0.75,
        needsReview: true,
        rationale: () => 'Substrate must be scraped, patched, and leveled before new flooring.',
      },
      {
        key: 'floor_transition',
        quantity: doorwayTransitions,
        confidence: 0.75,
        needsReview: true,
        rationale: () => 'Transition strips at doorways between rooms / finishes.',
      },
      {
        key: 'shoe_molding',
        quantity: (ctx) => round2(Math.max(roomPerimeter(ctx) - doorwayTransitions(ctx), 0)),
        confidence: 0.7,
        needsReview: true,
        rationale: () => 'Shoe molding covers the expansion gap at the baseboard after hard flooring.',
      },
      {
        key: 'content_manipulation',
        quantity: roomFloor,
        confidence: 0.8,
        rationale: () => 'Contents must be moved to replace flooring.',
      },
    ],
  },
  {
    id: 'tile_system',
    when: ['ceramic_tile'],
    oncePerRoom: true,
    produces: [
      {
        key: 'tile_thinset',
        quantity: parentQty,
        rationale: () => 'Thinset mortar is required to set ceramic / porcelain tile.',
      },
      {
        key: 'tile_grout',
        quantity: parentQty,
        rationale: () => 'Grout fills joints and must be sealed — never optional on a tile rebuild.',
      },
      {
        key: 'tile_membrane',
        quantity: parentQty,
        confidence: 0.7,
        needsReview: true,
        rationale: () =>
          'Crack-isolation / waterproofing membrane under tile — confirm wet-area requirements.',
      },
      {
        key: 'floor_prep',
        quantity: parentQty,
        confidence: 0.8,
        rationale: () => 'Tile requires a flat, sound substrate.',
      },
      {
        key: 'floor_transition',
        quantity: doorwayTransitions,
        confidence: 0.75,
        needsReview: true,
        rationale: () => 'Transition strips where tile meets adjacent flooring.',
      },
      {
        key: 'content_manipulation',
        quantity: roomFloor,
        confidence: 0.8,
        rationale: () => 'Contents must be moved to replace flooring.',
      },
    ],
  },
  {
    id: 'subfloor_vapor',
    when: ['subfloor'],
    oncePerRoom: true,
    produces: [
      {
        key: 'vapor_barrier',
        quantity: parentQty,
        confidence: 0.7,
        needsReview: true,
        rationale: () =>
          'Moisture barrier under replaced subfloor — especially after a water loss. Confirm assembly.',
      },
    ],
  },

  /* ---- Cabinetry / plumbing --------------------------------------- */
  {
    id: 'vanity_plumbing',
    when: ['vanity'],
    oncePerRoom: true,
    produces: [
      {
        key: 'sink_reset',
        quantity: () => 1,
        confidence: 0.85,
        rationale: () => 'Vanity replacement requires the sink to be detached and reset.',
      },
      {
        key: 'faucet_reset',
        quantity: () => 1,
        confidence: 0.8,
        rationale: () => 'Faucet must be detached and reset with the vanity / sink.',
      },
      {
        key: 'supply_line_replace',
        quantity: () => 2,
        confidence: 0.75,
        needsReview: true,
        rationale: () => 'Supply lines are typically replaced when a vanity is reset.',
      },
    ],
  },
  {
    id: 'cabinets_plumbing',
    when: ['cabinets_lower', 'countertop'],
    oncePerRoom: true,
    produces: [
      {
        key: 'sink_reset',
        quantity: () => 1,
        confidence: 0.7,
        needsReview: true,
        rationale: () =>
          'Lower cabinets / countertops usually involve a sink detach-reset. Confirm if this room has one.',
      },
      {
        key: 'backsplash',
        quantity: (ctx) => round2(parentQty(ctx) * 1.5),
        confidence: 0.65,
        needsReview: true,
        rationale: () => 'Countertop work commonly includes backsplash. Confirm material and height.',
      },
    ],
  },
  {
    id: 'toilet_with_flooring',
    when: ['carpet', 'luxury_vinyl_plank', 'engineered_wood', 'sheet_vinyl', 'ceramic_tile', 'subfloor'],
    unless: ['toilet_reset', 'toilet_replace'],
    oncePerRoom: true,
    produces: [
      {
        key: 'toilet_reset',
        quantity: (ctx) => {
          // Only auto-add in rooms that are actually bathrooms.
          const label = `${ctx.roomName} ${ctx.room?.roomType ?? ''}`;
          return /\b(bath|powder|toilet|water\s*closet)\b/i.test(label) ? 1 : 0;
        },
        confidence: 0.85,
        rationale: (ctx) =>
          `Flooring work in ${ctx.roomName} requires toilet detach/reset.`,
      },
    ],
  },

  /* ---- Cleaning companions ---------------------------------------- */
  {
    id: 'detail_and_hepa_clean',
    when: ['final_clean'],
    oncePerRoom: true,
    produces: [
      {
        key: 'hepa_vacuum',
        quantity: roomFloor,
        confidence: 0.85,
        rationale: () =>
          'HEPA vacuuming removes construction dust that a standard final clean leaves behind.',
      },
      {
        key: 'detail_clean',
        quantity: roomFloor,
        confidence: 0.8,
        rationale: () => 'Detail clean of fixtures, trim, and hardware after reconstruction.',
      },
    ],
  },

  /* ---- Debris companions ------------------------------------------ */
  {
    id: 'debris_disposal_fees',
    when: ['debris_haul'],
    oncePerRoom: true,
    produces: [
      {
        key: 'debris_disposal',
        quantity: parentQty,
        confidence: 0.85,
        rationale: () => 'Hauling debris includes disposal / landfill fees per load.',
      },
    ],
  },
];

function makeItem(
  ctx: DependentContext,
  produced: ProducedDependent,
): ScopeItem | null {
  const quantity = produced.quantity(ctx);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  const catalogItem = CATALOG[produced.key];
  const confidence = produced.confidence ?? Math.min(ctx.parent.confidence, 0.85);

  return {
    roomId: ctx.roomId,
    roomName: ctx.roomName,
    code: codeFor(produced.key),
    description: catalogItem.description,
    unit: catalogItem.unit as Unit,
    quantity: round2(quantity),
    rationale: produced.rationale(ctx),
    confidence,
    evidence: [...ctx.parent.evidence, `dependent:${produced.key}`],
    needsReview: produced.needsReview ?? confidence < 0.8,
  };
}

/**
 * Expand every assembly companion implied by the current scope.
 *
 * Runs to a fixed point (max 4 passes) so dependents-of-dependents — e.g.
 * drywall → baseboard → paint_baseboard already handled elsewhere, or
 * final_clean → hepa_vacuum — still land. Skips any key already present.
 */
export function expandDependents(
  items: ScopeItem[],
  rooms: RoomMeasurements[],
): { items: ScopeItem[]; added: number } {
  const roomsById = new Map(rooms.map((room) => [room.id, room]));
  let current = [...items];
  let added = 0;

  for (let pass = 0; pass < 4; pass++) {
    const byRoom = new Map<string, ScopeItem[]>();
    for (const item of current) {
      const bucket = byRoom.get(item.roomId);
      if (bucket) bucket.push(item);
      else byRoom.set(item.roomId, [item]);
    }

    const newcomers: ScopeItem[] = [];

    for (const [roomId, roomItems] of byRoom) {
      const room = roomsById.get(roomId) ?? null;
      const roomName = roomItems[0]!.roomName;
      const firedOnce = new Set<string>();

      for (const rule of DEPENDENT_RULES) {
        if (rule.oncePerRoom && firedOnce.has(rule.id)) continue;
        if (rule.unless?.some((key) => hasKey(roomItems, key) || hasKey(newcomers.filter((n) => n.roomId === roomId), key))) {
          continue;
        }

        const parent = roomItems.find((item) => {
          const key = keyForCode(item.code);
          return key !== undefined && rule.when.includes(key);
        });
        if (!parent) continue;

        const parentKey = keyForCode(parent.code);
        if (!parentKey) continue;

        firedOnce.add(rule.id);

        const ctx: DependentContext = {
          room,
          roomId,
          roomName,
          roomItems: [
            ...roomItems,
            ...newcomers.filter((n) => n.roomId === roomId),
          ],
          parent,
          parentKey,
        };

        for (const produced of rule.produces) {
          if (hasKey(ctx.roomItems, produced.key)) continue;
          const item = makeItem(ctx, produced);
          if (item) newcomers.push(item);
        }
      }
    }

    if (newcomers.length === 0) break;
    added += newcomers.length;
    current = [...current, ...newcomers];
  }

  return { items: current, added };
}
