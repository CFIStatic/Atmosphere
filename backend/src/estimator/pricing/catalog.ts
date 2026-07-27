import type { CatalogItem } from '../types.js';

/**
 * The line-item catalog.
 *
 * Xactimate identifies work as a three-letter **category** plus a **selector**
 * — `DRY` + `1/2-` is half-inch drywall hung, taped, and floated. The scope
 * engine never writes those strings directly; it names a `CatalogKey` like
 * `drywall_half`, and this table turns that into a code, a unit, a trade, and a
 * waste allowance.
 *
 * That indirection is what makes the estimator survive contact with a real
 * price list. **Selectors vary between Xactimate versions, regions, and
 * carrier-specific price lists**, so the codes below follow the common
 * convention but must be validated against the organization's own list before
 * an estimate is submitted. When they differ, the fix is an override in this
 * table — the scope rules, the quantity maths, and the export never change.
 *
 * Waste factors follow ordinary trade practice: cut-and-fit materials carry an
 * allowance, measured-and-applied ones do not (you do not buy 10% extra paint
 * because the wall has corners).
 */

export const CATALOG_KEYS = [
  'drywall_half',
  'drywall_five_eighths',
  'drywall_tape',
  'drywall_texture',
  'paint_walls',
  'paint_ceiling',
  'paint_baseboard',
  'paint_trim',
  'paint_door',
  'baseboard',
  'casing',
  'interior_door',
  'carpet',
  'carpet_pad',
  'luxury_vinyl_plank',
  'engineered_wood',
  'hardwood_refinish',
  'ceramic_tile',
  'sheet_vinyl',
  'subfloor',
  'insulation_batt',
  'cabinets_lower',
  'cabinets_upper',
  'countertop',
  'vanity',
  'toilet_reset',
  'final_clean',
  'content_manipulation',
  'debris_haul',
] as const;

export type CatalogKey = (typeof CATALOG_KEYS)[number];

