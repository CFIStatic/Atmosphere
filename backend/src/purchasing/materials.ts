/**
 * What the work consumes.
 *
 * The estimator's catalog speaks in work — "tear out wet drywall, per SF".
 * A store speaks in things — sheets, sticks, rolls, bags. This file is the
 * bridge: for each work code, which materials the rebuild and the job-site
 * consumables actually require, and how much of the work one purchase unit
 * serves.
 *
 * Prices here are order-of-magnitude figures for the approval screen, the
 * same honesty contract as the estimator's seed catalog: every line built
 * from them is marked `price_basis = 'estimate'`, and nothing claims to be a
 * checkout price until a supplier has quoted it.
 *
 * Not every work line consumes material, and saying so explicitly is part of
 * the job — a takeoff that silently drops half the estimate looks broken to
 * the person comparing the two, so equipment and labour codes are classified
 * rather than skipped.
 */

export interface Material {
  key: string;
  description: string;
  /** The pack a person recognises in an aisle. */
  detail: string;
  /** 'sheet', 'roll', 'stick', 'bag', 'box', 'bucket', 'kit', 'tube', 'SF'. */
  orderUnit: string;
  /** Rough retail, for the approval screen only. */
  estUnitPrice: number;
  /** Shown beside the line — e.g. carpet is priced at the flooring desk. */
  note?: string;
}

/** One work code's demand on one material. */
export interface MaterialDemand {
  materialKey: string;
  /** Source units (SF, LF, DA…) one purchase unit serves. */
  coverage: number;
  /** Waste factor applied to the raw need before rounding up. */
  waste: number;
}

export const MATERIALS: Material[] = [
  {
    key: 'drywall_half',
    description: 'Drywall, 1/2 in',
    detail: '4 × 8 ft sheet (32 SF)',
    orderUnit: 'sheet',
    estUnitPrice: 16.5,
  },
  {
    key: 'drywall_ceiling',
    description: 'Ceiling drywall, 5/8 in',
    detail: '4 × 8 ft sheet (32 SF)',
    orderUnit: 'sheet',
    estUnitPrice: 21.0,
  },
  {
    key: 'joint_compound',
    description: 'Joint compound, all-purpose',
    detail: '4.5 gal bucket (~450 SF)',
    orderUnit: 'bucket',
    estUnitPrice: 18.5,
  },
  {
    key: 'drywall_tape',
    description: 'Drywall joint tape',
    detail: '500 ft roll (~400 SF)',
    orderUnit: 'roll',
    estUnitPrice: 9.0,
  },
  {
    key: 'drywall_screws',
    description: 'Drywall screws, 1-1/4 in',
    detail: '1 lb box (~250 SF)',
    orderUnit: 'box',
    estUnitPrice: 9.5,
  },
  {
    key: 'insulation_r13',
    description: 'Wall insulation, R-13 kraft-faced',
    detail: 'batt bag (~40 SF)',
    orderUnit: 'bag',
    estUnitPrice: 28.0,
  },
  {
    key: 'baseboard_mdf',
    description: 'Baseboard, primed MDF 3-1/4 in',
    detail: '8 ft length',
    orderUnit: 'stick',
    estUnitPrice: 11.0,
  },
  {
    key: 'paintable_caulk',
    description: 'Paintable latex caulk',
    detail: '10 oz tube (~100 LF)',
    orderUnit: 'tube',
    estUnitPrice: 4.0,
  },
  {
    key: 'carpet',
    description: 'Replacement carpet',
    detail: 'priced per SF, special order',
    orderUnit: 'SF',
    estUnitPrice: 2.75,
    note: 'Special order — confirm the product and the real price with the store flooring desk before placing.',
  },
  {
    key: 'carpet_pad',
    description: 'Carpet pad, 7/16 in',
    detail: '270 SF roll',
    orderUnit: 'roll',
    estUnitPrice: 135.0,
  },
  {
    key: 'flooring_lvp',
    description: 'Replacement flooring (LVP as placeholder)',
    detail: '~20 SF per carton',
    orderUnit: 'carton',
    estUnitPrice: 55.0,
    note: 'Finish flooring is a selection, not a commodity — confirm the product with the homeowner before ordering.',
  },
  {
    key: 'poly_6mil',
    description: 'Poly sheeting, 6 mil',
    detail: '10 × 100 ft roll (1000 SF)',
    orderUnit: 'roll',
    estUnitPrice: 95.0,
  },
  {
    key: 'zipper_door',
    description: 'Containment zipper door kit',
    detail: 'two heavy-duty zippers per kit',
    orderUnit: 'kit',
    estUnitPrice: 22.0,
  },
  {
    key: 'floor_film',
    description: 'Floor protection film, self-adhesive',
    detail: '24 in × 200 ft roll (400 SF)',
    orderUnit: 'roll',
    estUnitPrice: 47.0,
  },
  {
    key: 'contractor_bags',
    description: 'Contractor bags, 42 gal 3 mil',
    detail: '20-count box',
    orderUnit: 'box',
    estUnitPrice: 23.0,
  },
  {
    key: 'ppe_day_kit',
    description: 'PPE — suit, gloves, respirator cartridges',
    detail: 'per technician-day',
    orderUnit: 'kit',
    estUnitPrice: 24.0,
  },
];

