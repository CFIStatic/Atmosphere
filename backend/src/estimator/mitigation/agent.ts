import { normalizeSources, type EstimatorSources } from './ingest/index.js';
import { deriveScope, DEFAULT_SCOPE_OPTIONS, type ScopeOptions } from './rules/scope.js';
import { mapScopeToLineItems } from './rules/mapping.js';
import { CATALOG, type CatalogItem } from './catalog/lineItems.js';
import { DEFAULT_COST_BASIS, type CostBasis, type PriceList } from './catalog/priceList.js';
import { DEFAULT_PRICING_OPTIONS, type PricingOptions } from './pricing.js';
import { reviewProfitability } from './profitability.js';
import { gppDifferential, sizeAirMovers, sizeDehumidification } from './lib/psychrometrics.js';
import { cubicFeet, round } from './lib/geometry.js';
import { reviewCompliance } from './standards/compliance.js';
import { caveatsFor, formatCitation, referencesFor, type CitationId } from './standards/s500.js';
import { identifyCarrier, type IdentifyOptions } from './carrier/identify.js';
import { applyAgreementToPricing, checkAgreement } from './carrier/sla.js';
import type { ProgramAgreement, SlaDeviation } from './carrier/types.js';
import { deriveRequirements } from './requirements/obligations.js';
import type { LossAssessment, MitigationEstimate, ScopeItem } from './types.js';

/**
 * The Mitigation Estimator agent.
 *
 * One deterministic pipeline, start to finish:
 *
 *   sources → assessment → scope → line items → pricing → profitability review
 *
 * Deterministic is the point. Given the same DocuSketch scan, MICA report,
 * photos and notes, this produces byte-identical output — which means an
 * estimate can be re-run in front of an adjuster, and a disputed number can be
 * traced back through the line item to the scope rule to the reading that
 * produced it. A model that improvises line items cannot do that, and an
 * estimate you cannot defend line-by-line is one you will end up negotiating
 * away.
 */

export interface EstimatorConfig {
  scope: ScopeOptions;
  pricing: PricingOptions;
  costBasis: CostBasis;
  /** The account's real price list, once synced. Null means placeholder pricing. */
  priceList: PriceList | null;
  /**
   * Working catalog built from the account price list (selectors + prices) with
   * knowledge profiles supplying tags and evidence gates. Falls back to unverified
   * knowledge defaults when no list is connected.
   */
  catalog: readonly CatalogItem[];
  lineMarginFloor: number;
  /**
   * Human-picked account codes, keyed by knowledge catalog key or scope item id.
   * Always beat automatic resolution during mapping.
   */
  codeOverrides?: Record<string, string>;

  /**
   * The carrier program agreement this job falls under, when one is loaded.
   *
   * Null is a valid, common state — plenty of work is written outside a program
   * — and the estimate says so rather than quietly applying the org's own
   * settings as though they were the carrier's.
   */
  agreement?: ProgramAgreement | null;
  /** Deviations a human has accepted for this job. */
  deviations?: SlaDeviation[];
  /** Overrides and extra carriers for identification. */
  carrier?: IdentifyOptions;
}

export const DEFAULT_ESTIMATOR_CONFIG: EstimatorConfig = {
  scope: DEFAULT_SCOPE_OPTIONS,
  pricing: DEFAULT_PRICING_OPTIONS,
  costBasis: DEFAULT_COST_BASIS,
  priceList: null,
  catalog: CATALOG,
  lineMarginFloor: 0.25,
  agreement: null,
  deviations: [],
};

