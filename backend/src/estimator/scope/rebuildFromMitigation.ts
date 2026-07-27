import { CATALOG, codeFor, type CatalogKey } from '../pricing/catalog.js';
import { round2 } from './quantities.js';
import type { MitigationEstimate, MitigationLineItem, ScopeItem, Unit } from '../types.js';

/**
 * Deriving a rebuild scope from a mitigation estimate.
 *
 * This is the highest-signal path the estimator has. A mitigation estimate is a
 * written, already-approved record of what was physically removed from the
 * building — and in restoration the rebuild scope is, almost definitionally,
 * putting that back. Photos taken after mitigation show a gutted room; they
 * cannot tell you the room had carpet, because the carpet is in a dumpster. The
 * mitigation estimate can.
 *
 * Two failure modes matter, and both are handled explicitly:
 *
 *   • **Scoping the dryout.** Air movers, dehumidifiers, antimicrobial, and
 *     monitoring are mitigation work that leaves nothing to rebuild. Carrying
 *     them into a construction estimate is double-billing, so they are excluded
 *     by rule rather than by hoping no rule matches them.
 *   • **Missing the companions.** Replacing drywall means painting it; setting
 *     baseboard means painting that too. A rebuild that lists only the
 *     substrate reads as incomplete to an adjuster and gets sent back.
 */

/**
 * Lines that describe mitigation work itself. Anything matching these produces
 * no rebuild item — checked before the rebuild rules, so a rule that would
 * otherwise fire on a shared word ("remove", "clean") cannot smuggle one in.
 */
const MITIGATION_ONLY = [
  /\b(air\s*mover|dehumidifier|dehu|air\s*scrubber|negative\s*air|hepa|axial|turbo\s*dryer)\b/i,
  /\b(equipment|rental)\b.*\b(setup|monitor|per\s*day|daily)\b/i,
  /\b(monitoring|moisture\s*read|thermal\s*imaging|psychrometric)\b/i,
  /\b(antimicrobial|biocide|disinfect|sanitiz|deodoriz|ozone)\b/i,
  /\b(containment|poly\s*barrier|plastic\s*barrier|zipper|critical\s*barrier)\b/i,
  /\b(water\s*extraction|extract|standing\s*water|wand)\b/i,
  /\b(ppe|respirator|protective\s*(suit|equipment))\b/i,
  /\b(emergency\s*service|after\s*hours|labou?r\s*(charge|only)|technician|supervisor)\b/i,
  /\b(dryout|drying\s*(chamber|labor))\b/i,
];

/** A rebuild item produced from one mitigation line. */
interface Produced {
  key: CatalogKey;
  /** How the mitigation quantity converts to this item's quantity. */
  quantity: (line: NormalisedLine) => number;
  /** Lower confidence for inferences the mitigation line only implies. */
  confidence?: number;
}

interface RebuildRule {
  id: string;
  /** Matched against the removal's description. */
  description: RegExp;
  produces: Produced[];
  /** Excludes a rule that would otherwise also match, e.g. carpet vs carpet pad. */
  notDescription?: RegExp;
}

/**
 * A mitigation line with its quantity resolved into the unit the rebuild item
 * needs. Flood cuts are the reason this exists: mitigation crews often bill a
 * partial-height drywall removal in linear feet of wall, and a rebuild measured
 * in square feet has to know the cut height to convert it.
 */
interface NormalisedLine extends MitigationLineItem {
  /** SF equivalent, converting LF flood cuts via the parsed cut height. */
  areaSqFt: number;
  /** Cut height in feet when the description states one, else undefined. */
  cutHeightFt?: number;
}

