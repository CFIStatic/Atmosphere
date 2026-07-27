import type { EvidenceKind, Unit } from '../types.js';

/**
 * The Xactimate line-item catalog.
 *
 * ## Read this before trusting a code
 *
 * Xactimate selectors and their prices are **not universal**. They vary by
 * Xactimate version, by price list (every region gets its own, refreshed
 * monthly), and by the carrier program a job falls under. A code that is right
 * in `FLMI8X_JAN26` may not exist in `TXHO_DEC25`.
 *
 * So this file is a **seed**, not an authority. Every entry ships with
 * `verified: false`, and the real codes and prices are pulled from the
 * connected Xactimate account by `reconcileCatalog()` in `priceList.ts`, which
 * matches on `searchTerms` against the account's actual price list. Until that
 * reconciliation runs, every line the estimator writes is flagged
 * `priceVerified: false` and the UI says so — an estimate is never presented as
 * ready to submit on the strength of these defaults.
 *
 * `defaultUnitPrice` figures are order-of-magnitude industry values for sanity
 * checks and demos. `defaultUnitCost` is the internal cost basis — what the work
 * actually costs the contractor to perform — and it is what makes margin
 * analysis possible at all. Both belong to the org and are overridable.
 */

export interface CatalogItem {
  /**
   * Stable internal identifier, fixed at seed time and never rewritten.
   *
   * `code` is what gets typed into Xactimate, and reconciliation replaces it
   * with whatever the account's price list actually calls this item. The mapping
   * rules therefore cannot reference `code` — after a sync it may be something
   * else entirely. They reference `key`, which never moves.
   */
  key: string;
  /** Xactimate selector as an estimator would type it, e.g. 'WTRDHM'. */
  code: string;
  /** Xactimate category prefix — WTR, DMO, CLN, FCC, DRY, PNT. */
  category: string;
  description: string;
  unit: Unit;
  /** Placeholder retail price. Replaced by the account's price list on sync. */
  defaultUnitPrice: number;
  /** Internal delivered cost per unit — labour + burden + consumables + equipment. */
  defaultUnitCost: number;
  /** Scope tags this item satisfies. The mapping layer looks items up by these. */
  tags: string[];
  /** Words used to re-match this item against a real price list on sync. */
  searchTerms: string[];
  /**
   * Documentation an adjuster will demand before paying this line. Items listed
   * here are gated: with no matching evidence the estimator flags rather than
   * bills. See `profitability.ts`.
   */
  requiresEvidence?: EvidenceKind[];
  /** Evidence tags that satisfy the gate, e.g. 'flood_cut' for a wall tear-out. */
  evidenceTags?: string[];
  /** True once reconciled against a real price list. Never true in this file. */
  verified: boolean;
  /** Notes for the estimator reviewing the line. */
  note?: string;
}

const seed = (item: Omit<CatalogItem, 'verified' | 'key'>): CatalogItem => ({
  ...item,
  key: item.code,
  verified: false,
});

/* ------------------------------------------------------------------ *
 * WTR — Water extraction & remediation
 * ------------------------------------------------------------------ */

