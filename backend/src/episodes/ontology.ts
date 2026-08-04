import type { WorkAction } from './actions.js';
import type { CitationId } from '../estimator/mitigation/standards/s500.js';

/**
 * The construction work ontology.
 *
 * Trade → System → Assembly → Task → Steps, where a task carries everything
 * needed to judge whether an episode of it went well: what goes in, what it
 * takes, what must be true first, the expected action sequence, the
 * tolerances, how it is verified, how it fails, and when it is done.
 *
 * ## Why this is code and not a table
 *
 * Because it is versioned and reviewable. A task definition changing is a
 * change to how every future episode is judged, and that belongs in a diff
 * somebody approves, not in a row somebody edits. Episodes record the
 * `ontology_version` they were classified under so a later revision cannot
 * silently rewrite history.
 *
 * ## Why `maturity` exists
 *
 * A tolerance invented to fill a field is worse than an empty field — it will
 * be trusted, and it will be wrong. Water mitigation is seeded properly here
 * because the codebase already carries real IICRC S500 knowledge and cites it.
 * Other trades are structural stubs: the hierarchy is right, the detail is
 * thin, and they say so. Filling them is a job for a journeyman of that trade,
 * not for whoever is nearest the keyboard.
 *
 * ## `concealedBy` is the money field
 *
 * Most expensive defects are ones that stopped being visible when the next
 * trade started. A task that names what covers it tells the capture flow to
 * demand a pre-conceal observation, which is the one moment the evidence can
 * still be created at any price.
 */

export type TaskMaturity = 'seeded' | 'stub';

/** Where a rule comes from. Mirrors the S500 registry's honesty about anchoring. */
export type ToleranceBasis = 'standard' | 'convention' | 'manufacturer' | 'contract';

export interface Tolerance {
  name: string;
  /** The rule, stated so it can be checked against an observation. */
  rule: string;
  basis: ToleranceBasis;
  citations?: CitationId[];
}

export interface VerificationRequirement {
  /** Matches episode_verifications.kind so a requirement and a result line up. */
  kind:
    | 'ai_analysis'
    | 'gc_acceptance'
    | 'owner_acceptance'
    | 'code_inspection'
    | 'engineer_review'
    | 'pressure_test'
    | 'electrical_test'
    | 'moisture_reading'
    | 'thermal_scan'
    | 'punch_list'
    | 'third_party_test';
  what: string;
  /** False means "counts toward quality but its absence is not a failure". */
  required: boolean;
}

export interface FailureMode {
  name: string;
  /** How it shows up, in terms somebody could actually notice. */
  detect: string;
  /**
   * True when the failure stops being detectable once the work is covered.
   * These are the ones worth interrupting a crew's day to photograph.
   */
  hiddenAfterConcealment: boolean;
}

export interface TaskDefinition {
  /** Stable key. Never reused, never renamed — episodes are classified by it. */
  key: string;
  trade: string;
  system: string;
  assembly: string;
  name: string;
  maturity: TaskMaturity;
  summary: string;

  inputs: string[];
  requiredMaterials: string[];
  requiredTools: string[];
  preconditions: string[];
  /** The action sequence a correct performance is expected to contain. */
  expectedActions: WorkAction[];
  tolerances: Tolerance[];
  verification: VerificationRequirement[];
  failureModes: FailureMode[];
  completionCriteria: string[];
  /** What later work covers this up, when anything does. */
  concealedBy?: string;
  citations?: CitationId[];
}

export const ONTOLOGY_VERSION = 'v1';

/* ------------------------------------------------------------------ *
 * Water mitigation — seeded
 *
 * The trade this product knows. Tolerances cite the existing S500 registry,
 * which already distinguishes a numbered clause from industry convention, so
 * nothing here claims more authority than it has.
 * ------------------------------------------------------------------ */

