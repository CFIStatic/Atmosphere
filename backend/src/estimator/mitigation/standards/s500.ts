/**
 * The IICRC standards registry.
 *
 * Every estimating decision this agent makes cites the standard it rests on, and
 * this file is the only place those citations live. Rules reference a stable id;
 * nothing anywhere else types a section number.
 *
 * ## Why a registry rather than inline strings
 *
 * Citations were previously written inline at each rule, and the result was
 * exactly what you would expect: the same section number attached to five
 * unrelated requirements, because a plausible-looking number is easy to type and
 * hard to notice. On an estimate that goes to a carrier, a wrong citation is
 * worse than no citation — it invites the adjuster to check the next one.
 *
 * ## The copyright line
 *
 * ANSI/IICRC S500 and S520 are copyrighted publications sold by the IICRC. Their
 * text is not reproduced here, and must not be. Every `requirement` below is a
 * paraphrase written for this codebase, of the kind any restoration textbook
 * contains. What the estimate carries is a *pointer* — the standard, the
 * edition, and the location — so a reader with their own copy can turn to it.
 *
 * ## Confidence is part of the citation
 *
 * This is the important design decision. A citation carries how firmly it is
 * anchored, and the rendered form changes accordingly:
 *
 *   `clause`     — a numbered clause. Rendered as "ANSI/IICRC S500 §12.2.4".
 *   `chapter`    — located to a chapter or topic but not a clause. Rendered as
 *                  "ANSI/IICRC S500, water categories" — deliberately without a
 *                  number, because inventing one to look precise is the failure
 *                  mode this whole file exists to prevent.
 *   `convention` — standard *industry practice* that the standard itself does
 *                  not mandate. Rendered as "industry practice — not a
 *                  requirement of S500". Several things restorers say "the S500
 *                  requires" are really convention, and attributing them
 *                  correctly is what makes the rest of the estimate credible.
 *
 * ## Two things that change how you argue a scope
 *
 * **"Shall" and "should" are not the same.** S500 uses `shall` for what is
 * mandatory and `should` for what is recommended, and a great deal of what the
 * industry treats as compulsory is `should` language. Where research established
 * that a requirement is recommendation-level, the `caveat` says so — an adjuster
 * who knows the difference will, and being the one who does not is a poor place
 * to negotiate from.
 *
 * **Chapter numbering moved between editions.** Structural Restoration was
 * Chapter 13 in the 2015 fourth edition and is Chapter 12 in the 2021 fifth.
 * `edition` records which one a location belongs to, and `S500_EDITION` is what
 * the estimate prints. If your copy is the 2015 edition, expect the Structural
 * Restoration references here to sit one chapter later in it.
 */

/** Stable ids. Rules cite these; nothing cites a section number directly. */
export type CitationId =
  // Classification
  | 'WATER_CATEGORIES'
  | 'CATEGORY_DEGRADATION'
  | 'WATER_CLASSES'
  | 'CLASS_4_SPECIALTY_DRYING'
  // Inspection and documentation
  | 'PRELIMINARY_DETERMINATION'
  | 'DRY_STANDARD'
  | 'MONITORING_AND_DOCUMENTATION'
  | 'PSYCHROMETRIC_DOCUMENTATION'
  // Removal decisions
  | 'POROUS_MATERIAL_REMOVAL_CAT3'
  | 'SALVAGEABILITY_ASSESSMENT'
  | 'WALL_CAVITY_ACCESS'
  | 'FLOOD_CUT_HEIGHT'
  // Cleaning and treatment
  | 'CLEANING_BEFORE_ANTIMICROBIAL'
  | 'ANTIMICROBIAL_APPLICATION'
  | 'POST_DEMOLITION_CLEANING'
  // Drying
  | 'WATER_EXTRACTION_FIRST'
  | 'DEHUMIDIFICATION_SIZING'
  | 'AIRFLOW_SIZING'
  | 'DRYING_VERIFICATION'
  // Safety and containment
  | 'WORKER_SAFETY_PPE'
  | 'CONTAINMENT'
  | 'NEGATIVE_PRESSURE'
  | 'WORK_PATH_PROTECTION'
  // Contents
  | 'CONTENTS_HANDLING';