export function buildEstimate(
  sources: EstimatorSources,
  config: EstimatorConfig = DEFAULT_ESTIMATOR_CONFIG,
): MitigationEstimate {
  const assessment = normalizeSources(sources);
  const identification = identifyCarrier(assessment, config.carrier ?? {});
  const agreement = config.agreement ?? null;

  // Program pricing terms are applied *before* anything is priced. Building a
  // non-compliant estimate and correcting it afterwards would leave the wrong
  // numbers in every intermediate the reviewer reads.
  const applied = applyAgreementToPricing(config.pricing, agreement);

  const scope = deriveScope(assessment, config.scope);

  const { lineItems, unmapped } = mapScopeToLineItems(scope, {
    rooms: assessment.rooms,
    priceList: config.priceList,
    costBasis: config.costBasis,
    catalog: config.catalog,
    codeOverrides: config.codeOverrides,
  });

  // A negotiated concession is a real reduction in what the carrier pays, so it
  // is applied to the line prices themselves — not netted off the total, which
  // would leave every line on the page disagreeing with the bottom of it.
  if (applied.discountPct > 0) {
    for (const line of lineItems) {
      if (applied.discountPct <= 0) break;
      line.unitPrice = round(line.unitPrice * (1 - applied.discountPct));
      line.rcv = round(line.quantity * line.unitPrice);
    }
  }

  const profitability = reviewProfitability(assessment, scope, lineItems, {
    pricing: applied.pricing,
    costBasis: config.costBasis,
    priceList: config.priceList,
    catalog: config.catalog,
    lineMarginFloor: config.lineMarginFloor,
  });

  // Read the finished estimate back against the standards. The profitability
  // review asks what is unbilled; this asks what is indefensible — and the two
  // overlap constantly, because the obligations a job skipped are usually
  // obligations it also failed to bill for.
  const compliance = reviewCompliance(assessment, scope, lineItems);

  const sla = checkAgreement({
    assessment,
    lineItems,
    profitability,
    identification,
    agreement,
    deviations: config.deviations,
    actualPriceListId: config.priceList?.id ?? null,
  });

  // Everything cited anywhere: the scope rules, the line items, and the
  // compliance checks. This is the appendix a reader turns to with their own
  // copy of the standard open.
  const cited: CitationId[] = [
    ...scope.flatMap((item) => item.citations),
    ...lineItems.flatMap((line) => line.citations),
    ...compliance.citations,
  ];

  const requirements = deriveRequirements({
    assessment,
    findings: assessment.findings,
    scope,
    sla,
  });

  return {
    jobId: assessment.jobId,
    generatedAt: new Date().toISOString(),
    assessment,
    scope,
    lineItems,
    profitability,
    compliance,
    sla,
    references: referencesFor(cited),
    requirements,
    narrative: writeNarrative(assessment, lineItems.length),
    openQuestions: collectOpenQuestions(assessment, scope, unmapped, config, compliance, cited, sla, applied.notes),
  };
}

/* ------------------------------------------------------------------ *
 * Narrative
 * ------------------------------------------------------------------ */

/**
 * The estimate header, written for the adjuster who will read it in ninety
 * seconds. It states the classification and *why*, because a classification
 * without its reasoning is the thing that gets argued with.
 */
function writeNarrative(assessment: LossAssessment, lineCount: number): string {
  const rooms = assessment.rooms.length;
  const totalSF = round(assessment.rooms.reduce((sum, room) => sum + room.geometry.floorSF, 0));
  const affectedSF = round(
    assessment.rooms.reduce((sum, room) => sum + room.geometry.floorSF * room.affectedFloorFraction, 0),
  );

  const parts: string[] = [];

  parts.push(
    `${describeCause(assessment.cause)} affected ${rooms} room${rooms === 1 ? '' : 's'} totalling ${totalSF} SF, of which ${affectedSF} SF was water-affected.`,
  );

  if (assessment.category > assessment.sourceCategory) {
    parts.push(
      `The water was Category ${assessment.sourceCategory} at the source but was scoped as Category ${assessment.category}: it stood long enough before mitigation began for its condition to deteriorate (${formatCitation('CATEGORY_DEGRADATION')}).`,
    );
  } else {
    parts.push(`Water was classified as Category ${assessment.category} at the source.`);
  }

  parts.push(
    `The loss was assessed as Class ${assessment.class} — ${describeClass(assessment.class)}. ${describeDehuBasis(assessment)}`,
  );

  const differential = gppDifferential(assessment.psychrometrics);
  if (differential !== null) {
    parts.push(
      differential > 0
        ? `Psychrometric logging shows the affected air ${differential} GPP drier than the unaffected control, confirming the drying system was pulling moisture out of the structure.`
        : `Psychrometric logging shows the affected air was not measurably drier than the unaffected control (${differential} GPP), which is why additional dehumidification was warranted.`,
    );
  }

  if (assessment.microbialGrowthPresent) {
    parts.push(
      'Microbial growth was documented, so demolition was performed inside containment under negative pressure with full PPE.',
    );
  }

  parts.push(
    `Drying ran ${assessment.dryingDays} day${assessment.dryingDays === 1 ? '' : 's'} across ${assessment.monitoringVisits} documented monitoring visit${assessment.monitoringVisits === 1 ? '' : 's'}, supported by ${assessment.moistureReadings.length} moisture readings and ${assessment.evidence.filter((e) => e.kind === 'photo').length} photographs. The estimate carries ${lineCount} line items, each tied to that documentation.`,
  );

  return parts.join(' ');
}

function describeCause(cause: LossAssessment['cause']): string {
  const map: Record<LossAssessment['cause'], string> = {
    supply_line: 'A failed water supply line',
    water_heater: 'A failed water heater',
    appliance: 'An appliance discharge',
    toilet_overflow: 'A toilet overflow',
    sewage_backup: 'A sewage backup',
    roof_leak: 'A roof leak',
    storm_flood: 'Storm-driven flooding',
    sprinkler: 'A fire-sprinkler discharge',
    hvac_condensate: 'An HVAC condensate failure',
    unknown: 'A water intrusion of undetermined origin',
  };
  return map[cause];
}