const WATER_MITIGATION: TaskDefinition[] = [
  {
    key: 'mit.extraction.standing_water',
    trade: 'Water mitigation',
    system: 'Water removal',
    assembly: 'Affected floor assembly',
    name: 'Extract standing water',
    maturity: 'seeded',
    summary:
      'Remove liquid water from floors and assemblies before any drying equipment is set. Extraction removes water hundreds of times faster than evaporation, so doing it second wastes days of equipment time.',
    inputs: ['Loss assessment', 'Category determination', 'Affected floor area'],
    requiredMaterials: [],
    requiredTools: ['Portable or truck-mount extractor', 'Weighted extraction tool', 'Wet vacuum'],
    preconditions: [
      'Source of water stopped',
      'Electrical safety confirmed for the affected area',
      'Category 3 work has PPE and containment in place first',
    ],
    expectedActions: ['inspect', 'protect', 'remove', 'measure'],
    tolerances: [
      {
        name: 'Extraction before evaporation',
        rule: 'All accessible liquid water is extracted before air movers and dehumidifiers are relied on for removal.',
        basis: 'standard',
        citations: ['WATER_EXTRACTION_FIRST'],
      },
    ],
    verification: [
      { kind: 'moisture_reading', what: 'Post-extraction moisture readings on affected materials', required: true },
      { kind: 'ai_analysis', what: 'Footage shows no standing water remaining in the work area', required: false },
    ],
    failureModes: [
      {
        name: 'Water left in the pad or cavity',
        detect: 'Moisture readings stay flat over the first 24 hours despite equipment running.',
        hiddenAfterConcealment: true,
      },
      {
        name: 'Extraction skipped on hard surface',
        detect: 'Drying time far exceeds the class estimate; visible tide lines persist.',
        hiddenAfterConcealment: false,
      },
    ],
    completionCriteria: [
      'No recoverable liquid water in the affected assemblies',
      'Moisture readings recorded for each affected material',
    ],
    citations: ['WATER_EXTRACTION_FIRST', 'PRELIMINARY_DETERMINATION'],
  },
  {
    key: 'mit.demolition.flood_cut',
    trade: 'Water mitigation',
    system: 'Structure drying',
    assembly: 'Gypsum wall assembly',
    name: 'Flood cut and remove wet drywall',
    maturity: 'seeded',
    summary:
      'Cut and remove the wet portion of a wall assembly to a defined height, exposing the cavity for drying or removing unsalvageable porous material.',
    inputs: ['Moisture map of the wall', 'Water category', 'Cut height decision and its justification'],
    requiredMaterials: ['Disposal bags', 'Containment poly where required'],
    requiredTools: ['Oscillating or utility knife', 'Pry bar', 'Moisture meter', 'HEPA vacuum'],
    preconditions: [
      'Wall cavity checked for electrical and plumbing runs',
      'Moisture reading taken and recorded above the intended cut line',
      'Containment established for Category 3 or microbial work',
    ],
    expectedActions: ['measure', 'mark', 'protect', 'cut', 'remove', 'clean', 'inspect'],
    tolerances: [
      {
        name: 'Cut height above the documented water line',
        rule: 'The cut is made a documented distance above the highest moisture reading — commonly 12 or 24 inches — and the reading that justified it is recorded before the material leaves.',
        basis: 'standard',
        citations: ['FLOOD_CUT_HEIGHT', 'WALL_CAVITY_ACCESS'],
      },
      {
        name: 'Category 3 porous removal',
        rule: 'Porous material contacted by Category 3 water is removed rather than dried.',
        basis: 'standard',
        citations: ['POROUS_MATERIAL_REMOVAL_CAT3'],
      },
    ],
    verification: [
      { kind: 'moisture_reading', what: 'Reading above the cut line proving the remaining material is dry', required: true },
      { kind: 'ai_analysis', what: 'Footage shows the cut line, the exposed cavity and the removed area', required: false },
      { kind: 'gc_acceptance', what: 'General contractor accepts the extent of removal', required: false },
    ],
    failureModes: [
      {
        name: 'Cut too low — wet material left in place',
        detect: 'Elevated readings above the cut line; later microbial growth behind new board.',
        hiddenAfterConcealment: true,
      },
      {
        name: 'Cut too high — billing exceeds what the loss justifies',
        detect: 'Removed area exceeds the documented wet area; supplement denied on review.',
        hiddenAfterConcealment: true,
      },
      {
        name: 'Cavity insulation left wet behind an intact cut',
        detect: 'Cavity reading stays high while surface reads dry.',
        hiddenAfterConcealment: true,
      },
      {
        name: 'Concealed service damaged during the cut',
        detect: 'Loss of circuit or supply immediately after the cut; visible nick in the cavity footage.',
        hiddenAfterConcealment: true,
      },
    ],
    completionCriteria: [
      'Wet material removed to the justified height across the affected run',
      'Cavity exposed, cleaned, and readable by a meter',
      'The moisture reading behind the decision is on the record',
    ],
    concealedBy: 'Drywall replacement by the reconstruction trade',
    citations: ['FLOOD_CUT_HEIGHT', 'WALL_CAVITY_ACCESS', 'POROUS_MATERIAL_REMOVAL_CAT3', 'SALVAGEABILITY_ASSESSMENT'],
  },
  {
    key: 'mit.containment.barrier',
    trade: 'Water mitigation',
    system: 'Containment',
    assembly: 'Temporary barrier',
    name: 'Build containment barrier',
    maturity: 'seeded',
    summary:
      'Separate the work area from the rest of the building so contamination does not travel, and so the drying environment can be controlled.',
    inputs: ['Work area boundary', 'Category determination', 'Occupancy status'],
    requiredMaterials: ['6 mil poly sheeting', 'Zipper door', 'Tape', 'Framing or spring poles'],
    requiredTools: ['Utility knife', 'Stapler or tape', 'Manometer where negative pressure is required'],
    preconditions: ['Work area boundary agreed', 'Egress path preserved', 'HVAC isolation considered'],
    expectedActions: ['measure', 'position', 'fasten', 'protect', 'test', 'inspect'],
    tolerances: [
      {
        name: 'Sealed perimeter',
        rule: 'The barrier is sealed at floor, walls and ceiling with a functioning entry that keeps the seal when used.',
        basis: 'standard',
        citations: ['CONTAINMENT'],
      },
      {
        name: 'Negative pressure where required',
        rule: 'Contaminated work areas are held under negative pressure relative to adjacent occupied space, and the differential is verified rather than assumed.',
        basis: 'standard',
        citations: ['NEGATIVE_PRESSURE'],
      },
    ],
    verification: [
      { kind: 'ai_analysis', what: 'Footage shows a continuous sealed perimeter and a working entry', required: false },
      { kind: 'third_party_test', what: 'Manometer reading confirming the pressure differential', required: false },
    ],
    failureModes: [
      {
        name: 'Unsealed penetration or gap',
        detect: 'Poly moves at a gap; dust found outside containment; differential will not hold.',
        hiddenAfterConcealment: false,
      },
      {
        name: 'Negative pressure asserted but never measured',
        detect: 'No manometer reading on the record for a job that required one.',
        hiddenAfterConcealment: true,
      },
    ],
    completionCriteria: [
      'Perimeter sealed and entry functional',
      'Pressure differential measured where the category required it',
    ],
    citations: ['CONTAINMENT', 'NEGATIVE_PRESSURE', 'WORK_PATH_PROTECTION'],
  },
  {
    key: 'mit.drying.equipment_setup',
    trade: 'Water mitigation',
    system: 'Structure drying',
    assembly: 'Drying chamber',
    name: 'Set drying equipment',
    maturity: 'seeded',
    summary:
      'Place air movers and dehumidification sized to the affected area and class of loss, establishing the drying chamber the daily readings will be judged against.',
    inputs: ['Class of loss', 'Affected surface areas', 'Chamber cubic footage', 'Available power'],
    requiredMaterials: [],
    requiredTools: ['Air movers', 'Dehumidifiers', 'Thermo-hygrometer', 'Power distribution'],
    preconditions: [
      'Extraction complete',
      'Non-salvageable porous material removed',
      'Containment established where required',
      'Electrical capacity confirmed for the equipment load',
    ],
    expectedActions: ['measure', 'carry', 'position', 'connect', 'test', 'inspect'],
    tolerances: [
      {
        name: 'Airflow sizing',
        rule: 'Air mover count follows the affected floor and wall area for the class of loss rather than what was on the truck.',
        basis: 'standard',
        citations: ['AIRFLOW_SIZING'],
      },
      {
        name: 'Dehumidification sizing',
        rule: 'Dehumidifier capacity is calculated from chamber volume and class, and the calculation is recorded.',
        basis: 'standard',
        citations: ['DEHUMIDIFICATION_SIZING'],
      },
    ],
    verification: [
      { kind: 'moisture_reading', what: 'Initial psychrometric baseline inside and outside the chamber', required: true },
      { kind: 'ai_analysis', what: 'Footage shows the equipment placed and running in the affected area', required: false },
    ],
    failureModes: [
      {
        name: 'Under-sized equipment',
        detect: 'Grain depression stays low; drying stalls; days extend without progress.',
        hiddenAfterConcealment: false,
      },
      {
        name: 'Equipment placed but not energised',
        detect: 'Footage shows units in place with no airflow; readings flat next visit.',
        hiddenAfterConcealment: false,
      },
      {
        name: 'Sizing never documented',
        detect: 'No calculation on file when the carrier reviews equipment days.',
        hiddenAfterConcealment: true,
      },
    ],
    completionCriteria: [
      'Equipment placed, energised, and counted on the record',
      'Baseline psychrometrics recorded for the chamber and an unaffected reference',
    ],
    citations: ['AIRFLOW_SIZING', 'DEHUMIDIFICATION_SIZING', 'PSYCHROMETRIC_DOCUMENTATION'],
  },
  {
    key: 'mit.drying.monitoring_visit',
    trade: 'Water mitigation',
    system: 'Structure drying',
    assembly: 'Drying chamber',
    name: 'Daily monitoring visit',
    maturity: 'seeded',
    summary:
      'Return to the chamber, take readings from the same points, and decide whether the drying plan is working or needs to change.',
    inputs: ['Prior readings', 'Drying goal', 'Equipment inventory'],
    requiredMaterials: [],
    requiredTools: ['Moisture meter', 'Thermo-hygrometer', 'Camera'],
    preconditions: ['Equipment set', 'Baseline established', 'Access arranged with the occupant'],
    expectedActions: ['locate', 'measure', 'inspect', 'correct'],
    tolerances: [
      {
        name: 'Same points, every visit',
        rule: 'Readings are taken from the same documented locations each visit; a moved point makes the trend meaningless.',
        basis: 'standard',
        citations: ['MONITORING_AND_DOCUMENTATION'],
      },
      {
        name: 'Dry standard',
        rule: 'Drying continues until affected materials reach the documented dry standard for that material, not until a fixed number of days has passed.',
        basis: 'standard',
        citations: ['DRY_STANDARD'],
      },
    ],
    verification: [
      { kind: 'moisture_reading', what: 'Readings at each documented point', required: true },
    ],
    failureModes: [
      {
        name: 'Visit billed but not performed',
        detect: 'No readings, no footage, no access record for the day.',
        hiddenAfterConcealment: true,
      },
      {
        name: 'Stalled area not acted on',
        detect: 'A point flat across three visits with no change to the plan.',
        hiddenAfterConcealment: false,
      },
    ],
    completionCriteria: ['Readings recorded at every documented point', 'A decision recorded: continue, adjust, or demobilise'],
    citations: ['MONITORING_AND_DOCUMENTATION', 'DRY_STANDARD', 'PSYCHROMETRIC_DOCUMENTATION'],
  },
  {
    key: 'mit.cleaning.antimicrobial',
    trade: 'Water mitigation',
    system: 'Decontamination',
    assembly: 'Affected surfaces',
    name: 'Clean and apply antimicrobial',
    maturity: 'seeded',
    summary:
      'Physically clean affected surfaces, then apply an antimicrobial according to its label. Cleaning is the step that does the work; the chemical does not substitute for it.',
    inputs: ['Category determination', 'Affected surface inventory', 'Product label requirements'],
    requiredMaterials: ['Antimicrobial product', 'Cleaning agents', 'Disposal bags'],
    requiredTools: ['HEPA vacuum', 'Sprayer', 'PPE'],
    preconditions: [
      'Non-salvageable porous material removed',
      'Surfaces physically cleaned before any product is applied',
      'Occupant notified and sensitive occupants addressed',
    ],
    expectedActions: ['protect', 'clean', 'apply', 'wait', 'inspect'],
    tolerances: [
      {
        name: 'Clean before treat',
        rule: 'Surfaces are cleaned before an antimicrobial is applied; applying over soil is not treatment.',
        basis: 'standard',
        citations: ['CLEANING_BEFORE_ANTIMICROBIAL'],
      },
      {
        name: 'Label-directed application',
        rule: 'Dwell time, dilution and ventilation follow the product label, which governs over any general practice.',
        basis: 'manufacturer',
        citations: ['ANTIMICROBIAL_APPLICATION'],
      },
    ],
    verification: [
      { kind: 'ai_analysis', what: 'Footage shows cleaning performed before application', required: false },
      { kind: 'third_party_test', what: 'Post-remediation verification where the scope calls for it', required: false },
    ],
    failureModes: [
      {
        name: 'Applied over uncleaned surfaces',
        detect: 'Footage shows spraying with visible soil still present.',
        hiddenAfterConcealment: true,
      },
      {
        name: 'Dwell time not observed',
        detect: 'Timeline shows application and wipe-down within seconds.',
        hiddenAfterConcealment: true,
      },
    ],
    completionCriteria: ['Surfaces cleaned', 'Product applied per label', 'Product and lot recorded'],
    concealedBy: 'Reconstruction finishes',
    citations: ['CLEANING_BEFORE_ANTIMICROBIAL', 'ANTIMICROBIAL_APPLICATION', 'POST_DEMOLITION_CLEANING'],
  },
];