export type StandardId = 'S500' | 'S520';

/**
 * How firmly the citation is anchored. See the file header — this is not
 * metadata, it changes what the estimate prints.
 */
export type CitationConfidence = 'clause' | 'chapter' | 'convention';

export interface StandardReference {
  id: CitationId;
  standard: StandardId;
  /** Which edition the location refers to. */
  edition: string;
  /** Chapter or topic area. Always populated — this is the fallback locator. */
  chapter: string;
  /** Numbered clause. Present only when `confidence === 'clause'`. */
  section?: string;
  /** Short human title for the citation. */
  title: string;
  /**
   * Paraphrased requirement, written for this codebase. Never the standard's
   * own wording.
   */
  requirement: string;
  /** How this estimator applies it — the bridge from standard to line item. */
  application: string;
  confidence: CitationConfidence;
  /**
   * Set when what restorers commonly attribute to the standard is really
   * convention. Printed alongside the citation so the estimate does not
   * overstate its authority.
   */
  caveat?: string;
}

/** The edition the estimate cites. Configurable per org — see estimator settings. */
export const S500_EDITION = 'ANSI/IICRC S500-2021';
export const S520_EDITION = 'ANSI/IICRC S520-2024';

const ref = (
  entry: Omit<StandardReference, 'edition'> & { edition?: string },
): StandardReference => ({
  edition: entry.edition ?? (entry.standard === 'S520' ? S520_EDITION : S500_EDITION),
  ...entry,
});

/* ------------------------------------------------------------------ *
 * The registry
 * ------------------------------------------------------------------ */