/** "up to 2'", "2 ft", "4 foot", "flood cut 4'". */
function parseCutHeight(description: string): number | undefined {
  const match = /(\d+(?:\.\d+)?)\s*(?:'|ft\b|feet\b|foot\b)/i.exec(description);
  if (!match) return undefined;
  const height = Number(match[1]);
  // A "cut" above ceiling height is not a flood cut, it is a full wall.
  return Number.isFinite(height) && height > 0 && height <= 12 ? height : undefined;
}

/** Default flood-cut height when a linear-foot removal does not state one. */
const DEFAULT_FLOOD_CUT_FT = 2;

function normalise(line: MitigationLineItem): NormalisedLine {
  const cutHeightFt = parseCutHeight(line.description);

  // LF of wall removal is a band, not a length of nothing — convert it to the
  // area that actually has to be re-hung.
  const areaSqFt =
    line.unit === 'LF' ? line.quantity * (cutHeightFt ?? DEFAULT_FLOOD_CUT_FT) : line.quantity;

  return { ...line, areaSqFt: round2(areaSqFt), cutHeightFt };
}

/** Quantity helpers, named so the rule table reads as intent. */
const sameQuantity = (line: NormalisedLine) => round2(line.quantity);
const asArea = (line: NormalisedLine) => line.areaSqFt;

/**
 * Removal → replacement rules, in priority order. The first rule whose
 * description matches wins, so narrower rules (carpet pad) precede broader
 * ones (carpet).
 */
export const REBUILD_RULES: RebuildRule[] = [
  {
    id: 'carpet_pad',
    description: /\b(carpet\s*pad|pad(?:ding)?)\b/i,
    produces: [{ key: 'carpet_pad', quantity: sameQuantity }],
  },
  {
    id: 'carpet',
    description: /\bcarpet\b/i,
    notDescription: /\bpad(?:ding)?\b/i,
    produces: [
      { key: 'carpet', quantity: sameQuantity },
      // Pad is removed with the carpet whether or not it was billed separately.
      { key: 'carpet_pad', quantity: sameQuantity, confidence: 0.75 },
    ],
  },
  {
    // A ceiling removal only counts as one when the line says "ceiling" — an
    // unqualified drywall line falls through to the walls rule below, which is
    // the far more common case and the safer default.
    id: 'drywall_ceiling',
    description: /(?=.*\bceiling\b)(?=.*\b(drywall|sheetrock|gypsum|board)\b)/i,
    produces: [
      { key: 'drywall_half', quantity: asArea },
      { key: 'drywall_texture', quantity: asArea, confidence: 0.7 },
      { key: 'paint_ceiling', quantity: asArea },
    ],
  },
  {
    id: 'drywall_walls',
    description: /\b(drywall|sheetrock|gypsum)\b/i,
    produces: [
      { key: 'drywall_half', quantity: asArea },
      { key: 'drywall_tape', quantity: (line) => round2(line.unit === 'LF' ? line.quantity : 0) },
      { key: 'paint_walls', quantity: asArea },
    ],
  },
  {
    id: 'baseboard',
    description: /\b(baseboard|base\s*board|base\s*mould?ing|base\s*trim)\b/i,
    produces: [
      { key: 'baseboard', quantity: sameQuantity },
      { key: 'paint_baseboard', quantity: sameQuantity },
    ],
  },
  {
    id: 'casing',
    description: /\b(casing|door\s*trim|window\s*trim|cas(?:ed)?\s*opening)\b/i,
    produces: [
      { key: 'casing', quantity: sameQuantity },
      { key: 'paint_trim', quantity: sameQuantity },
    ],
  },
  {
    id: 'interior_door',
    description: /\b(interior\s*door|door\s*(unit|slab|jamb)|pre-?hung)\b/i,
    produces: [
      { key: 'interior_door', quantity: sameQuantity },
      { key: 'paint_door', quantity: sameQuantity },
    ],
  },
  {
    id: 'tile',
    description: /\b(ceramic|porcelain|tile)\b/i,
    produces: [{ key: 'ceramic_tile', quantity: sameQuantity }],
  },
  {
    id: 'lvp',
    description: /\b(lvp|lvt|luxury\s*vinyl|laminate|vinyl\s*plank)\b/i,
    produces: [{ key: 'luxury_vinyl_plank', quantity: sameQuantity }],
  },
  {
    id: 'sheet_vinyl',
    description: /\b(sheet\s*vinyl|linoleum|vinyl\s*floor)\b/i,
    produces: [{ key: 'sheet_vinyl', quantity: sameQuantity }],
  },
  {
    id: 'wood_floor',
    description: /\b(hardwood|engineered\s*wood|wood\s*floor)\b/i,
    produces: [{ key: 'engineered_wood', quantity: sameQuantity }],
  },
  {
    id: 'subfloor',
    description: /\b(subfloor|sub-?floor|underlayment)\b/i,
    produces: [{ key: 'subfloor', quantity: sameQuantity }],
  },
  {
    id: 'insulation',
    description: /\binsulation\b/i,
    produces: [{ key: 'insulation_batt', quantity: asArea }],
  },
  {
    id: 'countertop',
    description: /\bcounter\s*top|countertop\b/i,
    produces: [{ key: 'countertop', quantity: sameQuantity }],
  },
  {
    id: 'vanity',
    description: /\bvanity\b/i,
    produces: [{ key: 'vanity', quantity: sameQuantity }],
  },
  {
    id: 'cabinets_upper',
    description: /\b(upper|wall)\s*cabinet/i,
    produces: [{ key: 'cabinets_upper', quantity: sameQuantity }],
  },
  {
    id: 'cabinets_lower',
    description: /\bcabinet/i,
    produces: [{ key: 'cabinets_lower', quantity: sameQuantity }],
  },
  {
    id: 'toilet',
    description: /\btoilet|water\s*closet\b/i,
    produces: [{ key: 'toilet_reset', quantity: sameQuantity }],
  },
];

/**
 * Does this line describe something being taken out?
 *
 * A mitigation estimate also contains lines for work performed *on* a surface
 * that stays (clean, seal, treat). Only removals imply a rebuild.
 */
const REMOVAL_PATTERN =
  /\b(remove|removal|tear\s*out|demo(?:lition|lish)?|detach|cut\s*out|flood\s*cut|discard|dispose)\b/i;

/** Xactimate demolition and water-mitigation categories both denote removal. */
const REMOVAL_CODE_PATTERN = /^(DMO|WTR)\s/i;

export function isRemovalLine(line: MitigationLineItem): boolean {
  return REMOVAL_PATTERN.test(line.description) || REMOVAL_CODE_PATTERN.test(line.code);
}

export function isMitigationOnly(line: MitigationLineItem): boolean {
  const haystack = `${line.code} ${line.description}`;
  return MITIGATION_ONLY.some((pattern) => pattern.test(haystack));
}

function matchRule(line: NormalisedLine): RebuildRule | null {
  // Rules are ordered narrowest-first, so the first match is the right one.
  // Codes are not consulted here: selectors differ between price lists, while
  // the human-readable description is stable across every export we have seen.
  for (const rule of REBUILD_RULES) {
    if (rule.notDescription?.test(line.description)) continue;
    if (rule.description.test(line.description)) return rule;
  }
  return null;
}

function roomKey(name: string | undefined): { id: string; name: string } {
  const label = (name ?? '').trim() || 'Unassigned';
  return { id: `mitigation:${label.toLowerCase().replace(/\s+/g, '-')}`, name: label };
}

export interface RebuildDerivation {
  items: ScopeItem[];
  /** Lines deliberately not carried into the rebuild, with the reason. */
  skipped: { line: MitigationLineItem; reason: string }[];
}

/**
 * Turn a mitigation estimate into rebuild scope items.
 *
 * Returns the skipped lines alongside the items, because "why is that missing?"
 * is the first question an estimator asks of a generated scope, and answering
 * it in the UI is cheaper than answering it on the phone.
 */
export function deriveRebuildScope(mitigation: MitigationEstimate): RebuildDerivation {
  const items: ScopeItem[] = [];
  const skipped: RebuildDerivation['skipped'] = [];

  for (const rawLine of mitigation.lineItems) {
    if (isMitigationOnly(rawLine)) {
      skipped.push({ line: rawLine, reason: 'mitigation work — nothing to rebuild' });
      continue;
    }

    if (!isRemovalLine(rawLine)) {
      skipped.push({ line: rawLine, reason: 'not a removal — no replacement implied' });
      continue;
    }

    const line = normalise(rawLine);
    const rule = matchRule(line);
    if (!rule) {
      skipped.push({ line: rawLine, reason: 'no rebuild rule matches this removal' });
      continue;
    }

    const room = roomKey(line.roomName);

    for (const produced of rule.produces) {
      const quantity = produced.quantity(line);
      if (quantity <= 0) continue;

      const catalogItem = CATALOG[produced.key];
      const cutNote = line.cutHeightFt ? ` (${line.cutHeightFt}′ flood cut)` : '';

      items.push({
        roomId: room.id,
        roomName: room.name,
        code: codeFor(produced.key),
        description: catalogItem.description,
        unit: catalogItem.unit as Unit,
        quantity,
        rationale: `Mitigation removed "${line.description}" (${round2(line.quantity)} ${line.unit})${cutNote} — this puts it back.`,
        confidence: produced.confidence ?? 0.9,
        evidence: [`mitigation:${line.id}`],
        needsReview: (produced.confidence ?? 0.9) < 0.8,
      });
    }
  }

  return { items, skipped };
}
