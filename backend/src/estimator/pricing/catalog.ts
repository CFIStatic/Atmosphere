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
  // Drywall assembly
  'drywall_half',
  'drywall_five_eighths',
  'drywall_tape',
  'drywall_texture',
  'drywall_corner_bead',
  'drywall_primer',
  // Painting
  'paint_walls',
  'paint_ceiling',
  'paint_baseboard',
  'paint_trim',
  'paint_door',
  'mask_and_cover',
  // Finish carpentry
  'baseboard',
  'casing',
  'interior_door',
  'shoe_molding',
  'quarter_round',
  // Flooring
  'carpet',
  'carpet_pad',
  'carpet_tack_strip',
  'carpet_binder_bar',
  'luxury_vinyl_plank',
  'engineered_wood',
  'hardwood_refinish',
  'ceramic_tile',
  'tile_thinset',
  'tile_grout',
  'tile_membrane',
  'sheet_vinyl',
  'floor_underlayment',
  'floor_prep',
  'floor_transition',
  'vinyl_cove_base',
  // Framing / substrate
  'subfloor',
  'vapor_barrier',
  // Insulation
  'insulation_batt',
  // Cabinetry
  'cabinets_lower',
  'cabinets_upper',
  'countertop',
  'vanity',
  'backsplash',
  // Plumbing
  'toilet_reset',
  'toilet_replace',
  'sink_reset',
  'faucet_reset',
  'supply_line_replace',
  // Electrical
  'outlet_reset',
  'switch_reset',
  'cover_plate',
  'gfci_outlet',
  'smoke_detector',
  'co_detector',
  // HVAC
  'register_reset',
  'register_replace',
  // Contents / protection
  'content_manipulation',
  'furniture_lift',
  'plastic_protection',
  'floor_protection',
  // Construction equipment (dust / particulate control during rebuild)
  'hepa_air_scrubber',
  'hepa_filter_change',
  'negative_air_machine',
  'containment_barrier',
  'zip_pole_door',
  // Cleaning / debris
  'final_clean',
  'detail_clean',
  'hepa_vacuum',
  'debris_haul',
  'dumpster_rental',
  'debris_disposal',
  // Permits / fees
  'building_permit',
  'inspection_fee',
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
  drywall_corner_bead: {
    category: 'DRY',
    selector: 'CB',
    description: 'Corner bead — installed and finished',
    unit: 'LF',
    wasteFactor: 0.05,
    trade: 'Drywall',
  },
  drywall_primer: {
    category: 'PNT',
    selector: 'P',
    description: 'Prime new drywall — PVA primer',
    unit: 'SF',
    trade: 'Painting',
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
  mask_and_cover: {
    category: 'PNT',
    selector: 'MSK',
    description: 'Mask and cover adjacent finishes for painting',
    unit: 'SF',
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
  shoe_molding: {
    category: 'FNC',
    selector: 'SM',
    description: 'Shoe molding — installed',
    unit: 'LF',
    wasteFactor: 0.1,
    trade: 'Finish Carpentry',
  },
  quarter_round: {
    category: 'FNC',
    selector: 'QR',
    description: 'Quarter round — installed',
    unit: 'LF',
    wasteFactor: 0.1,
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
  carpet_tack_strip: {
    category: 'FCC',
    selector: 'TS',
    description: 'Carpet tack strip — installed',
    unit: 'LF',
    wasteFactor: 0.05,
    trade: 'Flooring',
  },
  carpet_binder_bar: {
    category: 'FCC',
    selector: 'BBAR',
    description: 'Carpet binder / transition bar — installed',
    unit: 'LF',
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
  tile_thinset: {
    category: 'FCT',
    selector: 'TS',
    description: 'Thinset mortar for tile installation',
    unit: 'SF',
    trade: 'Flooring',
  },
  tile_grout: {
    category: 'FCT',
    selector: 'GR',
    description: 'Grout — installed and sealed',
    unit: 'SF',
    trade: 'Flooring',
  },
  tile_membrane: {
    category: 'FCT',
    selector: 'MEM',
    description: 'Waterproofing / crack-isolation membrane under tile',
    unit: 'SF',
    wasteFactor: 0.1,
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
  floor_underlayment: {
    category: 'FCV',
    selector: 'UL',
    description: 'Floor underlayment — installed',
    unit: 'SF',
    wasteFactor: 0.05,
    trade: 'Flooring',
  },
  floor_prep: {
    category: 'FCV',
    selector: 'PREP',
    description: 'Floor preparation — scrape, patch, and level',
    unit: 'SF',
    trade: 'Flooring',
  },
  floor_transition: {
    category: 'FCV',
    selector: 'TRN',
    description: 'Floor transition strip — installed',
    unit: 'LF',
    trade: 'Flooring',
  },
  vinyl_cove_base: {
    category: 'FCV',
    selector: 'CVB',
    description: 'Vinyl cove base — installed',
    unit: 'LF',
    wasteFactor: 0.05,
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
  vapor_barrier: {
    category: 'FRM',
    selector: 'VB',
    description: 'Vapor barrier / moisture barrier — installed',
    unit: 'SF',
    wasteFactor: 0.05,
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
  backsplash: {
    category: 'CAB',
    selector: 'BSP',
    description: 'Backsplash — installed',
    unit: 'SF',
    wasteFactor: 0.1,
    trade: 'Cabinetry',
  },
  toilet_reset: {
    category: 'PLM',
    selector: 'TR',
    description: 'Toilet — detach and reset',
    unit: 'EA',
    trade: 'Plumbing',
  },
  toilet_replace: {
    category: 'PLM',
    selector: 'T+',
    description: 'Toilet — replace complete',
    unit: 'EA',
    trade: 'Plumbing',
  },
  sink_reset: {
    category: 'PLM',
    selector: 'SR',
    description: 'Sink — detach and reset',
    unit: 'EA',
    trade: 'Plumbing',
  },
  faucet_reset: {
    category: 'PLM',
    selector: 'FR',
    description: 'Faucet — detach and reset',
    unit: 'EA',
    trade: 'Plumbing',
  },
  supply_line_replace: {
    category: 'PLM',
    selector: 'SL',
    description: 'Supply line — replace',
    unit: 'EA',
    trade: 'Plumbing',
  },
  outlet_reset: {
    category: 'ELE',
    selector: 'OR',
    description: 'Electrical outlet — detach and reset',
    unit: 'EA',
    trade: 'Electrical',
  },
  switch_reset: {
    category: 'ELE',
    selector: 'SR',
    description: 'Light switch — detach and reset',
    unit: 'EA',
    trade: 'Electrical',
  },
  cover_plate: {
    category: 'ELE',
    selector: 'CP',
    description: 'Device cover plate — replace',
    unit: 'EA',
    trade: 'Electrical',
  },
  gfci_outlet: {
    category: 'ELE',
    selector: 'GFCI',
    description: 'GFCI receptacle — install (code)',
    unit: 'EA',
    trade: 'Electrical',
  },
  smoke_detector: {
    category: 'ELE',
    selector: 'SD',
    description: 'Smoke detector — install / replace (code)',
    unit: 'EA',
    trade: 'Electrical',
  },
  co_detector: {
    category: 'ELE',
    selector: 'CO',
    description: 'Carbon monoxide detector — install (code)',
    unit: 'EA',
    trade: 'Electrical',
  },
  register_reset: {
    category: 'HVC',
    selector: 'RR',
    description: 'HVAC register / grille — detach and reset',
    unit: 'EA',
    trade: 'HVAC',
  },
  register_replace: {
    category: 'HVC',
    selector: 'R+',
    description: 'HVAC register / grille — replace',
    unit: 'EA',
    trade: 'HVAC',
  },
  content_manipulation: {
    category: 'CON',
    selector: 'MC',
    description: 'Contents — move out and reset',
    unit: 'SF',
    trade: 'General',
  },
  furniture_lift: {
    category: 'CON',
    selector: 'FL',
    description: 'Furniture — lift and protect during flooring',
    unit: 'EA',
    trade: 'General',
  },
  plastic_protection: {
    category: 'HMR',
    selector: 'PP',
    description: 'Plastic sheeting — protect adjacent surfaces',
    unit: 'SF',
    wasteFactor: 0.1,
    trade: 'Protection',
  },
  floor_protection: {
    category: 'HMR',
    selector: 'FP',
    description: 'Floor protection board / ram board',
    unit: 'SF',
    wasteFactor: 0.05,
    trade: 'Protection',
  },
  hepa_air_scrubber: {
    category: 'WTR',
    selector: 'AS',
    description: 'HEPA air scrubber — construction dust control (per day)',
    unit: 'DA',
    trade: 'Equipment',
  },
  hepa_filter_change: {
    category: 'WTR',
    selector: 'FIL',
    description: 'HEPA filter change for air scrubber',
    unit: 'EA',
    trade: 'Equipment',
  },
  negative_air_machine: {
    category: 'WTR',
    selector: 'NAM',
    description: 'Negative air machine — containment (per day)',
    unit: 'DA',
    trade: 'Equipment',
  },
  containment_barrier: {
    category: 'WTR',
    selector: 'CONT',
    description: 'Temporary containment barrier — plastic + framing',
    unit: 'LF',
    trade: 'Protection',
  },
  zip_pole_door: {
    category: 'WTR',
    selector: 'ZIP',
    description: 'Zippered containment door — installed',
    unit: 'EA',
    trade: 'Protection',
  },
  final_clean: {
    category: 'CLN',
    selector: 'FC',
    description: 'Final cleaning — construction',
    unit: 'SF',
    trade: 'Cleaning',
  },
  detail_clean: {
    category: 'CLN',
    selector: 'DC',
    description: 'Detail cleaning — fixtures, trim, and hardware',
    unit: 'SF',
    trade: 'Cleaning',
  },
  hepa_vacuum: {
    category: 'CLN',
    selector: 'HV',
    description: 'HEPA vacuuming — construction dust',
    unit: 'SF',
    trade: 'Cleaning',
  },
  debris_haul: {
    category: 'DMO',
    selector: 'DUMP',
    description: 'Haul debris — per pickup truck load',
    unit: 'EA',
    trade: 'General',
  },
  dumpster_rental: {
    category: 'DMO',
    selector: 'DMPR',
    description: 'Dumpster rental — construction debris',
    unit: 'EA',
    trade: 'General',
  },
  debris_disposal: {
    category: 'DMO',
    selector: 'DISP',
    description: 'Debris disposal / landfill fees',
    unit: 'EA',
    trade: 'General',
  },
  building_permit: {
    category: 'FEE',
    selector: 'PER',
    description: 'Building permit — reconstruction',
    unit: 'EA',
    trade: 'Permits',
  },
  inspection_fee: {
    category: 'FEE',
    selector: 'INSP',
    description: 'Inspection fee — municipal',
    unit: 'EA',
    trade: 'Permits',
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

/** Reverse lookup: `"DRY 1/2-"` → `drywall_half`. */
export function keyForCode(code: string): CatalogKey | undefined {
  return (CATALOG_KEYS as readonly CatalogKey[]).find((key) => codeFor(key) === code);
}