const WATER: CatalogItem[] = [
  seed({
    code: 'WTRXTRC',
    category: 'WTR',
    description: 'Water extraction from carpeted floor — portable extractor',
    unit: 'SF',
    defaultUnitPrice: 0.62,
    defaultUnitCost: 0.24,
    tags: ['extraction', 'carpet'],
    searchTerms: ['water extraction', 'carpeted floor', 'extract'],
    requiresEvidence: ['photo'],
    evidenceTags: ['extraction', 'carpet', 'before'],
  }),
  seed({
    code: 'WTRXTRCHV',
    category: 'WTR',
    description: 'Water extraction from carpeted floor — heavy saturation',
    unit: 'SF',
    defaultUnitPrice: 0.93,
    defaultUnitCost: 0.35,
    tags: ['extraction', 'carpet', 'heavy'],
    searchTerms: ['water extraction', 'heavy', 'saturation'],
    requiresEvidence: ['photo', 'moisture_reading'],
    evidenceTags: ['extraction'],
    note: 'Only over standing water or a documented saturation reading.',
  }),
  seed({
    code: 'WTRXTRHD',
    category: 'WTR',
    description: 'Water extraction from hard surface floor',
    unit: 'SF',
    defaultUnitPrice: 0.48,
    defaultUnitCost: 0.18,
    tags: ['extraction', 'hard_surface'],
    searchTerms: ['water extraction', 'hard surface', 'non-carpeted'],
    requiresEvidence: ['photo'],
    evidenceTags: ['extraction', 'before'],
  }),
  seed({
    code: 'WTRTCP',
    category: 'WTR',
    description: 'Tear out wet carpet and bag for disposal',
    unit: 'SF',
    defaultUnitPrice: 0.58,
    defaultUnitCost: 0.22,
    tags: ['tear_out', 'carpet'],
    searchTerms: ['tear out', 'carpet', 'bag for disposal'],
    requiresEvidence: ['photo'],
    evidenceTags: ['carpet', 'before'],
  }),
  seed({
    code: 'WTRTCPP',
    category: 'WTR',
    description: 'Tear out wet carpet pad and bag for disposal',
    unit: 'SF',
    defaultUnitPrice: 0.42,
    defaultUnitCost: 0.16,
    tags: ['tear_out', 'carpet_pad'],
    searchTerms: ['tear out', 'carpet pad', 'padding', 'bag'],
    requiresEvidence: ['photo'],
    evidenceTags: ['carpet_pad', 'carpet'],
  }),
  seed({
    code: 'WTRDRYWL',
    category: 'WTR',
    description: 'Tear out wet drywall — flood cut, bag and dispose',
    unit: 'SF',
    defaultUnitPrice: 1.85,
    defaultUnitCost: 0.72,
    tags: ['tear_out', 'drywall', 'flood_cut'],
    searchTerms: ['tear out', 'drywall', 'flood cut', 'wet drywall'],
    requiresEvidence: ['photo'],
    evidenceTags: ['flood_cut', 'drywall'],
    note: 'Photograph the cut line with the moisture reading that justified it.',
  }),
  seed({
    code: 'WTRINS',
    category: 'WTR',
    description: 'Tear out wet insulation from wall cavity, bag and dispose',
    unit: 'SF',
    defaultUnitPrice: 0.68,
    defaultUnitCost: 0.26,
    tags: ['tear_out', 'insulation'],
    searchTerms: ['tear out', 'insulation', 'batt', 'wall cavity'],
    requiresEvidence: ['photo'],
    evidenceTags: ['insulation', 'flood_cut'],
  }),
  seed({
    code: 'WTRBB',
    category: 'WTR',
    description: 'Tear out wet baseboard and dispose',
    unit: 'LF',
    defaultUnitPrice: 1.12,
    defaultUnitCost: 0.44,
    tags: ['tear_out', 'baseboard'],
    searchTerms: ['tear out', 'baseboard', 'base trim'],
    requiresEvidence: ['photo'],
    evidenceTags: ['baseboard', 'flood_cut'],
  }),
  seed({
    code: 'WTRTCEIL',
    category: 'WTR',
    description: 'Tear out wet ceiling drywall, bag and dispose',
    unit: 'SF',
    defaultUnitPrice: 2.15,
    defaultUnitCost: 0.85,
    tags: ['tear_out', 'ceiling'],
    searchTerms: ['tear out', 'ceiling', 'drywall'],
    requiresEvidence: ['photo'],
    evidenceTags: ['ceiling'],
  }),
  seed({
    code: 'WTRTFLR',
    category: 'WTR',
    description: 'Tear out non-salvageable hard surface flooring and dispose',
    unit: 'SF',
    defaultUnitPrice: 2.35,
    defaultUnitCost: 0.95,
    tags: ['tear_out', 'hard_flooring'],
    searchTerms: ['tear out', 'floor covering', 'vinyl', 'laminate', 'tile'],
    requiresEvidence: ['photo'],
    evidenceTags: ['tile', 'hardwood', 'subfloor'],
  }),
  seed({
    code: 'WTRTOEK',
    category: 'WTR',
    description: 'Detach cabinet toe kick / remove cabinet base for drying',
    unit: 'LF',
    defaultUnitPrice: 3.40,
    defaultUnitCost: 1.35,
    tags: ['tear_out', 'cabinetry'],
    searchTerms: ['toe kick', 'cabinet', 'detach'],
    requiresEvidence: ['photo'],
    evidenceTags: ['cabinetry'],
  }),

  /* ---- Drying equipment (billed per 24-hour period) ---- */
  seed({
    code: 'WTRAMH',
    category: 'WTR',
    description: 'Air mover (per 24 hour period) — no monitoring',
    unit: 'DA',
    defaultUnitPrice: 26.5,
    defaultUnitCost: 4.2,
    tags: ['equipment', 'air_mover'],
    searchTerms: ['air mover', '24 hour period', 'no monitoring'],
    requiresEvidence: ['photo'],
    evidenceTags: ['air_mover'],
    note: 'Equipment days come from the MICA placement log; a partial day is a billed day.',
  }),
  seed({
    code: 'WTRAMHAX',
    category: 'WTR',
    description: 'Air mover, axial (per 24 hour period) — no monitoring',
    unit: 'DA',
    defaultUnitPrice: 32.0,
    defaultUnitCost: 5.1,
    tags: ['equipment', 'axial_air_mover'],
    searchTerms: ['axial', 'air mover', '24 hour'],
    requiresEvidence: ['photo'],
    evidenceTags: ['air_mover'],
  }),
  seed({
    code: 'WTRDHM',
    category: 'WTR',
    description: 'Dehumidifier (per 24 hour period) — large — no monitoring',
    unit: 'DA',
    defaultUnitPrice: 78.0,
    defaultUnitCost: 14.5,
    tags: ['equipment', 'dehumidifier_conventional'],
    searchTerms: ['dehumidifier', 'large', '24 hour', 'no monitoring'],
    requiresEvidence: ['photo'],
    evidenceTags: ['dehumidifier'],
  }),
  seed({
    code: 'WTRDHMLGR',
    category: 'WTR',
    description: 'Dehumidifier, LGR (per 24 hour period) — no monitoring',
    unit: 'DA',
    defaultUnitPrice: 98.0,
    defaultUnitCost: 18.0,
    tags: ['equipment', 'dehumidifier_lgr'],
    searchTerms: ['dehumidifier', 'LGR', 'low grain refrigerant', '24 hour'],
    requiresEvidence: ['photo'],
    evidenceTags: ['dehumidifier'],
  }),
  seed({
    code: 'WTRDHMDES',
    category: 'WTR',
    description: 'Dehumidifier, desiccant (per 24 hour period)',
    unit: 'DA',
    defaultUnitPrice: 235.0,
    defaultUnitCost: 92.0,
    tags: ['equipment', 'dehumidifier_desiccant'],
    searchTerms: ['desiccant', 'dehumidifier', '24 hour'],
    requiresEvidence: ['photo'],
    evidenceTags: ['dehumidifier'],
    note: 'Class 4 specialty drying. Justify with the low-evaporation material readings.',
  }),
  seed({
    code: 'WTRNAF',
    category: 'WTR',
    description: 'Negative air fan / air scrubber (per 24 hour period) — no monitoring',
    unit: 'DA',
    defaultUnitPrice: 88.0,
    defaultUnitCost: 16.0,
    tags: ['equipment', 'air_scrubber'],
    searchTerms: ['negative air', 'air scrubber', 'air filtration device', '24 hour'],
    requiresEvidence: ['photo'],
    evidenceTags: ['air_scrubber', 'containment'],
  }),
  seed({
    code: 'WTRINJD',
    category: 'WTR',
    description: 'Wall cavity drying system (per 24 hour period)',
    unit: 'DA',
    defaultUnitPrice: 105.0,
    defaultUnitCost: 22.0,
    tags: ['equipment', 'injectidry'],
    searchTerms: ['injectidry', 'wall cavity drying', 'interstitial'],
    requiresEvidence: ['photo', 'moisture_reading'],
    evidenceTags: ['flood_cut', 'moisture_reading'],
    note: 'The alternative to a flood cut. Cheaper for the carrier, better margin per day.',
  }),
  seed({
    code: 'WTRHEAT',
    category: 'WTR',
    description: 'Portable heater (per 24 hour period)',
    unit: 'DA',
    defaultUnitPrice: 62.0,
    defaultUnitCost: 12.0,
    tags: ['equipment', 'heater'],
    searchTerms: ['heater', 'heat drying', '24 hour'],
    requiresEvidence: ['photo'],
    evidenceTags: ['dehumidifier'],
  }),

  /* ---- Labour ---- */
  seed({
    code: 'WTRDRY',
    category: 'WTR',
    description: 'Equipment setup, take down, and monitoring (hourly)',
    unit: 'HR',
    defaultUnitPrice: 68.0,
    defaultUnitCost: 34.0,
    tags: ['labor', 'monitoring'],
    searchTerms: ['equipment setup', 'take down', 'monitoring', 'hourly'],
    note: 'Routinely under-billed. One monitoring visit is not one hour once travel, readings and documentation are counted.',
  }),
  seed({
    code: 'WTRDRYAH',
    category: 'WTR',
    description: 'Equipment setup, take down, and monitoring — after hours (hourly)',
    unit: 'HR',
    defaultUnitPrice: 96.0,
    defaultUnitCost: 51.0,
    tags: ['labor', 'monitoring', 'after_hours'],
    searchTerms: ['after hours', 'monitoring', 'emergency', 'hourly'],
    requiresEvidence: ['note'],
    evidenceTags: ['after_hours'],
  }),
  seed({
    code: 'WTREMER',
    category: 'WTR',
    description: 'Emergency service call — after hours',
    unit: 'EA',
    defaultUnitPrice: 195.0,
    defaultUnitCost: 78.0,
    tags: ['labor', 'emergency'],
    searchTerms: ['emergency service call', 'after hours', 'trip charge'],
    requiresEvidence: ['note'],
    evidenceTags: ['after_hours'],
  }),
];

