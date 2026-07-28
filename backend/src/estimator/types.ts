/**
 * Domain types for the Construction Estimator agent.
 *
 * The pipeline reads three external systems and writes one:
 *
 *   DocuSketch  →  rooms + measurements + photos   (what the building looks like)
 *   Dash (CRM)  →  the job, its notes and files    (what the job actually is)
 *   Mitigation  →  what was already torn out       (what must therefore go back)
 *   Xactimate   ←  a priced construction estimate  (the deliverable)
 *
 * Everything in this file is vendor-neutral on purpose. Connectors translate a
 * vendor payload into these shapes, so swapping DocuSketch for another scanning
 * vendor — or Dash for another CRM — never reaches the scope engine.
 */

export const PROVIDERS = ['docusketch', 'dash', 'xactimate'] as const;
export type Provider = (typeof PROVIDERS)[number];

/* ------------------------------------------------------------------ */
/* Measurements                                                        */
/* ------------------------------------------------------------------ */

/** A door, window, or cased opening cut into a room's walls. */
export interface Opening {
  kind: 'door' | 'window' | 'cased_opening' | 'other';
  /** Feet. */
  width: number;
  /** Feet. */
  height: number;
  /** Openings between two scoped rooms are counted once, not twice. */
  sharedWithRoomId?: string;
}

/**
 * One room as measured by the 3D scan.
 *
 * Areas are stored as the scanner reports them rather than recomputed from the
 * perimeter: real rooms have bays, soffits, and sloped ceilings that a
 * perimeter × height product silently loses.
 */
export interface RoomMeasurements {
  id: string;
  name: string;
  /** e.g. "bedroom", "kitchen", "bathroom" — drives finish assumptions. */
  roomType?: string;
  /** Square feet of floor. */
  floorAreaSqFt: number;
  /** Square feet of ceiling. Defaults to floor area for a flat ceiling. */
  ceilingAreaSqFt: number;
  /** Square feet of wall, gross of openings. */
  wallAreaSqFt: number;
  /** Linear feet of floor perimeter. */
  perimeterLf: number;
  /** Feet, floor to ceiling. */
  ceilingHeightFt: number;
  openings: Opening[];
  /** Storey/area grouping from the scan ("Main Level", "Basement"). */
  level?: string;
}

/* ------------------------------------------------------------------ */
/* Photos and observations                                             */
/* ------------------------------------------------------------------ */

export interface JobPhoto {
  id: string;
  /** Room this photo was captured in, when the scan records it. */
  roomId?: string;
  caption?: string;
  takenAt?: string;
  /** Fetch URL. Bytes are only downloaded for photos we actually analyse. */
  url: string;
  contentType?: string;
}

/** Building surfaces a damage observation can attach to. */
export const SURFACES = [
  'floor',
  'walls',
  'ceiling',
  'baseboard',
  'trim',
  'cabinets',
  'countertop',
  'door',
  'window',
  'insulation',
  'contents',
  'other',
] as const;
export type Surface = (typeof SURFACES)[number];

export const DAMAGE_TYPES = [
  'water',
  'mold',
  'fire',
  'smoke',
  'impact',
  'demolition',
  'wear',
  'none',
] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

export const SEVERITIES = ['none', 'light', 'moderate', 'heavy'] as const;
export type Severity = (typeof SEVERITIES)[number];

/**
 * One damage finding read off one photo.
 *
 * `confidence` and `sourcePhotoId` are load-bearing, not decoration: every line
 * item the estimate ships can be traced back to the photo that justified it,
 * which is what makes the output defensible to an adjuster.
 */
export interface DamageObservation {
  sourcePhotoId: string;
  roomId?: string;
  surface: Surface;
  damageType: DamageType;
  severity: Severity;
  /** 0–1. Below `MIN_OBSERVATION_CONFIDENCE` an item is flagged, not dropped. */
  confidence: number;
  /** What the model actually saw, in adjuster-readable language. */
  note: string;
  /** Finish material identified on the surface, e.g. "carpet", "LVP", "drywall". */
  material?: string;
  /** Fraction of the surface affected, 0–1, when the photo supports a call. */
  affectedFraction?: number;
}

/* ------------------------------------------------------------------ */
/* CRM job                                                             */
/* ------------------------------------------------------------------ */

export interface JobAddress {
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}

export interface CrmJobNote {
  id: string;
  author?: string;
  createdAt?: string;
  body: string;
}

export interface CrmJob {
  id: string;
  /** Human-facing job/claim reference shown in the CRM. */
  jobNumber?: string;
  claimNumber?: string;
  policyNumber?: string;
  insuredName?: string;
  address: JobAddress;
  lossType?: string;
  lossDate?: string;
  carrier?: string;
  status?: string;
  notes: CrmJobNote[];
  /** Attachments — where a mitigation estimate usually lives. */
  documents?: CrmJobDocument[];
}

export interface CrmJobDocument {
  id: string;
  name: string;
  contentType?: string;
  url: string;
}

/** The scan-side project, before it has been tied to a CRM job. */
export interface ScanProject {
  id: string;
  name: string;
  claimNumber?: string;
  policyNumber?: string;
  insuredName?: string;
  address: JobAddress;
  lossDate?: string;
  capturedAt?: string;
  rooms: RoomMeasurements[];
  photos: JobPhoto[];
}

/* ------------------------------------------------------------------ */
/* Job matching                                                        */
/* ------------------------------------------------------------------ */