/* ------------------------------------------------------------------ *
 * Plumbing — seeded for one assembly
 *
 * The worked example: a copper supply elbow, start to finish. Included in full
 * because it is the shape every other trade's tasks should be written to, and
 * because a soldered joint inside a wall is the archetype of work that becomes
 * invisible the moment the next trade arrives.
 * ------------------------------------------------------------------ */

const PLUMBING: TaskDefinition[] = [
  {
    key: 'plumb.copper.install_elbow',
    trade: 'Plumbing',
    system: 'Domestic water',
    assembly: 'Copper supply line',
    name: 'Install soldered copper elbow',
    maturity: 'seeded',
    summary:
      'Join two runs of copper supply at a change of direction with a soldered elbow, then prove the joint under pressure before anything covers it.',
    inputs: ['Pipe routing', 'Line size', 'System pressure', 'Isolation point'],
    requiredMaterials: [
      'Copper elbow of matching size and type',
      'Lead-free solder',
      'Flux',
      'Abrasive cloth or fitting brush',
    ],
    requiredTools: ['Tube cutter', 'Deburring tool', 'Torch', 'Heat shield', 'Striker', 'Pressure test rig'],
    preconditions: [
      'Water isolated and the line drained — solder will not take on a wet joint',
      'Combustibles shielded and a fire watch arranged for hot work',
      'Pipe supported so the joint is not carrying load while it sets',
    ],
    expectedActions: [
      'measure',
      'mark',
      'cut',
      'clean',
      'apply',
      'position',
      'align',
      'connect',
      'wait',
      'test',
      'inspect',
    ],
    tolerances: [
      {
        name: 'Full insertion',
        rule: 'The tube is seated to the fitting stop; a short insertion leaves a joint that passes a test and fails later.',
        basis: 'convention',
      },
      {
        name: 'Cleaned and fluxed mating surfaces',
        rule: 'Both the tube end and the fitting socket are abraded bright and fluxed before heat.',
        basis: 'convention',
      },
      {
        name: 'Capillary draw, not a fillet',
        rule: 'Solder is drawn into the joint by capillary action with the flame off the solder; a visible bead alone does not indicate a filled joint.',
        basis: 'convention',
      },
      {
        name: 'Pressure test',
        rule: 'The joint holds the specified test pressure for the specified duration before concealment.',
        basis: 'contract',
      },
    ],
    verification: [
      { kind: 'pressure_test', what: 'Line holds test pressure for the specified duration', required: true },
      { kind: 'code_inspection', what: 'Rough-in inspection before the wall is closed', required: true },
      { kind: 'ai_analysis', what: 'Footage shows the completed joint in place before concealment', required: false },
    ],
    failureModes: [
      {
        name: 'Cold joint',
        detect: 'Solder sits on the surface rather than drawn in; weeps under pressure or months later under thermal cycling.',
        hiddenAfterConcealment: true,
      },
      {
        name: 'Water in the line during soldering',
        detect: 'Solder spits and will not flow; joint appears complete but is porous.',
        hiddenAfterConcealment: true,
      },
      {
        name: 'Burr left in the bore',
        detect: 'Turbulence and erosion at the fitting over time; not visible after assembly.',
        hiddenAfterConcealment: true,
      },
      {
        name: 'Flux residue left on the joint',
        detect: 'Green corrosion at the fitting months later.',
        hiddenAfterConcealment: true,
      },
      {
        name: 'Scorched adjacent framing',
        detect: 'Charring near the joint; found at inspection or never.',
        hiddenAfterConcealment: true,
      },
    ],
    completionCriteria: [
      'Joint made, cooled, and cleaned of flux',
      'Line holds the specified test pressure',
      'Rough-in inspection passed before concealment',
    ],
    concealedBy: 'Insulation and drywall',
  },
];