function describeClass(waterClass: number): string {
  switch (waterClass) {
    case 1:
      return 'minimal absorption into low-evaporation materials, under 5% of the combined surface area';
    case 2:
      return 'water absorbed into 5–40% of the combined surface area';
    case 3:
      return 'water absorbed into more than 40% of the combined surface area, generally released from overhead';
    default:
      return 'deeply held moisture in low-evaporation materials requiring specialty low-humidity drying';
  }
}

/** State the dehumidification calculation on the estimate so it is not disputed. */
function describeDehuBasis(assessment: LossAssessment): string {
  const affectedCF = round(
    assessment.rooms.reduce((sum, room) => sum + cubicFeet(room.geometry) * room.affectedFloorFraction, 0),
  );
  if (affectedCF <= 0) return '';

  const sizing = sizeDehumidification(affectedCF, assessment.class);
  return `Dehumidification was sized from ${affectedCF} affected cubic feet at the Class ${assessment.class} LGR factor of ${sizing.factor}, requiring ${sizing.requiredPintsPerDay} AHAM pints per day — ${sizing.unitsRequired} unit${sizing.unitsRequired === 1 ? '' : 's'} minimum (${formatCitation('DEHUMIDIFICATION_SIZING')}).`;
}

/* ------------------------------------------------------------------ *
 * Open questions
 * ------------------------------------------------------------------ */

/**
 * What the agent could not decide on its own.
 *
 * These are surfaced rather than resolved by assumption. A wrong guess about a
 * water category or a missing scan changes thousands of dollars of scope, and it
 * changes it in a way that is invisible on the finished page — so the question
 * goes to the estimator instead.
 */
