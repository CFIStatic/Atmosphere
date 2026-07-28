import type { LossAssessment, ScopeItem } from '../types.js';
import type { DamageFinding } from '../ingest/findings.js';
import type { SlaComplianceReport } from '../carrier/types.js';
import { formatCitation, type CitationId } from '../standards/s500.js';

/**
 * Mitigation requirements — what must be done, and why.
 *
 * Three authorities can oblige work on a water loss:
 *
 *   1. **IICRC / industry practice** (S500/S520) — how professionals mitigate.
 *   2. **Insurance / carrier program rules** — what the agreement and customary
 *      claim handling require before payment (documentation, timelines, caps).
 *   3. **Construction / building-code adjacent obligations** — health & safety
 *      and habitability issues that mitigation must address (containment when
 *      microbial growth is present, porous Cat 3 removal, etc.). These are
 *      stated at convention confidence unless a jurisdiction clause is cited.
 *
 * Requirements are *not* line items. They explain what the estimate must
 * cover; scope derivation fulfills them when findings + geometry support
 * quantities, and otherwise they surface as open questions.
 */

export type RequirementAuthority =
  | 'iicrc'
  | 'insurance'
  | 'construction_code'
  | 'carrier_sla';

export type RequirementStatus =
  | 'required'
  | 'recommended'
  | 'documentation_required'
  | 'undetermined';

export interface MitigationRequirement {
  id: string;
  authority: RequirementAuthority;
  status: RequirementStatus;
  title: string;
  detail: string;
  /** What scope / documentation would satisfy this. */
  action: string;
  /** Registry citation when IICRC-backed. */
  citationId?: CitationId;
  /** External pointer (code section, program rule id) when known. */
  sourceRef?: string;
  /** Finding ids that triggered this requirement. */
  findingIds: string[];
  /** True when current scope already addresses it. */
  addressed: boolean;
}