/* ------------------------------------------------------------------ *
 * Stubs
 *
 * Structure only. Present so episodes in these trades can be classified and
 * counted, and so the gap is visible rather than implied. Do not treat the
 * thin tolerance lists as authoritative — they are placeholders awaiting
 * somebody who does the work.
 * ------------------------------------------------------------------ */

const STUBS: TaskDefinition[] = [
  {
    key: 'drywall.gypsum.hang_board',
    trade: 'Drywall',
    system: 'Interior finishes',
    assembly: 'Gypsum wall assembly',
    name: 'Hang gypsum board',
    maturity: 'stub',
    summary: 'Fix gypsum board to framing. Definition incomplete — needs a finisher to specify.',
    inputs: ['Framing layout', 'Board schedule'],
    requiredMaterials: ['Gypsum board', 'Fasteners'],
    requiredTools: ['Screw gun', 'Utility knife', 'Lift'],
    preconditions: [
      'Concealed work inspected and signed off — this is the step that hides everything behind it',
    ],
    expectedActions: ['measure', 'cut', 'position', 'fasten', 'inspect'],
    tolerances: [],
    verification: [{ kind: 'code_inspection', what: 'Cover inspection before board goes up', required: true }],
    failureModes: [
      {
        name: 'Board hung over uninspected rough-in',
        detect: 'No inspection record dated before the hang.',
        hiddenAfterConcealment: true,
      },
    ],
    completionCriteria: ['Board fixed to framing across the scoped area'],
    concealedBy: 'Tape, finish and paint',
  },
  {
    key: 'electrical.branch.rough_in',
    trade: 'Electrical',
    system: 'Branch circuits',
    assembly: 'Concealed wiring',
    name: 'Branch circuit rough-in',
    maturity: 'stub',
    summary: 'Run and secure concealed branch wiring. Definition incomplete — needs a licensed electrician to specify.',
    inputs: ['Circuit schedule', 'Device locations'],
    requiredMaterials: ['Cable', 'Boxes', 'Staples'],
    requiredTools: ['Drill', 'Fish tape', 'Strippers'],
    preconditions: ['Framing complete', 'Permit in place'],
    expectedActions: ['locate', 'drill', 'position', 'fasten', 'connect', 'inspect'],
    tolerances: [],
    verification: [{ kind: 'code_inspection', what: 'Rough-in inspection before concealment', required: true }],
    failureModes: [
      {
        name: 'Cable damaged during later trades',
        detect: 'Fault after energising; the damage is behind finished wall.',
        hiddenAfterConcealment: true,
      },
    ],
    completionCriteria: ['Circuits run, secured and ready for inspection'],
    concealedBy: 'Insulation and drywall',
  },
];

