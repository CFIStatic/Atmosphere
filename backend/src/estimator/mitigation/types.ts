import type { CitationId, StandardReference } from './standards/s500.js';
import type { ComplianceReport } from './standards/compliance.js';
import type { SlaComplianceReport } from './carrier/types.js';
import type { DamageFinding } from './ingest/findings.js';
import type { MitigationRequirement } from './requirements/obligations.js';
import type { EquipmentPlan } from './planning/equipmentPlan.js';
import type { DryingProgress } from './planning/dryingProgress.js';

/**
 * Canonical domain model for the Mitigation Estimator.
 *
 * Every input the agent accepts — a DocuSketch scan, a MICA report, a folder of
 * iPhone photos, a technician's notes — is normalised into the types below
 * before any estimating happens. Downstream rules therefore never learn the
 * shape of a vendor export: adding a new source means writing one adapter, not
 * touching the scope, pricing, or Xactimate layers.
 *
 * Terminology follows ANSI/IICRC S500 (Standard for Professional Water Damage
 * Restoration), because that is the language an adjuster reviews the estimate in.
 */

/* ------------------------------------------------------------------ *
 * Loss classification
 * ------------------------------------------------------------------ */

/**
 * S500 water categories, by the degree of contamination at the source.
 *   1 — clean water (supply line, rainwater)
 *   2 — significantly contaminated / "grey" (dishwasher, washing machine)
 *   3 — grossly contaminated / "black" (sewage, ground surface water)
 *
 * Categories only ever get worse with time, never better. See `degradeCategory`.
 */
export type WaterCategory = 1 | 2 | 3;

/**
 * S500 classes of water intrusion, by evaporation load — how much water the
 * affected materials hold and how hard it will be to get out.
 *   1 — least amount of water; <5% of the room's combined surface area wet
 *   2 — 5–40% of the combined surface area wet
 *   3 — >40%; water generally came from overhead
 *   4 — deeply held moisture in low-evaporation materials (hardwood, plaster,
 *       concrete, masonry) needing specialty low-humidity drying
 */
export type WaterClass = 1 | 2 | 3 | 4;

/** Where the water came from. Drives category and some scope decisions. */
export type LossCause =
  | 'supply_line'
  | 'water_heater'
  | 'appliance'
  | 'toilet_overflow'
  | 'sewage_backup'
  | 'roof_leak'
  | 'storm_flood'
  | 'sprinkler'
  | 'hvac_condensate'
  | 'unknown';

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

/** Units as Xactimate writes them. */
export type Unit =
  | 'SF' // square feet
  | 'LF' // linear feet
  | 'SY' // square yards
  | 'CF' // cubic feet
  | 'EA' // each
  | 'DA' // day
  | 'HR' // hour
  | 'WK' // week
  | 'CY'; // cubic yards

/**
 * A room's measured geometry. `floorSF`, `wallSF`, `ceilingSF` and `perimeterLF`
 * are the four numbers nearly every mitigation line item is priced against, so
 * adapters must always populate them — deriving from L×W×H when the source only
 * gives dimensions (see `deriveGeometry`).
 */
export interface RoomGeometry {
  lengthFt: number;
  widthFt: number;
  heightFt: number;
  floorSF: number;
  ceilingSF: number;
  /** Gross wall area, before deducting openings. */
  wallSF: number;
  perimeterLF: number;
  /** Inside corners / jogs. Each one needs its own air mover to sweep it. */
  offsets: number;
  /** Door, window and cased openings — deducted from paintable/removable wall. */
  openingSF: number;
}

/** Materials the estimator knows how to reason about, by drying behaviour. */
export type MaterialType =
  | 'carpet'
  | 'carpet_pad'
  | 'hardwood'
  | 'engineered_wood'
  | 'laminate'
  | 'vinyl_plank'
  | 'sheet_vinyl'
  | 'tile'
  | 'concrete'
  | 'drywall'
  | 'plaster'
  | 'insulation'
  | 'baseboard'
  | 'cabinetry'
  | 'subfloor_wood'
  | 'ceiling_drywall'
  | 'contents';