export const CATALOG: Record<CatalogKey, CatalogItem> = {
  drywall_half: {
    category: 'DRY',
    selector: '1/2-',
    description: '1/2" drywall — hung, taped, floated, ready for paint',
    unit: 'SF',
    wasteFactor: 0.1,
    trade: 'Drywall',
  },
  drywall_five_eighths: {
    category: 'DRY',
    selector: '5/8-',
    description: '5/8" drywall — hung, taped, floated, ready for paint',
    unit: 'SF',
    wasteFactor: 0.1,
    trade: 'Drywall',
  },
  drywall_tape: {
    category: 'DRY',
    selector: 'TAPE',
    description: 'Tape joint for new to existing drywall',
    unit: 'LF',
    trade: 'Drywall',
  },
  drywall_texture: {
    category: 'DRY',
    selector: 'TX',
    description: 'Texture drywall — light hand texture',
    unit: 'SF',
    trade: 'Drywall',
  },
  paint_walls: {
    category: 'PNT',
    selector: 'SWL',
    description: 'Seal then paint the walls — two coats',
    unit: 'SF',
    trade: 'Painting',
  },
  paint_ceiling: {
    category: 'PNT',
    selector: 'SCL',
    description: 'Seal then paint the ceiling — two coats',
    unit: 'SF',
    trade: 'Painting',
  },
  paint_baseboard: {
    category: 'PNT',
    selector: 'B',
    description: 'Paint baseboard — one coat',
    unit: 'LF',
    trade: 'Painting',
  },
  paint_trim: {
    category: 'PNT',
    selector: 'DRT',
    description: 'Paint door/window trim and jamb — two coats',
    unit: 'LF',
    trade: 'Painting',
  },
  paint_door: {
    category: 'PNT',
    selector: 'DR',
    description: 'Paint door slab — two coats, per side',
    unit: 'EA',
    trade: 'Painting',
  },
  baseboard: {
    category: 'FNC',
    selector: 'BB',
    description: 'Baseboard — installed',
    unit: 'LF',
    wasteFactor: 0.1,
    trade: 'Finish Carpentry',
  },
  casing: {
    category: 'FNC',
    selector: 'C',
    description: 'Casing — installed',
    unit: 'LF',
    wasteFactor: 0.1,
    trade: 'Finish Carpentry',
  },
  interior_door: {
    category: 'FNC',
    selector: 'DI',
    description: 'Interior door unit — pre-hung, installed',
    unit: 'EA',
    trade: 'Finish Carpentry',
  },
  carpet: {
    category: 'FCC',
    selector: 'CP+',
    description: 'Carpet — installed',
    unit: 'SF',
    wasteFactor: 0.1,
    trade: 'Flooring',
  },
  carpet_pad: {
    category: 'FCC',
    selector: 'PAD',
    description: 'Carpet pad — installed',
    unit: 'SF',
    wasteFactor: 0.05,
    trade: 'Flooring',
  },
  luxury_vinyl_plank: {
    category: 'FCV',
    selector: 'LVP',
    description: 'Luxury vinyl plank — installed',
    unit: 'SF',
    wasteFactor: 0.1,
    trade: 'Flooring',
  },
  engineered_wood: {
    category: 'FCW',
    selector: 'ENG',
    description: 'Engineered wood flooring — installed',
    unit: 'SF',
    wasteFactor: 0.1,
    trade: 'Flooring',
  },
  hardwood_refinish: {
    category: 'FCW',
    selector: 'R',
    description: 'Sand, stain, and finish hardwood floor',
    unit: 'SF',
    trade: 'Flooring',
  },
  ceramic_tile: {
    category: 'FCT',
    selector: 'CT',
    description: 'Ceramic tile — installed',
    unit: 'SF',
    wasteFactor: 0.12,
    trade: 'Flooring',
  },
  sheet_vinyl: {
    category: 'FCV',
    selector: 'S',
    description: 'Sheet vinyl flooring — installed',
    unit: 'SF',
    wasteFactor: 0.1,
    trade: 'Flooring',
  },
  subfloor: {
    category: 'FRM',
    selector: 'SUBF',
    description: 'Subfloor / underlayment — installed',
    unit: 'SF',
    wasteFactor: 0.1,
    trade: 'Framing',
  },
  insulation_batt: {
    category: 'INS',
    selector: 'BATT',
    description: 'Batt insulation — installed',
    unit: 'SF',
    wasteFactor: 0.05,
    trade: 'Insulation',
  },
  cabinets_lower: {
    category: 'CAB',
    selector: 'LX',
    description: 'Lower cabinet run — installed',
    unit: 'LF',
    trade: 'Cabinetry',
  },
  cabinets_upper: {
    category: 'CAB',
    selector: 'UX',
    description: 'Upper cabinet run — installed',
    unit: 'LF',
    trade: 'Cabinetry',
  },
  countertop: {
    category: 'CAB',
    selector: 'CTOP',
    description: 'Countertop — installed',
    unit: 'LF',
    trade: 'Cabinetry',
  },
  vanity: {
    category: 'CAB',
    selector: 'V',
    description: 'Vanity — installed',
    unit: 'LF',
    trade: 'Cabinetry',
  },
  toilet_reset: {
    category: 'PLM',
    selector: 'TR',
    description: 'Toilet — detach and reset',
    unit: 'EA',
    trade: 'Plumbing',
  },
  final_clean: {
    category: 'CLN',
    selector: 'FC',
    description: 'Final cleaning — construction',
    unit: 'SF',
    trade: 'Cleaning',
  },
  content_manipulation: {
    category: 'CON',
    selector: 'MC',
    description: 'Contents — move out and reset',
    unit: 'SF',
    trade: 'General',
  },
  debris_haul: {
    category: 'DMO',
    selector: 'DUMP',
    description: 'Haul debris — per pickup truck load',
    unit: 'EA',
    trade: 'General',
  },
};

/** `"DRY 1/2-"` — the form an estimator reads and Xactimate accepts. */
export function codeFor(key: CatalogKey): string {
  const item = CATALOG[key];
  return `${item.category} ${item.selector}`;
}

/** Quantity after the item's waste allowance, rounded to Xactimate precision. */
export function applyWaste(key: CatalogKey, quantity: number): number {
  const factor = CATALOG[key].wasteFactor ?? 0;
  return Math.round(quantity * (1 + factor) * 100) / 100;
}