export const TASKS: readonly TaskDefinition[] = Object.freeze([
  ...WATER_MITIGATION,
  ...PLUMBING,
  ...STUBS,
]);

const BY_KEY = new Map(TASKS.map((task) => [task.key, task]));

export function taskByKey(key: string): TaskDefinition | null {
  return BY_KEY.get(key) ?? null;
}

export function tasksForTrade(trade: string): TaskDefinition[] {
  return TASKS.filter((task) => task.trade.toLowerCase() === trade.toLowerCase());
}

/** The tree, for a picker: trade → system → assembly → tasks. */
export function ontologyTree(): Array<{
  trade: string;
  systems: Array<{
    system: string;
    assemblies: Array<{ assembly: string; tasks: Array<{ key: string; name: string; maturity: TaskMaturity }> }>;
  }>;
}> {
  const trades = new Map<string, Map<string, Map<string, TaskDefinition[]>>>();
  for (const task of TASKS) {
    const systems = trades.get(task.trade) ?? new Map();
    const assemblies = systems.get(task.system) ?? new Map();
    const tasks = assemblies.get(task.assembly) ?? [];
    tasks.push(task);
    assemblies.set(task.assembly, tasks);
    systems.set(task.system, assemblies);
    trades.set(task.trade, systems);
  }
  return [...trades.entries()].map(([trade, systems]) => ({
    trade,
    systems: [...systems.entries()].map(([system, assemblies]) => ({
      system,
      assemblies: [...assemblies.entries()].map(([assembly, tasks]) => ({
        assembly,
        tasks: tasks.map((t) => ({ key: t.key, name: t.name, maturity: t.maturity })),
      })),
    })),
  }));
}