/* ------------------------------------------------------------------ *
 * CLN — Cleaning
 * ------------------------------------------------------------------ */

const CLEANING: CatalogItem[] = [
  seed({
    code: 'CLNAM',
    category: 'CLN',
    description: 'Apply anti-microbial agent to affected surfaces',
    unit: 'SF',
    defaultUnitPrice: 0.34,
    defaultUnitCost: 0.11,
    tags: ['antimicrobial'],
    searchTerms: ['anti-microbial', 'antimicrobial', 'biocide', 'apply'],
    requiresEvidence: ['photo'],
    evidenceTags: ['antimicrobial', 'category_2', 'category_3', 'microbial'],
    note: 'Required on Category 2 and 3 losses. Commonly omitted, and it covers every affected surface, not just the floor.',
  }),
  seed({
    code: 'CLNHEPAV',
    category: 'CLN',
    description: 'HEPA vacuuming — detailed, after demolition',
    unit: 'SF',
    defaultUnitPrice: 0.42,
    defaultUnitCost: 0.16,
    tags: ['hepa', 'post_demolition'],
    searchTerms: ['HEPA', 'vacuum', 'detailed clean'],
    requiresEvidence: ['photo'],
    evidenceTags: ['hepa', 'after'],
  }),
  seed({
    code: 'CLNCONT',
    category: 'CLN',
    description: 'Content manipulation — move and reset contents (hourly)',
    unit: 'HR',
    defaultUnitPrice: 46.0,
    defaultUnitCost: 23.0,
    tags: ['contents', 'labor'],
    searchTerms: ['content manipulation', 'move contents', 'reset'],
    requiresEvidence: ['photo'],
    evidenceTags: ['contents', 'before'],
    note: 'Almost every mitigation job performs this and a large share never bill it.',
  }),
  seed({
    code: 'CLNFLRPR',
    category: 'CLN',
    description: 'Floor protection — self-adhesive plastic film',
    unit: 'SF',
    defaultUnitPrice: 0.52,
    defaultUnitCost: 0.21,
    tags: ['protection'],
    searchTerms: ['floor protection', 'plastic film', 'ram board'],
    requiresEvidence: ['photo'],
    evidenceTags: ['containment', 'before'],
  }),
  seed({
    code: 'CLNDEOD',
    category: 'CLN',
    description: 'Deodorization — apply odour counteractant',
    unit: 'SF',
    defaultUnitPrice: 0.28,
    defaultUnitCost: 0.09,
    tags: ['deodorization'],
    searchTerms: ['deodorization', 'odor', 'counteractant'],
    requiresEvidence: ['note', 'photo'],
    evidenceTags: ['category_3', 'microbial'],
  }),
];