export const CITATIONS: Record<CitationId, StandardReference> = {
  /* ---- Classification ---- */

  WATER_CATEGORIES: ref({
    id: 'WATER_CATEGORIES',
    standard: 'S500',
    chapter: 'Water categories',
    title: 'Categories of water',
    requirement:
      'Water is classified by the degree of contamination at its source: Category 1 originates from a sanitary source, Category 2 carries significant contamination and has the potential to cause discomfort or illness, and Category 3 is grossly contaminated and may carry pathogenic or toxigenic agents.',
    application:
      'Sets what may be dried in place and what must be removed. Every removal decision in the scope rules keys off this.',
    confidence: 'chapter',
  }),

  CATEGORY_DEGRADATION: ref({
    id: 'CATEGORY_DEGRADATION',
    standard: 'S500',
    chapter: 'Water categories — deterioration over time',
    title: 'Category deteriorates with time and conditions',
    requirement:
      'A category is not fixed at the moment of loss. Water that remains in contact with structure and contents picks up soils and supports microbial amplification, so cleaner water deteriorates toward a higher category as time, temperature and available nutrients allow.',
    application:
      'The estimator re-classifies the loss upward when water stood before mitigation began, and states on the estimate that it did so and why.',
    confidence: 'chapter',
    caveat:
      'The familiar 48-hour and 72-hour thresholds are widely taught working figures, not fixed constants the standard sets. The standard describes deterioration as dependent on time, temperature and conditions. The estimator uses those figures as a configurable default and says so rather than presenting them as a clause.',
  }),

  WATER_CLASSES: ref({
    id: 'WATER_CLASSES',
    standard: 'S500',
    chapter: 'Classes of water intrusion',
    title: 'Classes of water intrusion',
    requirement:
      'The class of a water intrusion describes the evaporation load — how much water the affected assemblies hold and how readily it will leave them — rather than how contaminated the water is. It is what determines the drying capacity the job requires.',
    application:
      'Sets the dehumidification factor and the airflow the job is scoped for. A Category 3 loss in a small tiled bathroom is still a low class; the two axes are independent.',
    confidence: 'chapter',
    caveat:
      'The percentage bands (under 5%, 5–40%, over 40%) are measured against the combined floor, wall and ceiling area of the affected space — not the floor area alone, which is the usual mis-application. Class 4 remains a separate class defined by material and assembly rather than by a percentage. Older descriptions still circulating on contractor sites — "Class 3 means the water came from overhead" — predate the surface-area basis. The estimator computes the fraction and reports it, so the classification can be checked rather than taken on faith.',
  }),

  CLASS_4_SPECIALTY_DRYING: ref({
    id: 'CLASS_4_SPECIALTY_DRYING',
    standard: 'S500',
    chapter: 'Classes of water intrusion — specialty drying situations',
    title: 'Deeply held moisture requires specialty drying',
    requirement:
      'Moisture bound in low-evaporation assemblies — hardwood, plaster, concrete, masonry — does not leave under ordinary airflow and dehumidification, and calls for specialty methods such as low-humidity, heat or cavity drying systems.',
    application:
      'Triggers desiccant and cavity-drying line items, and only for material being dried in place: a wet hardwood floor coming out is a tear-out, not a specialty-drying job.',
    confidence: 'chapter',
  }),

  /* ---- Inspection and documentation ---- */

  PRELIMINARY_DETERMINATION: ref({
    id: 'PRELIMINARY_DETERMINATION',
    standard: 'S500',
    chapter: 'Ch. 10 — Inspections, Preliminary Determination and Pre-Restoration Evaluations',
    title: 'Inspect and determine the scope before restoring',
    requirement:
      'Before restoration begins, the restorer inspects the loss, determines the category and class, identifies affected materials and their moisture content, and documents the conditions found.',
    application:
      'The assessment this agent builds from the scan, the drying record, the photos and the notes is that determination, written down in a form the estimate can be checked against.',
    confidence: 'chapter',
  }),

  DRY_STANDARD: ref({
    id: 'DRY_STANDARD',
    standard: 'S500',
    chapter: 'Ch. 10 — Inspections, Preliminary Determination and Pre-Restoration Evaluations',
    title: 'Establish a drying goal from unaffected material',
    requirement:
      'A drying goal is established by measuring the same material in an unaffected area of the structure, so that "dry" is defined by the building itself rather than by a generic number.',
    application:
      'Moisture readings are carried with the dry standard they were measured against, and the compliance check reports when a reading arrived without one.',
    confidence: 'chapter',
  }),

  MONITORING_AND_DOCUMENTATION: ref({
    id: 'MONITORING_AND_DOCUMENTATION',
    standard: 'S500',
    chapter: 'Ch. 12 — Structural Restoration (monitoring)',
    title: 'Monitor and document drying progress',
    requirement:
      'Drying is monitored and documented until the drying goal is reached: moisture content of affected materials, the psychrometric conditions being maintained, and any adjustment made to the drying system.',
    application:
      'Monitoring visits are billable labour and are the record the whole estimate rests on. The estimator bills every documented visit and flags equipment days that no visit corroborates.',
    confidence: 'chapter',
    caveat:
      'The standard uses "should" here and names no fixed interval — it calls for monitoring sufficient to demonstrate progress, and for changing the drying system when progress stalls. Daily monitoring is the prevailing expectation and what most carriers reimburse against, which is what this estimator assumes, but it is convention supplying the frequency rather than a clause.',
  }),

  PSYCHROMETRIC_DOCUMENTATION: ref({
    id: 'PSYCHROMETRIC_DOCUMENTATION',
    standard: 'S500',
    chapter: 'Ch. 5 — Psychrometry and Drying Technology',
    title: 'Record the psychrometric conditions being maintained',
    requirement:
      'Temperature and humidity are recorded in the affected area and in an unaffected control, so that the drying system can be shown to be removing moisture rather than merely running.',
    application:
      'The narrative states the GPP differential between affected and unaffected air, which is the evidence that the equipment on the estimate did something.',
    confidence: 'chapter',
  }),

  /* ---- Removal decisions ---- */

  POROUS_MATERIAL_REMOVAL_CAT3: ref({
    id: 'POROUS_MATERIAL_REMOVAL_CAT3',
    standard: 'S500',
    chapter: 'Ch. 12 — Structural Restoration (Category 3 losses)',
    title: 'Porous materials contacted by Category 3 water are removed',
    requirement:
      'Porous materials contacted by grossly contaminated water cannot be returned to a sanitary condition by cleaning, and are removed and disposed of rather than dried in place.',
    application:
      'On a Category 3 loss every porous covering, wall finish and insulation in the affected area is scoped for removal, and the justification on each line says so.',
    confidence: 'chapter',
  }),

  SALVAGEABILITY_ASSESSMENT: ref({
    id: 'SALVAGEABILITY_ASSESSMENT',
    standard: 'S500',
    chapter: 'Ch. 12 — Structural Restoration (restorability)',
    title: 'Assess whether a material can be restored',
    requirement:
      'Whether a wet material is restored or replaced is judged on its porosity, how much water it holds, how long it has held it, the contamination present, and whether it can reach the drying goal in a reasonable period.',
    application:
      'Drives the keep-or-remove decision for each affected material, including carpet pad on Category 2 losses, which is removed as a matter of course because it will not dry through the carpet above it.',
    confidence: 'chapter',
  }),

  WALL_CAVITY_ACCESS: ref({
    id: 'WALL_CAVITY_ACCESS',
    standard: 'S500',
    chapter: 'Ch. 12 — Structural Restoration (accessing assemblies)',
    title: 'Wet cavities must be opened or dried by other means',
    requirement:
      'Moisture inside a wall assembly behind a vapour-retarding finish will not dry through that finish. The cavity is either opened, or dried through an injection or interstitial system that reaches it.',
    application:
      'A wet cavity produces either a flood cut with insulation removal, or a cavity-drying line item — the estimator prices both paths and says which is cheaper for the carrier.',
    confidence: 'chapter',
  }),

  FLOOD_CUT_HEIGHT: ref({
    id: 'FLOOD_CUT_HEIGHT',
    standard: 'S500',
    chapter: 'Ch. 12 — Structural Restoration (controlled demolition)',
    title: 'Removal extends beyond the documented moisture line',
    requirement:
      'Removal extends past the highest point moisture is documented to have reached, because moisture wicks above the visible line and a cut made at the wet line leaves wet material in the wall.',
    application:
      'The estimator sets the cut at a clearance above the highest wet reading and rounds to a framing division — and when the crew documented the cut they actually made, it bills that instead.',
    confidence: 'chapter',
    caveat:
      'No specific cut height is prescribed. The standard treats partial removal as controlled demolition scoped to what the moisture documentation supports; the familiar 2-foot and 4-foot cuts are practical framing divisions, not a required dimension. That is why this estimator bills a documented cut over its own arithmetic, and asks for confirmation when the two disagree.',
  }),

  /* ---- Cleaning and treatment ---- */

  CLEANING_BEFORE_ANTIMICROBIAL: ref({
    id: 'CLEANING_BEFORE_ANTIMICROBIAL',
    standard: 'S500',
    chapter: 'Ch. 7 — Antimicrobial (Biocide) Technology',
    title: 'Cleaning does the work; chemistry does not replace it',
    requirement:
      'Contamination is addressed principally by removing it — physical removal and cleaning. An antimicrobial applied over contamination that was not removed does not make the material safe.',
    application:
      'Antimicrobial is scoped *after* removal of non-salvageable material, never in place of it. The estimator will not substitute a treatment line for a removal the category requires.',
    confidence: 'chapter',
  }),

  ANTIMICROBIAL_APPLICATION: ref({
    id: 'ANTIMICROBIAL_APPLICATION',
    standard: 'S500',
    chapter: 'Ch. 7 — Antimicrobial (Biocide) Technology',
    title: 'Antimicrobial application on contaminated losses',
    requirement:
      'Applying an EPA-registered antimicrobial is one available response on a contaminated loss, used on the restorer’s judgement and applied according to its label. It supplements removal and cleaning rather than substituting for them.',
    application:
      'Scoped across all affected surfaces on Category 2 and 3 losses — walls and ceilings as well as floors, which is where it is usually under-measured.',
    confidence: 'chapter',
    caveat:
      'Commonly described in the field as "required by the S500 on any Cat 2 or 3". It is not. The standard devotes a chapter to antimicrobial technology and frames its use as a risk/benefit judgement the restorer makes, explicitly not as a substitute for removing unsalvageable contaminated material. The estimator scopes it because it is customary, expected by carriers and defensible — not because a clause compels it.',
  }),

  POST_DEMOLITION_CLEANING: ref({
    id: 'POST_DEMOLITION_CLEANING',
    standard: 'S520',
    chapter: 'Remediation procedures — cleaning',
    title: 'Clean after demolition',
    requirement:
      'Demolition liberates settled contamination and dust. Affected surfaces are HEPA-vacuumed and cleaned after removal work and before the area is released.',
    application:
      'A post-demolition HEPA line is scoped for every room where demolition happened on a contaminated loss.',
    confidence: 'chapter',
  }),

  /* ---- Drying ---- */

  WATER_EXTRACTION_FIRST: ref({
    id: 'WATER_EXTRACTION_FIRST',
    standard: 'S500',
    chapter: 'Ch. 12 — Structural Restoration (water removal)',
    title: 'Remove bulk water before evaporative drying',
    requirement:
      'Liquid water is removed by extraction before evaporative drying begins. Extraction removes water far faster and more cheaply than dehumidification can, and reduces the load the drying system must carry.',
    application:
      'Extraction is scoped against the affected floor area on every loss with a wet floor, before any equipment line.',
    confidence: 'chapter',
  }),

  DEHUMIDIFICATION_SIZING: ref({
    id: 'DEHUMIDIFICATION_SIZING',
    standard: 'S500',
    chapter: 'Appendix B — dehumidification sizing, with Ch. 5',
    title: 'Size dehumidification to the affected volume and class',
    requirement:
      'Dehumidification is sized from the volume of the affected area together with the class of intrusion, and the capacity installed is expected to hold the affected space at conditions that keep moisture leaving the materials.',
    application:
      'The estimator computes required capacity from affected cubic feet and the class factor, prints the arithmetic on the estimate, and flags rooms where the equipment actually placed falls short of it.',
    confidence: 'chapter',
    caveat:
      'The initial-water-load method (affected cubic feet ÷ a class-and-equipment-type factor) is published as a chart in an appendix to the standard and is framed there as an approximate starting point, not a fixed entitlement. The divisors in this codebase are the conventional values and are configurable per org; the Class 4 figures in particular are the ones this project has least confidence in, so check them against your own copy before leaning on a Class 4 quantity in a negotiation.',
  }),

  AIRFLOW_SIZING: ref({
    id: 'AIRFLOW_SIZING',
    standard: 'S500',
    chapter: 'airflow and air-mover quantity guidance',
    title: 'Provide airflow across every wet surface',
    requirement:
      'Air movers are positioned to sweep every wet surface, because evaporation stalls in the saturated boundary layer that forms against still material. Coverage is driven by wet surface area and by the geometry of the space.',
    application:
      'Air-mover counts are computed per room from wet floor area, wet wall length and inside corners, and compared against what the equipment log shows was actually placed.',
    confidence: 'chapter',
    caveat:
      'Air-mover quantity appears in S500 under "should" language — it is guidance, not a mandate, and a shortfall against it is a conversation rather than a violation. Two formulations circulate for the wall term: one unit per 100–150 sq ft of wet wall and ceiling (current, and the default here), and one unit per 10–16 linear feet of wet wall (older, still widely quoted, and materially more demanding on a long perimeter). Both are implemented and selectable; the floor term (one per 50–70 sq ft) is common to both. This estimator uses the midpoints and exposes them as settings.',
  }),

  DRYING_VERIFICATION: ref({
    id: 'DRYING_VERIFICATION',
    standard: 'S500',
    chapter: 'Ch. 12 — Structural Restoration (completion of drying)',
    title: 'Verify the drying goal was reached before demobilising',
    requirement:
      'Drying is complete when affected materials have reached the established drying goal, verified by measurement and documented — not when a fixed number of days has passed.',
    application:
      'The compliance check compares the final readings against their dry standards and reports any material that never got there, which is both a callback risk and an unbilled-days signal.',
    confidence: 'chapter',
  }),

  /* ---- Safety and containment ---- */

  WORKER_SAFETY_PPE: ref({
    id: 'WORKER_SAFETY_PPE',
    standard: 'S500',
    chapter: 'Ch. 8 — Safety and Health',
    title: 'Protect workers according to the hazard',
    requirement:
      'Personal protective equipment is selected for the contamination and hazards present. Work in grossly contaminated water calls for protection appropriate to that exposure, including respiratory protection.',
    application:
      'PPE is scoped per technician per day on Category 3 and microbial work — a consumable cost that jobs routinely absorb without billing.',
    confidence: 'chapter',
  }),

  CONTAINMENT: ref({
    id: 'CONTAINMENT',
    standard: 'S520',
    chapter: 'Containment',
    title: 'Contain the work area to prevent cross-contamination',
    requirement:
      'Work that disturbs contamination is performed inside a containment barrier so that the removal does not distribute the problem through unaffected parts of the building.',
    application:
      'Scoped when the category or documented microbial growth calls for it, and also when photos show a barrier was actually built — work performed is work billed.',
    confidence: 'chapter',
  }),

  NEGATIVE_PRESSURE: ref({
    id: 'NEGATIVE_PRESSURE',
    standard: 'S520',
    chapter: 'Containment — pressure differential',
    title: 'Containment is maintained under negative pressure',
    requirement:
      'A containment barrier is effective only while the enclosed area is held at negative pressure relative to its surroundings, which is established with an air filtration device and verified.',
    application:
      'Containment always brings a negative-pressure setup line and air-scrubber days with it; the profitability review flags a barrier billed without the machine that makes it work.',
    confidence: 'chapter',
  }),

  /**
   * The one entry that is openly not a requirement.
   *
   * Protecting the egress path is universal practice and entirely sensible, but
   * S520's containment provisions are about a barrier around the work area, not
   * about the floor you carry debris across. Citing containment for it — which
   * this codebase did at first — is precisely the loose attribution the registry
   * exists to catch, so it gets its own entry at `convention` confidence and
   * prints as what it is.
   */
  WORK_PATH_PROTECTION: ref({
    id: 'WORK_PATH_PROTECTION',
    standard: 'S500',
    chapter: 'Protecting unaffected areas during removal',
    title: 'Protect the path work is carried across',
    requirement:
      'Wet and contaminated material is carried out of the work area through parts of the building that were never affected. Covering that path keeps the removal from creating a second loss.',
    application:
      'A floor-protection line is scoped whenever demolition happens on a contaminated loss.',
    confidence: 'convention',
    caveat:
      'Not a requirement of either standard — it is ordinary good practice, and it is billable because the material and labour are real, not because a clause compels it.',
  }),

  /* ---- Contents ---- */

  CONTENTS_HANDLING: ref({
    id: 'CONTENTS_HANDLING',
    standard: 'S500',
    chapter: 'Contents evaluation and restoration',
    title: 'Contents are evaluated, moved and handled by category',
    requirement:
      'Contents in the affected area are evaluated for restorability and moved as needed to expose the structure for drying, with handling appropriate to the category of water they contacted.',
    application:
      'Content manipulation is billable labour, separate from every drying line item, and is among the most consistently unbilled work in mitigation.',
    confidence: 'chapter',
  }),
};