/** Which plane of the room a material sits on. Drives which geometry applies. */
export type Surface = 'floor' | 'wall' | 'ceiling' | 'contents';

/**
 * One wet material in one room. This is the atom the scope rules consume: an
 * affected material plus how much of it is wet plus how wet it is.
 */
export interface AffectedMaterial {
  material: MaterialType;
  surface: Surface;
  /** Affected quantity in the material's natural unit (SF for surfaces, LF for trim). */
  quantity: number;
  unit: Unit;
  /**
   * Height above the floor that moisture reached, in inches. Sets the flood-cut
   * height for wall assemblies; undefined for floors and ceilings.
   */
  wetHeightIn?: number;
  /** True when the wall cavity behind this surface is wet (drives insulation removal). */
  cavityWet?: boolean;
  /** Porous materials cannot be cleaned to a Category 3 standard — they come out. */
  porous: boolean;
  /** Technician's call: can this dry in place, or is it non-salvageable? */
  salvageable: boolean;
}

/* ------------------------------------------------------------------ *
 * Moisture + psychrometrics
 * ------------------------------------------------------------------ */

/** One moisture meter reading against a material's dry standard. */
export interface MoistureReading {
  roomId: string;
  material: MaterialType;
  /** %MC for wood/gypsum, or relative scale points for non-invasive meters. */
  value: number;
  /** The unaffected-area benchmark this reading is compared against. */
  dryStandard: number;
  takenAt: string; // ISO 8601
  /** Free-text location, e.g. "north wall, 12in AFF". */
  location?: string;
}

/** A psychrometric snapshot — the evidence that drying conditions were managed. */
export interface PsychrometricReading {
  takenAt: string;
  /** 'affected' | 'unaffected' | 'outside' | 'dehu_outlet' */
  zone: 'affected' | 'unaffected' | 'outside' | 'dehu_outlet';
  temperatureF: number;
  relativeHumidity: number;
  /** Grains per pound of dry air. Derived when the source omits it. */
  gpp?: number;
}

/** Drying equipment the crew actually placed, per MICA / the equipment log. */
export type EquipmentKind =
  | 'air_mover'
  | 'axial_air_mover'
  | 'dehumidifier_lgr'
  | 'dehumidifier_conventional'
  | 'dehumidifier_desiccant'
  | 'air_scrubber'
  | 'heater'
  | 'injectidry';

export interface EquipmentPlacement {
  kind: EquipmentKind;
  quantity: number;
  roomId?: string;
  placedAt: string;
  removedAt?: string;
  /** Billable days on site. Derived from the dates when absent. */
  days?: number;
}

/* ------------------------------------------------------------------ *
 * Evidence
 * ------------------------------------------------------------------ */

/**
 * A photo, reading, or note that substantiates a line item.
 *
 * Evidence is not decoration. The estimator refuses to bill certain line items
 * without it (see `EVIDENCE_REQUIRED_TAGS`) because an item an adjuster cannot
 * see documented is an item that gets removed on review — which is worse for
 * margin than never having written it.
 */
export type EvidenceKind = 'photo' | 'moisture_reading' | 'psychrometric' | 'note' | 'sketch';

export interface Evidence {
  id: string;
  kind: EvidenceKind;
  roomId?: string;
  capturedAt?: string;
  /** Photo caption, note body, or a rendered summary of a reading. */
  description: string;
  /** Storage reference — a Supabase Storage path or an external URL. */
  uri?: string;
  /** Tags an adapter extracted, e.g. ['flood_cut', 'category_3', 'kitchen']. */
  tags: string[];
}

/* ------------------------------------------------------------------ *
 * The normalised assessment
 * ------------------------------------------------------------------ */