/* ------------------------------------------------------------------ *
 * DMO — Containment, debris, PPE
 * ------------------------------------------------------------------ */

const DEMOLITION: CatalogItem[] = [
  seed({
    code: 'DMOCNTB',
    category: 'DMO',
    description: 'Containment barrier / zipper wall — 6 mil poly, temporary',
    unit: 'SF',
    defaultUnitPrice: 1.28,
    defaultUnitCost: 0.44,
    tags: ['containment'],
    searchTerms: ['containment barrier', 'zipper', 'poly', 'temporary wall'],
    requiresEvidence: ['photo'],
    evidenceTags: ['containment'],
  }),
  seed({
    code: 'DMODUMP',
    category: 'DMO',
    description: 'Haul debris — per pickup truck load, including dump fees',
    unit: 'EA',
    defaultUnitPrice: 168.0,
    defaultUnitCost: 82.0,
    tags: ['debris'],
    searchTerms: ['haul debris', 'dump fee', 'pickup truck load'],
    requiresEvidence: ['photo'],
    evidenceTags: ['after'],
  }),
  seed({
    code: 'DMOPPE',
    category: 'DMO',
    description: 'Personal protective equipment — per technician per day',
    unit: 'DA',
    defaultUnitPrice: 28.0,
    defaultUnitCost: 11.5,
    tags: ['ppe'],
    searchTerms: ['personal protective equipment', 'PPE', 'respirator', 'suit'],
    requiresEvidence: ['photo'],
    evidenceTags: ['category_3', 'microbial'],
    note: 'Category 3 and microbial work only. Billed per technician, per day on site.',
  }),
  seed({
    code: 'DMONEGP',
    category: 'DMO',
    description: 'Negative pressure setup and monitoring',
    unit: 'EA',
    defaultUnitPrice: 145.0,
    defaultUnitCost: 62.0,
    tags: ['containment', 'negative_pressure'],
    searchTerms: ['negative pressure', 'setup', 'monitoring'],
    requiresEvidence: ['photo'],
    evidenceTags: ['containment', 'air_scrubber'],
  }),
];

/* ------------------------------------------------------------------ *
 * Full catalog
 * ------------------------------------------------------------------ */

export const CATALOG: readonly CatalogItem[] = Object.freeze([
  ...WATER,
  ...CLEANING,
  ...DEMOLITION,
]);

const BY_KEY = new Map(CATALOG.map((item) => [item.key, item]));

/** Look an item up by its stable key — the only safe lookup after a price sync. */
export function findByKey(key: string): CatalogItem | undefined {
  return BY_KEY.get(key);
}

/** Every catalog entry carrying all of the given tags. */
export function findByTags(...tags: string[]): CatalogItem[] {
  return CATALOG.filter((item) => tags.every((tag) => item.tags.includes(tag)));
}

/** The single best entry for a tag set — the first match, catalog order. */
export function bestMatch(...tags: string[]): CatalogItem | undefined {
  return findByTags(...tags)[0];
}