/* ------------------------------------------------------------------ *
 * Registry self-check
 * ------------------------------------------------------------------ */

/**
 * Runs at import, and deliberately throws rather than warns.
 *
 * The failure this guards against is silent and expensive: an entry marked
 * `clause` with no `section` would render as `ANSI/IICRC S500-2021 §undefined`
 * on a document that goes to a carrier. A server that refuses to boot is a much
 * better outcome than an estimate that ships with that on it.
 */
function validateRegistry(): void {
  for (const [id, citation] of Object.entries(CITATIONS) as Array<[CitationId, StandardReference]>) {
    if (citation.id !== id) {
      throw new Error(`Citation registry: entry "${id}" carries mismatched id "${citation.id}".`);
    }
    if (citation.confidence === 'clause' && !citation.section?.trim()) {
      throw new Error(
        `Citation registry: "${id}" claims clause-level confidence but has no section number. Set the section, or drop it to 'chapter'.`,
      );
    }
    if (citation.confidence !== 'clause' && citation.section) {
      throw new Error(
        `Citation registry: "${id}" carries section "${citation.section}" at ${citation.confidence} confidence. A number that will not be printed is a number that will eventually be printed by mistake — remove it or raise the confidence.`,
      );
    }
    if (!citation.chapter.trim()) {
      throw new Error(
        `Citation registry: "${id}" has no chapter. The chapter is the fallback locator and is never optional.`,
      );
    }
  }
}