export interface AssessedRoom {
  id: string;
  name: string;
  /** Floor/level label, e.g. "Main Level", "Basement". */
  level: string;
  geometry: RoomGeometry;
  /** Fraction of the room's floor that is wet, 0–1. Drives class determination. */
  affectedFloorFraction: number;
  materials: AffectedMaterial[];
  /** True when the water came from above and the ceiling is wet (Class 3 signal). */
  ceilingAffected: boolean;
  /**
   * The flood cut the crew actually made, in inches, when a source recorded it.
   *
   * Distinct from a material's `wetHeightIn`, which is where the moisture
   * reached. The rules derive a cut height from the wet line, but a documented
   * cut always wins — the estimate bills the work that was performed, not the
   * work the arithmetic would have called for.
   */
  documentedCutHeightIn?: number;
  /** Set when this room is inaccessible/unsafe and must be scoped conservatively. */
  notes?: string;
}

/**
 * Everything the agent knows about the loss after ingestion, before any
 * estimating decisions are made. This object is deterministic given its inputs,
 * which is what makes the estimate reproducible and auditable.
 */
export interface LossAssessment {
  jobId: string;
  /** Property + claim identity, as far as the sources revealed it. */
  propertyAddress?: string;
  claimNumber?: string;
  carrier?: string;
  insuredName?: string;

  dateOfLoss?: string;
  /** When the crew first arrived — the clock that degrades water category. */
  dateOfArrival?: string;

  cause: LossCause;
  /** Category at the source, before time-based degradation. */
  sourceCategory: WaterCategory;
  /** Effective category after degradation; what the scope is actually built on. */
  category: WaterCategory;
  class: WaterClass;

  rooms: AssessedRoom[];
  moistureReadings: MoistureReading[];
  psychrometrics: PsychrometricReading[];
  equipment: EquipmentPlacement[];
  evidence: Evidence[];

  /** Days of active drying, from first placement to final dry standard. */
  dryingDays: number;
  /** Monitoring visits performed (or planned) — one per drying day by default. */
  monitoringVisits: number;

  /** True when microbial growth was observed or is presumed (>72h, Cat 3). */
  microbialGrowthPresent: boolean;
  /** Structures built for containment during demolition, in SF of barrier. */
  containmentRequired: boolean;

  /** Non-fatal problems found during ingestion. Surfaced to the user, never hidden. */
  warnings: string[];
  /** Which adapters contributed, for provenance on the finished estimate. */
  sourcesUsed: SourceKind[];

  /**
   * What is wrong with the property — observational findings from photos/notes
   * (and structured sources). Distinct from `scope` (what we bill) and from
   * mitigation requirements (what rules oblige).
   */
  findings: DamageFinding[];
}

export type SourceKind = 'docusketch' | 'mica' | 'photos' | 'notes';

/* ------------------------------------------------------------------ *
 * Scope + line items
 * ------------------------------------------------------------------ */

/**
 * A unit of work the assessment justifies, expressed in domain terms before it
 * is translated into Xactimate's vocabulary. Keeping this layer separate means
 * the reasoning ("Cat 3 water contacted porous drywall, so it comes out to 24
 * inches") is reviewable independently of whether the code is `WTR DRY` or
 * `WTR DRYWL`.
 */
export interface ScopeItem {
  id: string;
  roomId?: string;
  /** Stable rule identifier, for tracing an item back to the rule that wrote it. */
  rule: string;
  description: string;
  quantity: number;
  unit: Unit;
  /** Plain-English justification, cited on the estimate for the adjuster. */
  justification: string;
  /**
   * The IICRC requirements this decision rests on, as registry ids.
   *
   * Ids rather than strings, so no rule can invent a section number — see
   * `standards/s500.ts`. Every scope item carries at least one: an item with
   * nothing behind it is one the estimator should not have written.
   */
  citations: CitationId[];
  /** Evidence ids that substantiate this item. */
  evidenceIds: string[];
  /** Tags used to look up matching catalog entries. */
  tags: string[];
}

/** One priced line on the finished estimate. */
export interface EstimateLineItem {
  id: string;
  /** Stable catalog key. Survives a price-list sync renaming `code`. */
  catalogKey: string;
  /** Xactimate selector, e.g. 'WTRDHM'. */
  code: string;
  /** Xactimate category prefix, e.g. 'WTR'. */
  category: string;
  description: string;
  roomId?: string;
  roomName?: string;

  quantity: number;
  unit: Unit;
  unitPrice: number;
  /** quantity × unitPrice, before O&P and tax. */
  rcv: number;