export function deriveRequirements(input: {
  assessment: LossAssessment;
  findings: DamageFinding[];
  scope: ScopeItem[];
  sla?: SlaComplianceReport | null;
}): MitigationRequirement[] {
  const { assessment, findings, scope, sla } = input;
  const reqs: MitigationRequirement[] = [];
  const scopeRules = new Set(scope.map((s) => s.rule));
  const scopeTags = new Set(scope.flatMap((s) => s.tags));
  let seq = 0;
  const id = (prefix: string) => `${prefix}-${(seq += 1)}`;

  const findingIds = (...kinds: DamageFinding['kind'][]) =>
    findings.filter((f) => kinds.includes(f.kind)).map((f) => f.id);

  const hasGeometry = assessment.rooms.some((r) => r.geometry.floorSF > 0);
  const hasMaterials = assessment.rooms.some((r) => r.materials.length > 0);

  /* ---- IICRC / industry mitigation obligations -------------------- */

  reqs.push({
    id: id('iicrc'),
    authority: 'iicrc',
    status: 'required',
    title: 'Bulk water extraction before evaporative drying',
    detail: `Standing water must be removed before drying equipment is relied on (${formatCitation('WATER_EXTRACTION_FIRST')}).`,
    action: hasMaterials
      ? 'Bill extraction against wet floor area in each affected room.'
      : 'Document which floors were wet and their area (or room dimensions + materials) so extraction can be quantified.',
    citationId: 'WATER_EXTRACTION_FIRST',
    findingIds: findingIds('water_intrusion', 'wet_material'),
    addressed: scopeRules.has('extraction') || scopeTags.has('extraction'),
  });

  if (assessment.category >= 2) {
    reqs.push({
      id: id('iicrc'),
      authority: 'iicrc',
      status: 'required',
      title: 'Antimicrobial application on Category 2+ losses',
      detail: `Category ${assessment.category} water requires antimicrobial treatment of affected surfaces.`,
      action: 'Apply and bill antimicrobial over affected floor (and wall cut) areas.',
      citationId: 'ANTIMICROBIAL_APPLICATION',
      findingIds: findingIds('contaminated_water', 'wet_material'),
      addressed: scopeTags.has('antimicrobial'),
    });
  }

  if (assessment.category === 3) {
    reqs.push({
      id: id('iicrc'),
      authority: 'iicrc',
      status: 'required',
      title: 'Remove porous materials contacted by Category 3 water',
      detail: `Porous materials contacted by Category 3 water cannot be restored to a sanitary condition and must be removed (${formatCitation('POROUS_MATERIAL_REMOVAL_CAT3')}).`,
      action: hasMaterials
        ? 'Tear out porous flooring, pad, and wet drywall to the required cut height.'
        : 'Caption photos / notes with materials (carpet, pad, drywall) and cut heights so demolition can be scoped.',
      citationId: 'POROUS_MATERIAL_REMOVAL_CAT3',
      findingIds: findingIds('contaminated_water', 'wet_material', 'demolition_performed'),
      addressed: [...scopeRules].some((r) => r.startsWith('tear_out') || r === 'flood_cut'),
    });
  }

  if (assessment.microbialGrowthPresent || assessment.category === 3) {
    reqs.push({
      id: id('iicrc'),
      authority: 'iicrc',
      status: 'required',
      title: 'Containment during demolition / remediation',
      detail: 'Containment isolates the work area and protects unaffected spaces during tear-out and remediation.',
      action: 'Build poly containment (and negative air when microbial growth is present); photograph it.',
      citationId: 'CONTAINMENT',
      findingIds: findingIds('microbial_growth', 'containment_built', 'contaminated_water'),
      addressed: scopeTags.has('containment') || assessment.containmentRequired,
    });
  }

  if (assessment.microbialGrowthPresent) {
    reqs.push({
      id: id('iicrc'),
      authority: 'iicrc',
      status: 'required',
      title: 'PPE for microbial / Category 3 work',
      detail: 'Technicians need appropriate PPE when microbial growth or Category 3 water is present.',
      action: 'Bill PPE per technician per day on site; photograph PPE in use.',
    citationId: 'WORKER_SAFETY_PPE',
    findingIds: findingIds('microbial_growth'),
    addressed: scopeTags.has('ppe'),
  });
  }

  reqs.push({
    id: id('iicrc'),
    authority: 'iicrc',
    status: assessment.equipment.length > 0 ? 'required' : 'undetermined',
    title: 'Engineered drying with monitored equipment',
    detail: `Drying equipment must be sized to the class of loss and monitored to a dry standard (${formatCitation('DRYING_VERIFICATION')}).`,
    action:
      assessment.equipment.length > 0
        ? 'Bill placed equipment days and monitoring labour from the log / notes.'
        : 'Record air movers, dehumidifiers, and scrubbers (counts + days) in notes or MICA so equipment can be billed.',
    citationId: 'DRYING_VERIFICATION',
    findingIds: findingIds('equipment_placed', 'water_intrusion'),
    addressed: scope.some((s) => s.tags.includes('equipment') || s.tags.includes('monitoring')),
  });

  /* ---- Insurance / customary claim-handling obligations ----------- */

  reqs.push({
    id: id('ins'),
    authority: 'insurance',
    status: 'documentation_required',
    title: 'Before-and-after photo documentation',
    detail:
      'Carriers expect dated before photos of affected areas and after photos of completed mitigation before paying demolition and drying lines.',
    action: 'Caption photos with room + material + before/after; ensure both stages exist.',
    sourceRef: 'customary_claim_documentation',
    findingIds: [],
    addressed:
      assessment.evidence.some((e) => e.tags.includes('before')) &&
      assessment.evidence.some((e) => e.tags.includes('after')),
  });

  reqs.push({
    id: id('ins'),
    authority: 'insurance',
    status: assessment.moistureReadings.length > 0 ? 'documentation_required' : 'undetermined',
    title: 'Moisture readings to a dry standard',
    detail:
      'Insurance review typically requires moisture readings against an unaffected dry standard to justify equipment days and completion.',
    action:
      assessment.moistureReadings.length > 0
        ? 'Attach the moisture log to the estimate package.'
        : 'Record meter readings by room/material (or upload MICA). Without them, equipment days are contested.',
    sourceRef: 'moisture_log_required',
    findingIds: [],
    addressed: assessment.moistureReadings.length > 0,
  });

  if (!hasGeometry) {
    reqs.push({
      id: id('ins'),
      authority: 'insurance',
      status: 'undetermined',
      title: 'Quantities need room dimensions or a sketch',
      detail:
        'Without measured or stated room sizes, demolition and extraction quantities cannot be defended to an adjuster.',
      action:
        'Add room dimensions in notes (e.g. "Kitchen 12x14") or upload a DocuSketch scan. Do not invent square footage.',
      sourceRef: 'quantity_basis',
      findingIds: findingIds('wet_material', 'demolition_performed'),
      addressed: false,
    });
  } else if (!hasMaterials) {
    reqs.push({
      id: id('ins'),
      authority: 'insurance',
      status: 'undetermined',
      title: 'Affected materials must be identified',
      detail:
        'Room sizes alone do not justify tear-out. The estimate needs which finishes were wet or removed.',
      action:
        'Name materials in notes/captions (carpet, pad, drywall, baseboard, etc.) and whether they came out.',
      sourceRef: 'material_identification',
      findingIds: findingIds('wet_material'),
      addressed: false,
    });
  }

  /* ---- Construction / health-safety adjacent ---------------------- */

  if (assessment.microbialGrowthPresent) {
    reqs.push({
      id: id('code'),
      authority: 'construction_code',
      status: 'required',
      title: 'Isolate microbial amplification before disturbance',
      detail:
        'Disturbing microbial growth without containment can contaminate adjacent spaces. Industry practice (and many local health guidelines) requires isolation before demolition.',
      action: 'Establish containment and negative air before flood cuts / tear-out; document with photos.',
      sourceRef: 'habitability_microbial_isolation',
      findingIds: findingIds('microbial_growth'),
      addressed: scopeTags.has('containment') || scopeTags.has('negative_pressure'),
    });
  }

  if (assessment.category === 3) {
    reqs.push({
      id: id('code'),
      authority: 'construction_code',
      status: 'required',
      title: 'Sanitize or remove surfaces exposed to sewage / Category 3',
      detail:
        'Surfaces exposed to grossly contaminated water present a health hazard until cleaned to a sanitary condition or removed. Porous finishes are removed; non-porous are cleaned and treated.',
      action: 'Remove porous finishes; clean and apply antimicrobial to remaining affected surfaces; photograph.',
      sourceRef: 'sanitary_condition_after_black_water',
      findingIds: findingIds('contaminated_water'),
      addressed: scopeTags.has('antimicrobial') && (scopeTags.has('tear_out') || scopeTags.has('hepa')),
    });
  }

  if (findings.some((f) => f.kind === 'structural_concern')) {
    reqs.push({
      id: id('code'),
      authority: 'construction_code',
      status: 'recommended',
      title: 'Structural review before rebuild',
      detail: 'Documented structural concerns should be evaluated before covering assemblies.',
      action: 'Flag for structural / rebuild scope; do not conceal with finishes during mitigation.',
      sourceRef: 'structural_review',
      findingIds: findingIds('structural_concern'),
      addressed: false,
    });
  }

  /* ---- Carrier SLA → documentation / term obligations ------------- */

  if (sla?.agreement) {
    for (const check of sla.checks) {
      // SlaCheck.status uses met / violated / deviation_documented / … — not
      // "satisfied"/"waived". Skip anything already inside program terms.
      if (
        check.status === 'met' ||
        check.status === 'not_applicable' ||
        check.status === 'deviation_documented'
      ) {
        continue;
      }
      reqs.push({
        id: id('sla'),
        authority: 'carrier_sla',
        status: check.status === 'undetermined' ? 'undetermined' : 'documentation_required',
        title: check.title,
        detail: check.detail,
        // MitigationRequirement.action ← SlaCheck.remedy (not remediation).
        action: check.remedy ?? 'Bring the estimate inside the program term or record a documented deviation.',
        sourceRef: check.ruleId,
        findingIds: [],
        addressed: false,
      });
    }
  } else if (!assessment.carrier) {
    reqs.push({
      id: id('sla'),
      authority: 'carrier_sla',
      status: 'undetermined',
      title: 'Carrier / program not identified',
      detail:
        'Without a carrier, program-specific price lists, O&P rules, and documentation SLAs cannot be applied.',
      action: 'State the carrier in notes or overrides (e.g. "carrier: State Farm") so program terms can load.',
      sourceRef: 'carrier_identification',
      findingIds: [],
      addressed: false,
    });
  }

  return reqs;
}