export const MATERIAL_BY_KEY: ReadonlyMap<string, Material> = new Map(
  MATERIALS.map((m) => [m.key, m]),
);

/** Display order — the order materials are declared above, roughly build order. */
export const MATERIAL_ORDER: ReadonlyMap<string, number> = new Map(
  MATERIALS.map((m, i) => [m.key, i]),
);

/**
 * Demands by estimator catalog key.
 *
 * Keyed on the catalog's stable `key` (not `code`, which a price-list sync may
 * rewrite). Contractor bags appear under every tear-out code on purpose: the
 * demand is per square foot of debris, whichever trade produced it, and the
 * takeoff aggregates the raw need across codes before it rounds to boxes.
 */
export const DEMANDS_BY_CODE: Record<string, MaterialDemand[]> = {
  WTRDRYWL: [
    { materialKey: 'drywall_half', coverage: 32, waste: 0.1 },
    { materialKey: 'joint_compound', coverage: 450, waste: 0 },
    { materialKey: 'drywall_tape', coverage: 400, waste: 0 },
    { materialKey: 'drywall_screws', coverage: 250, waste: 0 },
    { materialKey: 'contractor_bags', coverage: 400, waste: 0 },
  ],
  WTRTCEIL: [
    { materialKey: 'drywall_ceiling', coverage: 32, waste: 0.1 },
    { materialKey: 'joint_compound', coverage: 450, waste: 0 },
    { materialKey: 'drywall_tape', coverage: 400, waste: 0 },
    { materialKey: 'drywall_screws', coverage: 250, waste: 0 },
    { materialKey: 'contractor_bags', coverage: 400, waste: 0 },
  ],
  WTRINS: [
    { materialKey: 'insulation_r13', coverage: 40, waste: 0.05 },
    { materialKey: 'contractor_bags', coverage: 400, waste: 0 },
  ],
  WTRBB: [
    { materialKey: 'baseboard_mdf', coverage: 8, waste: 0.1 },
    { materialKey: 'paintable_caulk', coverage: 100, waste: 0 },
  ],
  WTRTCP: [
    { materialKey: 'carpet', coverage: 1, waste: 0.1 },
    { materialKey: 'contractor_bags', coverage: 400, waste: 0 },
  ],
  WTRTCPP: [
    { materialKey: 'carpet_pad', coverage: 270, waste: 0.05 },
    { materialKey: 'contractor_bags', coverage: 400, waste: 0 },
  ],
  WTRTFLR: [
    { materialKey: 'flooring_lvp', coverage: 20, waste: 0.1 },
    { materialKey: 'contractor_bags', coverage: 400, waste: 0 },
  ],
  DMOCNTB: [
    { materialKey: 'poly_6mil', coverage: 1000, waste: 0.15 },
    { materialKey: 'zipper_door', coverage: 500, waste: 0 },
  ],
  CLNFLRPR: [{ materialKey: 'floor_film', coverage: 400, waste: 0.05 }],
  DMOPPE: [{ materialKey: 'ppe_day_kit', coverage: 1, waste: 0 }],
};

/**
 * Work that consumes nothing a store sells, and why. Listing the reason keeps
 * the takeoff explainable line by line: "no materials" is a claim, and the
 * person checking it against the estimate deserves to see the grounds.
 */
export const NO_MATERIALS_REASON: Record<string, string> = {
  WTRXTRC: 'extraction — equipment and labour',
  WTRXTRCHV: 'extraction — equipment and labour',
  WTRXTRHD: 'extraction — equipment and labour',
  WTRTOEK: 'detach and reset — the existing toe kick goes back on',
  WTRAMH: 'drying equipment, billed by the day',
  WTRAMHAX: 'drying equipment, billed by the day',
  WTRDHM: 'drying equipment, billed by the day',
  WTRDHMLGR: 'drying equipment, billed by the day',
  WTRDHMDES: 'drying equipment, billed by the day',
  WTRNAF: 'drying equipment, billed by the day',
  WTRINJD: 'drying equipment, billed by the day',
  WTRHEAT: 'drying equipment, billed by the day',
  WTRDRY: 'monitoring labour',
  WTRDRYAH: 'monitoring labour',
  WTREMER: 'emergency call-out labour',
  CLNAM: 'equipment, billed by the day',
  CLNHEPAV: 'equipment and labour',
  CLNCONT: 'labour',
  CLNDEOD: 'truck-stock chemical the crew already carries',
  DMODUMP: 'disposal — a dump run, not a store order',
  DMONEGP: 'equipment setup',
};