  /** Internal cost basis for this line — labour + burden + equipment + materials. */
  unitCost: number;
  totalCost: number;

  /** Where this line came from. */
  scopeItemIds: string[];
  justification: string;
  /** IICRC requirements behind this line, merged from its scope items. */
  citations: CitationId[];
  evidenceIds: string[];

  /**
   * True when the catalog entry demands documentation this job does not have.
   * Flagged lines are never silently included — they surface for a human call.
   */
  evidenceGap?: string;
  /** False until this code has been reconciled against the org's real price list. */
  priceVerified: boolean;
}

/* ------------------------------------------------------------------ *
 * Profitability
 * ------------------------------------------------------------------ */

/** A missed or under-scoped item the reviewer found. Never fabricated work. */
export interface ProfitFinding {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  kind:
    | 'missing_line_item' // work performed but not billed
    | 'under_quantity' // billed short of measured geometry
    | 'missing_evidence' // billable but undocumented
    | 'low_margin' // priced below target
    | 'unsupported_item'; // billed without justification — remove it
  title: string;
  detail: string;
  /** Revenue impact if acted on. Negative for items that should come off. */
  revenueImpact: number;
  /** Margin impact in dollars. */
  marginImpact: number;
  /** What the user must supply/confirm before this can be added. */
  actionRequired?: string;
  relatedCode?: string;
  roomId?: string;
}

export interface ProfitabilitySummary {
  /** Sum of line RCV before O&P and tax. */
  subtotal: number;
  overheadAndProfit: number;
  tax: number;
  total: number;

  /** Internal cost basis across all lines. */
  totalCost: number;
  grossProfit: number;
  /** grossProfit / total, 0–1. */
  grossMargin: number;
  targetMargin: number;
  /** Dollars of revenue needed to reach `targetMargin` at the current cost base. */
  marginGap: number;

  findings: ProfitFinding[];
  /** Recoverable revenue across all actionable findings. */
  recoverableRevenue: number;
}

/* ------------------------------------------------------------------ *
 * The finished estimate
 * ------------------------------------------------------------------ */

export interface MitigationEstimate {
  jobId: string;
  generatedAt: string;
  assessment: LossAssessment;
  scope: ScopeItem[];
  lineItems: EstimateLineItem[];
  profitability: ProfitabilitySummary;
  /**
   * The estimate read back against the IICRC standards — what the job did, did
   * not do, and cannot show it did. Distinct from the profitability review:
   * that one asks what is unbilled, this one asks what is indefensible.
   */
  compliance: ComplianceReport;
  /**
   * The carrier program terms this estimate was built against, and whether it
   * satisfies them. Null-agreement is a valid and reported outcome — plenty of
   * work is written outside a program.
   */
  sla: SlaComplianceReport;
  /**
   * Every standard cited anywhere in this estimate, resolved. This is the
   * appendix a reader turns to with their own copy of the standard open.
   */
  references: StandardReference[];
  /**
   * What must be mitigated / documented, by authority (IICRC, insurance,
   * construction-code adjacent, carrier SLA). Scope fulfills these when
   * findings + geometry support quantities.
   */
  requirements: MitigationRequirement[];
  /** Human-readable narrative for the estimate header, written for the adjuster. */
  narrative: string;
  /** Anything the agent could not decide on its own. */
  openQuestions: string[];
  /**
   * S500-sized equipment plan for the loss (distinct from the equipment log).
   * Always computed on every estimate so flood-cut airflow and dehu sizing are
   * first-class, even when no drying reports have been appended yet.
   */
  equipmentPlan?: EquipmentPlan;
  /** Progress across drying visits when reports were supplied. */
  dryingProgress?: DryingProgress;
}

export type { CitationId, StandardReference } from './standards/s500.js';
export type { ComplianceCheck, ComplianceReport, ComplianceStatus } from './standards/compliance.js';
export type {
  CarrierIdentification,
  ProgramAgreement,
  SlaCheck,
  SlaComplianceReport,
  SlaDeviation,
  SlaRule,
  SlaStatus,
} from './carrier/types.js';