validateRegistry();

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

export function resolveCitation(id: CitationId): StandardReference {
  const citation = CITATIONS[id];
  if (!citation) throw new Error(`Unknown standard citation: ${id}`);
  return citation;
}

/**
 * Render a citation for an estimate.
 *
 * The whole point of the confidence field lands here: a `chapter` citation
 * prints its chapter and no number, and a `convention` citation says outright
 * that it is not a requirement. Neither is allowed to look like a clause.
 */
export function formatCitation(id: CitationId): string {
  const c = resolveCitation(id);
  switch (c.confidence) {
    case 'clause':
      return `${c.edition} §${c.section}`;
    case 'chapter':
      return `${c.edition}, ${c.chapter}`;
    case 'convention':
      return `${c.chapter} — industry practice, not a requirement of ${c.standard}`;
  }
}

/** Render several citations as one string, deduplicated and in registry order. */
export function formatCitations(ids: readonly CitationId[]): string {
  return uniqueCitations(ids).map(formatCitation).join('; ');
}

/** Deduplicate while preserving the registry's declaration order. */
export function uniqueCitations(ids: readonly CitationId[]): CitationId[] {
  const wanted = new Set(ids);
  return (Object.keys(CITATIONS) as CitationId[]).filter((id) => wanted.has(id));
}

/**
 * The references actually used by an estimate, for its appendix.
 *
 * Only what was cited — a bibliography of everything the tool *could* cite would
 * be noise, and the reader is checking specific line items.
 */
export function referencesFor(ids: readonly CitationId[]): StandardReference[] {
  return uniqueCitations(ids).map(resolveCitation);
}

/**
 * Every caveat attached to the citations an estimate used.
 *
 * Surfaced on the estimate rather than buried here, because these are the places
 * where the industry says "the S500 requires" about something the standard
 * leaves to judgement. An estimator arguing a scope with an adjuster is better
 * off knowing which of their citations is a clause and which is custom.
 */
export function caveatsFor(ids: readonly CitationId[]): Array<{ id: CitationId; title: string; caveat: string }> {
  return referencesFor(ids)
    .filter((c): c is StandardReference & { caveat: string } => Boolean(c.caveat))
    .map((c) => ({ id: c.id, title: c.title, caveat: c.caveat }));
}