export interface MatchSignal {
  field: string;
  weight: number;
  /** 0–1 agreement on this field. */
  score: number;
  detail: string;
}

export interface JobMatch {
  job: CrmJob;
  /** 0–100. See `matching/jobMatcher.ts` for the weighting. */
  score: number;
  signals: MatchSignal[];
}

export interface MatchResult {
  best: JobMatch | null;
  runnerUp: JobMatch | null;
  /** True when the caller must confirm before the run may continue. */
  needsReview: boolean;
  reason: string;
}

/* ------------------------------------------------------------------ */
/* Estimate                                                            */
/* ------------------------------------------------------------------ */

export const UNITS = ['SF', 'LF', 'EA', 'SY', 'HR', 'DA', 'CF'] as const;
export type Unit = (typeof UNITS)[number];

/** A catalog entry: an Xactimate category + selector and what it means. */
export interface CatalogItem {
  /** Xactimate category, e.g. "DRY", "PNT", "FCC". */
  category: string;
  /** Xactimate selector within the category, e.g. "1/2-", "SWL". */
  selector: string;
  description: string;
  unit: Unit;
  /** Waste allowance applied to the computed quantity, e.g. 0.10 for 10%. */
  wasteFactor?: number;
  /** Trades this item belongs to — used to group the estimate for review. */
  trade: string;
}

/** A scope decision, before it becomes a priced line. */
export interface ScopeItem {
  roomId: string;
  roomName: string;
  code: string;
  description: string;
  unit: Unit;
  quantity: number;
  /** Why this item is in the estimate — shown verbatim in the review UI. */
  rationale: string;
  /** 0–1 confidence inherited from the evidence that produced it. */
  confidence: number;
  /** Photo ids / mitigation line ids that justify this item. */
  evidence: string[];
  /** Set when a human must look before this ships. */
  needsReview?: boolean;
}

export interface EstimateLineItem extends ScopeItem {
  category: string;
  selector: string;
  trade: string;
  /** Quantity after the catalog's waste factor. */
  quantityWithWaste: number;
}

export interface EstimateSummary {
  lineItemCount: number;
  roomCount: number;
  /** Quantity totals per unit — a sanity check, not a price. */
  quantityByUnit: Record<string, number>;
  itemsNeedingReview: number;
  /** Rooms present in the scan that produced no line items. */
  emptyRooms: string[];
}

export interface ConstructionEstimate {
  jobId: string;
  jobNumber?: string;
  claimNumber?: string;
  insuredName?: string;
  address: JobAddress;
  /** `scan` | `mitigation` | `both` — where the scope came from. */
  basis: 'scan' | 'mitigation' | 'both';
  lineItems: EstimateLineItem[];
  summary: EstimateSummary;
  /** Anything the estimator could not decide on its own. */
  warnings: string[];
  generatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Mitigation estimate (input)                                         */
/* ------------------------------------------------------------------ */

/** One line lifted out of a mitigation estimate. */
export interface MitigationLineItem {
  id: string;
  /** Raw code as written in the source, e.g. "WTR DRY2" or "DMO CRPT". */
  code: string;
  description: string;
  unit: Unit;
  quantity: number;
  roomName?: string;
}

export interface MitigationEstimate {
  source: string;
  claimNumber?: string;
  lineItems: MitigationLineItem[];
}

/* ------------------------------------------------------------------ */
/* Run state                                                           */
/* ------------------------------------------------------------------ */

export const RUN_STAGES = [
  'queued',
  'connecting',
  'fetching_scan',
  'matching_job',
  'analyzing_photos',
  'reading_mitigation',
  'building_scope',
  'pricing',
  'awaiting_review',
  'exporting',
  'complete',
] as const;
export type RunStage = (typeof RUN_STAGES)[number];

export const RUN_STATUSES = [
  'running',
  'awaiting_review',
  'complete',
  'failed',
  'cancelled',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export interface RunEvent {
  at: string;
  stage: RunStage;
  level: 'info' | 'warn' | 'error';
  message: string;
}

/** A ranked job, flattened for the review UI. */
export interface MatchCandidate {
  jobId: string;
  jobNumber?: string;
  claimNumber?: string;
  insuredName?: string;
  address?: string;
  lossDate?: string;
  score: number;
  signals: MatchSignal[];
}

export interface EstimatorRun {
  id: string;
  orgId: string;
  createdBy: string;
  status: RunStatus;
  stage: RunStage;
  scanProjectId: string;
  crmJobId: string | null;
  matchScore: number | null;
  matchNeedsReview: boolean;
  /** Populated when the match needs a human — what the reviewer chooses from. */
  matchCandidates: MatchCandidate[];
  /** Why the match was or was not accepted, in plain language. */
  matchReason: string | null;
  scanProject: ScanProject | null;
  job: CrmJob | null;
  observations: DamageObservation[];
  mitigation: MitigationEstimate | null;
  estimate: ConstructionEstimate | null;
  /** Set once the estimate has been written out to Xactimate or a file. */
  exportRef: string | null;
  error: string | null;
  events: RunEvent[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Observations below this confidence still enter the scope, but their line
 * items are flagged for review rather than shipped silently. Dropping them
 * outright loses real damage the photo happened to capture badly; shipping them
 * silently puts a guess in front of an adjuster.
 */
export const MIN_OBSERVATION_CONFIDENCE = 0.55;