function collectOpenQuestions(
  assessment: LossAssessment,
  scope: ScopeItem[],
  unmapped: ScopeItem[],
  config: EstimatorConfig,
  compliance: ReturnType<typeof reviewCompliance>,
  cited: CitationId[],
  sla: ReturnType<typeof checkAgreement>,
  pricingNotes: string[],
): string[] {
  const questions: string[] = [];

  // Program terms lead everything else. An estimate that breaches its agreement
  // does not get paid, however well it is scoped and however well it cites.
  for (const check of sla.checks) {
    if (check.status === 'met' || check.status === 'not_applicable') continue;
    const prefix =
      check.status === 'violated'
        ? 'Program term not met'
        : check.status === 'approval_required'
          ? 'Program approval needed'
          : check.status === 'deviation_documented'
            ? 'Program term exceeded, documented'
            : 'Program term unverified';
    questions.push(
      `${prefix} — ${check.title}: ${check.detail}${check.remedy ? ` ${check.remedy}` : ''}${check.sourceRef ? ` (${check.sourceRef})` : ''}`,
    );
  }

  for (const proposal of sla.proposedDeviations) {
    questions.push(
      `A documented deviation looks available for "${sla.agreement?.rules.find((r) => r.id === proposal.ruleId)?.title ?? proposal.ruleId}": ${proposal.reason} Accept it to put that reasoning on the estimate — the agent will not agree to exceed a carrier's terms on your behalf.`,
    );
  }

  questions.push(...pricingNotes);

  if (sla.identification.confidence === 'inferred') {
    questions.push(
      `The carrier was inferred rather than stated — ${sla.identification.basis.join('; ')}. Confirm it, because it selects the price list and the terms for the whole job.`,
    );
  }
  if (sla.identification.alternatives.length > 0) {
    questions.push(
      `More than one carrier appears in the sources: ${sla.identification.alternatives.map((a) => a.carrierName).join(', ')}. Confirm which one this estimate is for.`,
    );
  }

  // Unmet obligations lead, because they are the ones that cost the job twice —
  // once when the work goes unbilled and again when the estimate is challenged.
  for (const check of compliance.checks) {
    if (check.status === 'met' || check.status === 'not_applicable') continue;
    questions.push(
      `${check.title} — ${check.detail}${check.remedy ? ` ${check.remedy}` : ''} (${formatCitation(check.citation)})`,
    );
  }

  // Where a citation the estimate relies on is convention rather than a clause,
  // say so here. An estimator arguing a scope with an adjuster is far better off
  // knowing which of their citations is a requirement and which is custom.
  for (const { title, caveat } of caveatsFor(cited)) {
    questions.push(`On "${title}": ${caveat}`);
  }

  if (!assessment.sourcesUsed.includes('docusketch')) {
    questions.push(
      'No DocuSketch scan was supplied. Room geometry drives nearly every quantity on this estimate — confirm the dimensions before submitting.',
    );
  }
  if (!assessment.sourcesUsed.includes('mica')) {
    questions.push(
      'No MICA report was supplied, so equipment days and monitoring visits were inferred rather than read from the drying log. These are the highest-value quantities on a mitigation estimate.',
    );
  }
  if (!assessment.sourcesUsed.includes('photos')) {
    questions.push(
      'No photos were supplied. Demolition and equipment lines will be flagged as undocumented and are the ones adjusters strike first.',
    );
  }
  if (!assessment.dateOfLoss) {
    questions.push(
      'The date of loss is unknown, so water-category degradation could not be applied. If the water stood more than 48 hours, the category — and the demolition scope — changes.',
    );
  }
  if (!config.priceList) {
    questions.push(
      'No Xactimate price list is connected. Every price on this estimate is a placeholder; connect the account and sync before submitting.',
    );
  }

  // Rooms where the documented equipment falls short of what the class demands.
  for (const room of assessment.rooms) {
    const wetFloorSF = room.geometry.floorSF * room.affectedFloorFraction;
    if (wetFloorSF <= 0) continue;

    // Baseboard alone does not make a wall wet — trim wicks at the very base of
    // an otherwise dry assembly. Counting it would demand wall coverage in every
    // room with trim and flag half the job as under-equipped.
    const wetWallAssembly = room.materials.some(
      (m) => m.surface === 'wall' && m.material !== 'baseboard' && m.material !== 'cabinetry',
    );

    // The wet wall band is the perimeter times the height moisture reached, not
    // the whole wall — a 14-inch wet line on a 9-foot wall is a sixth of it.
    const wetBandFt = wetWallAssembly
      ? Math.max(
          ...room.materials
            .filter((m) => m.surface === 'wall' && m.material !== 'baseboard' && m.material !== 'cabinetry')
            .map((m) => (m.wetHeightIn ?? 24) / 12),
        )
      : 0;

    const required = sizeAirMovers({
      wetFloorSF,
      wetWallLF: wetWallAssembly ? room.geometry.perimeterLF : 0,
      wetWallSF: round(room.geometry.perimeterLF * wetBandFt),
      wetCeilingSF: room.ceilingAffected ? room.geometry.ceilingSF : 0,
      offsets: room.geometry.offsets,
    });

    const placed = assessment.equipment
      .filter((e) => e.roomId === room.id && e.kind.includes('air_mover'))
      .reduce((sum, e) => sum + e.quantity, 0);

    if (placed > 0 && placed < required) {
      questions.push(
        `${room.name} shows ${placed} air movers placed where the coverage figures call for ${required} (${formatCitation('AIRFLOW_SIZING')}). Either the log is incomplete — in which case there are unbilled equipment days — or the room dried under-equipped and that should be noted.`,
      );
    }
  }

  // A flood cut rounds up to the next framing division, so a wet line just over
  // 12 inches lands at a 48-inch cut. That is defensible and it is also a large
  // jump in both demolition and rebuild, so it gets confirmed rather than
  // assumed — over-scoping is how an estimate gets re-priced.
  for (const item of scope.filter((s) => s.rule === 'flood_cut')) {
    const room = assessment.rooms.find((r) => r.id === item.roomId);
    if (room?.documentedCutHeightIn) continue; // the crew wrote it down; nothing to confirm

    const cutHeight = Number(item.description.match(/to (\d+)"/)?.[1] ?? 0);
    if (cutHeight > 24) {
      questions.push(
        `${item.description} — the cut rounds up to the next framing division. Confirm the crew cut at ${cutHeight}" and not 24", because it changes both the demolition and the rebuild.`,
      );
    }
  }

  for (const item of unmapped) {
    questions.push(
      `No catalog entry covers "${item.description}" (${item.quantity} ${item.unit}). Add the matching Xactimate code by hand, or extend the catalog mapping.`,
    );
  }

  if (scope.length === 0) {
    questions.push(
      'The sources did not describe any affected materials, so no scope could be derived. Check that the DocuSketch export includes affected-material flags.',
    );
  }

  return [...new Set([...questions, ...assessment.warnings])];
}

/**
 * Identify the carrier without building a full estimate.
 *
 * Routes need this before they can load the right program agreement, and the
 * agreement has to be in hand before the estimate is priced. Normalising the
 * sources twice is cheap and deterministic, and it keeps the carrier out of
 * `buildEstimate`'s signature as a pre-computed argument only a caller who
 * already knew the answer could supply.
 */
export function identifyFromSources(
  sources: EstimatorSources,
  options: IdentifyOptions = {},
): ReturnType<typeof identifyCarrier> {
  return identifyCarrier(normalizeSources(sources), options);
}