/**
 * What this task needs captured, and when.
 *
 * The capture flow asks the ontology rather than guessing. A task that names
 * what conceals it earns a `pre_conceal` requirement, because after that point
 * no amount of money re-creates the evidence — which is exactly the argument
 * for interrupting a crew to film it.
 */
export function capturePlan(task: TaskDefinition): Array<{
  phase: 'existing_condition' | 'in_progress' | 'pre_conceal' | 'complete' | 'verification';
  why: string;
  required: boolean;
}> {
  const plan: Array<{
    phase: 'existing_condition' | 'in_progress' | 'pre_conceal' | 'complete' | 'verification';
    why: string;
    required: boolean;
  }> = [
    { phase: 'existing_condition', why: 'What was there before anyone touched it.', required: true },
    { phase: 'complete', why: 'The finished state, against the completion criteria.', required: true },
  ];

  if (task.expectedActions.length > 4) {
    plan.splice(1, 0, {
      phase: 'in_progress',
      why: 'A long action sequence is worth sampling mid-way — it is the only place the method is visible.',
      required: false,
    });
  }

  if (task.concealedBy) {
    plan.splice(plan.length - 1, 0, {
      phase: 'pre_conceal',
      why: `${task.concealedBy} covers this. After that the evidence cannot be re-created at any price.`,
      required: true,
    });
  }

  for (const requirement of task.verification) {
    if (requirement.required) {
      plan.push({ phase: 'verification', why: requirement.what, required: true });
      break;
    }
  }

  return plan;
}
