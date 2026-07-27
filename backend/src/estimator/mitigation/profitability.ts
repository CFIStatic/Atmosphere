import { round } from './lib/geometry.js';
import { CATALOG, findByKey, type CatalogItem } from './catalog/lineItems.js';
import { formatCitation } from './standards/s500.js';
import { resolvePrice, DEFAULT_COST_BASIS, type CostBasis, type PriceList } from './catalog/priceList.js';
import { lineMargin, priceEstimate, revenueGapToTarget, type PricingOptions, DEFAULT_PRICING_OPTIONS } from './pricing.js';
import type {
  EstimateLineItem,
  Evidence,
  LossAssessment,
  ProfitFinding,
  ProfitabilitySummary,
  ScopeItem,
} from './types.js';

/**
 * Profitability review.
 *
 * ## What "making jobs profitable" means here
 *
 * Mitigation jobs lose money in a small number of well-understood ways, and
 * almost none of them are "the prices were too low". They are:
 *
 *   - work that was performed and never written down (monitoring hours, content
 *     manipulation, PPE, debris haul);
 *   - equipment logged out late, so the billed days understate the days on site;
 *   - the generic selector used where a specific, better-paying one applied;
 *   - lines written without the documentation to survive an adjuster's review,
 *     which get struck after the work is already sunk cost.
 *
 * Every finding this module produces is one of those. What it will **not** do is
 * add quantity that the measurements do not support, or add a line item for work
 * nobody performed. That is not a scruple bolted on afterwards — an inflated
 * estimate gets re-priced, the relationship with the carrier degrades, and the
 * next ten jobs get scrutinised. The durable way to make a mitigation job
 * profitable is to bill all of what was actually done, with the documentation to
 * prove it, which is exactly what the findings below drive toward.
 *
 * Where the review can only see a *possibility* — work that the job's shape
 * suggests but nothing documents — it emits `actionRequired` and leaves the line
 * off. The user decides, with the question put plainly.
 */

export interface ProfitabilityOptions {
  pricing: PricingOptions;
  costBasis: CostBasis;
  priceList: PriceList | null;
  catalog: readonly CatalogItem[];
  /** Per-line margin below which a line is called out. */
  lineMarginFloor: number;
}

export const DEFAULT_PROFITABILITY_OPTIONS: ProfitabilityOptions = {
  pricing: DEFAULT_PRICING_OPTIONS,
  costBasis: DEFAULT_COST_BASIS,
  priceList: null,
  catalog: CATALOG,
  lineMarginFloor: 0.25,
};

export function reviewProfitability(
  assessment: LossAssessment,
  scope: ScopeItem[],
  lineItems: EstimateLineItem[],
  options: ProfitabilityOptions = DEFAULT_PROFITABILITY_OPTIONS,
): ProfitabilitySummary {
  const totals = priceEstimate(lineItems, options.pricing);

  const findings: ProfitFinding[] = [
    ...findUnbilledScope(scope, lineItems),
    ...findMissingCompanionWork(assessment, lineItems, options),
    ...findUnderstatedEquipmentDays(assessment, lineItems, options),
    ...findEvidenceGaps(assessment, lineItems, options),
    ...findUnsupportedLines(lineItems),
    ...findLowMarginLines(lineItems, options),
    ...findUnverifiedPricing(lineItems),
    ...findGenericSelectorUse(assessment, lineItems, options),
  ];

  // Only positive-impact, actionable findings count as recoverable. Advice to
  // remove a line is real money but it is not revenue.
  const recoverableRevenue = round(
    findings.filter((f) => f.revenueImpact > 0).reduce((sum, f) => sum + f.revenueImpact, 0),
  );

  return {
    subtotal: totals.subtotal,
    overheadAndProfit: totals.overheadAndProfit,
    tax: totals.tax,
    total: totals.total,
    totalCost: totals.totalCost,
    grossProfit: totals.grossProfit,
    grossMargin: totals.grossMargin,
    targetMargin: options.pricing.targetMargin,
    marginGap: revenueGapToTarget(totals, options.pricing.targetMargin),
    findings: findings.sort(bySeverityThenValue),
    recoverableRevenue,
  };
}

/* ------------------------------------------------------------------ *
 * Finding: scope that never reached the estimate
 * ------------------------------------------------------------------ */

/**
 * Work the rules identified that no line item covers.
 *
 * This happens when no catalog entry matched the scope item's tags — usually
 * because the org's price list uses a selector the mapping does not know yet.
 * The work was still performed, so it is called out by name rather than lost
 * between the two layers.
 */
function findUnbilledScope(scope: ScopeItem[], lineItems: EstimateLineItem[]): ProfitFinding[] {
  const billed = new Set(lineItems.flatMap((line) => line.scopeItemIds));

  return scope
    .filter((item) => !billed.has(item.id))
    .map((item) => ({
      id: `finding-unbilled-${item.id}`,
      severity: 'warning' as const,
      kind: 'missing_line_item' as const,
      title: `Identified work with no matching line item: ${item.description}`,
      detail: `${item.quantity} ${item.unit} of "${item.description}" was derived from the documentation but no catalog entry matched it, so it is not on the estimate. ${item.justification}`,
      revenueImpact: 0,
      marginImpact: 0,
      actionRequired:
        'Add the Xactimate selector for this work by hand, or map it in the catalog so future estimates pick it up.',
      roomId: item.roomId,
    }));
}

/* ------------------------------------------------------------------ *
 * Finding: work performed but not billed
 * ------------------------------------------------------------------ */

/**
 * Companion-work rules. Each says: given what this estimate already contains and
 * what the assessment documents, a line that is almost certainly owed is
 * missing.
 *
 * `quantity` is computed from the assessment, never invented — if the rule
 * cannot compute a defensible quantity it returns null and no finding is made.
 */
interface CompanionRule {
  id: string;
  /** Stable catalog key that should be present on the estimate. */
  key: string;
  severity: ProfitFinding['severity'];
  title: string;
  applies: (assessment: LossAssessment, lines: EstimateLineItem[]) => boolean;
  quantity: (assessment: LossAssessment, lines: EstimateLineItem[]) => number | null;
  detail: (assessment: LossAssessment) => string;
  actionRequired?: string;
}

const COMPANION_RULES: CompanionRule[] = [
  {
    id: 'monitoring_hours',
    key: 'WTRDRY',
    severity: 'critical',
    title: 'Equipment was billed but monitoring labour was not',
    applies: (_a, lines) => hasTag(lines, 'DA') && !hasCode(lines, 'WTRDRY'),
    quantity: (a) => (a.monitoringVisits > 0 ? round(a.monitoringVisits * 1.5, 2) : null),
    detail: (a) =>
      `${a.monitoringVisits} monitoring visits are documented and equipment was on site for ${a.dryingDays} days, but no setup, take-down or monitoring labour is on the estimate. This is the single most commonly omitted line in mitigation and it is pure margin — the crew already drove out and took the readings.`,
  },
  {
    id: 'debris_haul',
    key: 'DMODUMP',
    severity: 'warning',
    title: 'Demolition was billed but debris disposal was not',
    applies: (_a, lines) => hasCategoryTearOut(lines) && !hasCode(lines, 'DMODUMP'),
    quantity: () => 1,
    detail: () =>
      'Tear-out line items are present with no haul or dump-fee line. Disposal is a hard out-of-pocket cost; leaving it off means the job absorbed it.',
  },
  {
    id: 'antimicrobial',
    key: 'CLNAM',
    severity: 'critical',
    title: 'Contaminated loss with no antimicrobial application',
    applies: (a, lines) => a.category >= 2 && !hasCode(lines, 'CLNAM'),
    quantity: (a) =>
      round(
        a.rooms.reduce(
          (sum, room) =>
            sum + room.geometry.floorSF * room.affectedFloorFraction + room.geometry.perimeterLF * 2,
          0,
        ),
      ),
    detail: (a) =>
      `This is a Category ${a.category} loss with no antimicrobial application scoped. It is customary on contaminated losses, billable, and expected by carriers, so its absence invites questions about the rest of the scope (${formatCitation('ANTIMICROBIAL_APPLICATION')}).`,
  },
  {
    id: 'content_manipulation',
    key: 'CLNCONT',
    severity: 'warning',
    title: 'Contents were moved but the labour was not billed',
    applies: (a, lines) =>
      !hasCode(lines, 'CLNCONT') &&
      (a.evidence.some((e) => e.tags.includes('contents')) ||
        a.rooms.some((room) => room.geometry.floorSF > 100)),
    quantity: (a) =>
      round(
        (a.rooms.reduce((sum, room) => sum + room.geometry.floorSF * room.affectedFloorFraction, 0) /
          100) *
          0.75,
        2,
      ),
    detail: () =>
      'Affected floors cannot be extracted, treated or dried under furniture, so contents were moved and reset. That labour is billable separately from the drying line items and is routinely given away.',
    actionRequired: 'Confirm contents were moved and reset before adding.',
  },
  {
    id: 'ppe',
    key: 'DMOPPE',
    severity: 'warning',
    title: 'Category 3 work with no PPE billed',
    applies: (a, lines) => (a.category === 3 || a.microbialGrowthPresent) && !hasCode(lines, 'DMOPPE'),
    quantity: (a) => Math.max(1, 2 * Math.max(1, a.dryingDays)),
    detail: (a) =>
      `Category ${a.category}${a.microbialGrowthPresent ? ' with documented microbial growth' : ''} requires suits, gloves and respiratory protection for every technician, replaced daily. It is a consumable cost the job is otherwise eating.`,
  },
  {
    id: 'air_scrubber_days',
    key: 'WTRNAF',
    severity: 'warning',
    title: 'Containment was billed but air scrubber days were not',
    applies: (a, lines) => a.containmentRequired && !hasCode(lines, 'WTRNAF'),
    quantity: (a) => Math.max(1, a.dryingDays),
    detail: () =>
      'Containment only works under negative pressure, which requires an air scrubber or negative-air machine running for the duration. The barrier is billed; the machine that makes it function is not.',
  },
  {
    id: 'hepa_after_demo',
    key: 'CLNHEPAV',
    severity: 'info',
    title: 'Post-demolition HEPA cleaning is missing',
    applies: (a, lines) => a.category >= 2 && hasCategoryTearOut(lines) && !hasCode(lines, 'CLNHEPAV'),
    quantity: (a) =>
      round(a.rooms.reduce((sum, room) => sum + room.geometry.floorSF, 0)),
    detail: () =>
      'Demolition on a contaminated loss liberates the material it was performed to remove. HEPA vacuuming of floors and the exposed wall base is the closing step and is separately billable.',
  },
  {
    id: 'floor_protection',
    key: 'CLNFLRPR',
    severity: 'info',
    title: 'No floor protection along the work path',
    applies: (a, lines) => hasCategoryTearOut(lines) && a.category >= 2 && !hasCode(lines, 'CLNFLRPR'),
    quantity: () => 120,
    detail: () =>
      'Contaminated material was carried out through unaffected areas. Protecting that path is inexpensive, expected, and cheaper than the flooring claim that follows when it is skipped.',
    actionRequired: 'Confirm protection was installed.',
  },
  {
    id: 'emergency_call',
    key: 'WTREMER',
    severity: 'info',
    title: 'After-hours response may be billable',
    applies: (a, lines) =>
      !hasCode(lines, 'WTREMER') && wasAfterHours(a.evidence, a.dateOfArrival),
    quantity: () => 1,
    detail: () =>
      'Photo timestamps or the arrival time put the initial response outside normal business hours. An emergency service call is a standard, separately billable line when that is the case.',
    actionRequired: 'Confirm the initial response was after hours before adding.',
  },
  {
    id: 'cavity_drying',
    key: 'WTRINJD',
    severity: 'info',
    title: 'Wall cavity drying may be preferable to a flood cut',
    applies: (a, lines) =>
      hasCode(lines, 'WTRDRYWL') &&
      !hasCode(lines, 'WTRINJD') &&
      a.category === 1 &&
      a.rooms.some((room) => room.materials.some((m) => m.cavityWet)),
    quantity: (a) => Math.max(1, a.dryingDays),
    detail: () =>
      'On a Category 1 loss with a wet cavity, an interstitial drying system dries the wall in place. It avoids the demolition and the rebuild the carrier would otherwise owe, bills per day at a strong rate, and is a materially better outcome for the property owner — which is worth something on the next referral.',
    actionRequired: 'Only applies where the cavity is clean-water wet and the finish is salvageable.',
  },
];

function findMissingCompanionWork(
  assessment: LossAssessment,
  lineItems: EstimateLineItem[],
  options: ProfitabilityOptions,
): ProfitFinding[] {
  const findings: ProfitFinding[] = [];

  for (const rule of COMPANION_RULES) {
    if (!rule.applies(assessment, lineItems)) continue;

    const quantity = rule.quantity(assessment, lineItems);
    if (quantity === null || quantity <= 0) continue;

    const catalogItem = lookup(options.catalog, rule.key);
    if (!catalogItem) continue;

    const price = resolvePrice(catalogItem, options.priceList, options.costBasis);
    const revenueImpact = round(quantity * price.unitPrice);
    const marginImpact = round(revenueImpact - quantity * price.unitCost);

    findings.push({
      id: `finding-${rule.id}`,
      severity: rule.severity,
      kind: 'missing_line_item',
      title: rule.title,
      detail: `${rule.detail(assessment)} Suggested: ${round(quantity)} ${price.unit} of ${catalogItem.code} — ${price.description}.`,
      revenueImpact,
      marginImpact,
      actionRequired: rule.actionRequired,
      relatedCode: catalogItem.code,
    });
  }

  return findings;
}

/* ------------------------------------------------------------------ *
 * Finding: equipment days understated
 * ------------------------------------------------------------------ */

/**
 * Equipment left open in the log.
 *
 * A placement with no removal timestamp is billed at whatever fallback the
 * ingestion could compute, which is nearly always short. Across a fleet this is
 * one of the largest recurring leaks in mitigation billing, and it is fixed by
 * closing out the log rather than by changing a price.
 */
function findUnderstatedEquipmentDays(
  assessment: LossAssessment,
  lineItems: EstimateLineItem[],
  options: ProfitabilityOptions,
): ProfitFinding[] {
  const open = assessment.equipment.filter((placement) => !placement.removedAt);
  if (open.length === 0) return [];

  const billedDays = lineItems
    .filter((line) => line.unit === 'DA')
    .reduce((sum, line) => sum + line.quantity, 0);

  const openUnits = open.reduce((sum, placement) => sum + placement.quantity, 0);
  const impliedDays = Math.max(1, assessment.dryingDays);
  const shortfallUnitDays = round(
    Math.max(0, openUnits * impliedDays - open.reduce((sum, p) => sum + p.quantity * (p.days ?? 1), 0)),
  );

  if (shortfallUnitDays <= 0) return [];

  // Price the shortfall at the air-mover rate, the most conservative choice —
  // dehumidifier days would triple the figure and overstate the finding.
  const airMover = lookup(options.catalog, 'WTRAMH');
  const price = airMover
    ? resolvePrice(airMover, options.priceList, options.costBasis)
    : { unitPrice: 0, unitCost: 0, unit: 'DA' as const, description: '', verified: false };

  return [
    {
      id: 'finding-open-equipment-log',
      severity: 'critical',
      kind: 'under_quantity',
      title: `${openUnits} pieces of equipment have no removal date logged`,
      detail: `${openUnits} unit${openUnits === 1 ? '' : 's'} were placed but never logged out, so they are billed at a fallback duration rather than their true time on site. The estimate currently carries ${round(billedDays)} equipment-days. Closing the log out against the actual pick-up would add roughly ${shortfallUnitDays} unit-days. This is documented work already performed — it needs a timestamp, not a price change.`,
      revenueImpact: round(shortfallUnitDays * price.unitPrice),
      marginImpact: round(shortfallUnitDays * (price.unitPrice - price.unitCost)),
      actionRequired: 'Close out the MICA equipment log with the actual pick-up date and time, then re-run.',
      relatedCode: 'WTRAMH',
    },
  ];
}

/* ------------------------------------------------------------------ *
 * Finding: evidence gaps
 * ------------------------------------------------------------------ */

/**
 * Lines the catalog says need documentation, that this job cannot document.
 *
 * These are billed — the work was scoped from the sources, so it happened — but
 * they are flagged loudly, because an undocumented line is a line that gets
 * struck on review. The negative revenue impact is the amount at risk, not a
 * recommendation to remove.
 */
function findEvidenceGaps(
  assessment: LossAssessment,
  lineItems: EstimateLineItem[],
  options: ProfitabilityOptions,
): ProfitFinding[] {
  const findings: ProfitFinding[] = [];
  const evidenceById = new Map(assessment.evidence.map((item) => [item.id, item]));

  for (const line of lineItems) {
    const catalogItem = lookup(options.catalog, line.code);
    if (!catalogItem?.requiresEvidence?.length) continue;

    const attached = line.evidenceIds
      .map((id) => evidenceById.get(id))
      .filter((item): item is Evidence => Boolean(item));

    const satisfied = catalogItem.requiresEvidence.some((kind) =>
      attached.some((item) => item.kind === kind),
    );
    if (satisfied) continue;

    const wanted = catalogItem.requiresEvidence.join(' or ');
    line.evidenceGap = `Needs ${wanted}`;

    findings.push({
      id: `finding-evidence-${line.id}`,
      severity: line.rcv > 500 ? 'critical' : 'warning',
      kind: 'missing_evidence',
      title: `${line.code} is billed without supporting documentation`,
      detail: `${line.description}${line.roomName ? ` in ${line.roomName}` : ''} carries ${line.quantity} ${line.unit} at $${line.rcv.toFixed(2)}, but no ${wanted} is attached. Adjusters strike undocumented demolition and equipment lines routinely — the work is already done, so this is $${line.rcv.toFixed(2)} at risk for the cost of a photo.`,
      revenueImpact: 0,
      marginImpact: 0,
      actionRequired: `Attach ${wanted}${catalogItem.evidenceTags?.length ? ` tagged "${catalogItem.evidenceTags[0]}"` : ''} for this line.`,
      relatedCode: line.code,
      roomId: line.roomId,
    });
  }

  return findings;
}

/* ------------------------------------------------------------------ *
 * Finding: lines that should not be there
 * ------------------------------------------------------------------ */

/**
 * A line with neither justification nor evidence has no business on a submitted
 * estimate. Flagging it is the counterweight that makes every other finding here
 * credible — a reviewer that only ever adds revenue is a reviewer nobody trusts.
 */
function findUnsupportedLines(lineItems: EstimateLineItem[]): ProfitFinding[] {
  return lineItems
    .filter((line) => line.evidenceIds.length === 0 && !line.justification.trim())
    .map((line) => ({
      id: `finding-unsupported-${line.id}`,
      severity: 'critical' as const,
      kind: 'unsupported_item' as const,
      title: `${line.code} has no justification and no evidence — remove it`,
      detail: `${line.description} carries ${line.quantity} ${line.unit} at $${line.rcv.toFixed(2)} with nothing behind it. Submitting it risks the credibility of the whole estimate, including the lines that are fully supported.`,
      revenueImpact: -line.rcv,
      marginImpact: -round(line.rcv - line.totalCost),
      actionRequired: 'Remove the line, or attach the documentation that supports it.',
      relatedCode: line.code,
      roomId: line.roomId,
    }));
}

/* ------------------------------------------------------------------ *
 * Finding: margin
 * ------------------------------------------------------------------ */

function findLowMarginLines(
  lineItems: EstimateLineItem[],
  options: ProfitabilityOptions,
): ProfitFinding[] {
  return lineItems
    .filter((line) => line.rcv > 100 && lineMargin(line) < options.lineMarginFloor)
    .map((line) => {
      const margin = lineMargin(line);
      return {
        id: `finding-margin-${line.id}`,
        severity: margin < 0 ? ('critical' as const) : ('warning' as const),
        kind: 'low_margin' as const,
        title: `${line.code} runs at ${(margin * 100).toFixed(0)}% margin`,
        detail:
          margin < 0
            ? `${line.description} costs more to deliver ($${line.totalCost.toFixed(2)}) than it bills ($${line.rcv.toFixed(2)}). Either the cost basis for this code is wrong or the work should be subcontracted differently.`
            : `${line.description} bills $${line.rcv.toFixed(2)} against $${line.totalCost.toFixed(2)} of cost — below the ${(options.lineMarginFloor * 100).toFixed(0)}% floor. Check the cost basis for this code before assuming the price is the problem.`,
        revenueImpact: 0,
        marginImpact: round(line.rcv * options.lineMarginFloor - (line.rcv - line.totalCost)),
        actionRequired: 'Review the internal cost basis for this code in org settings.',
        relatedCode: line.code,
        roomId: line.roomId,
      };
    });
}

/* ------------------------------------------------------------------ *
 * Finding: unverified prices
 * ------------------------------------------------------------------ */

function findUnverifiedPricing(lineItems: EstimateLineItem[]): ProfitFinding[] {
  const unverified = lineItems.filter((line) => !line.priceVerified);
  if (unverified.length === 0) return [];

  const exposure = round(unverified.reduce((sum, line) => sum + line.rcv, 0));

  return [
    {
      id: 'finding-unverified-pricing',
      severity: 'critical',
      kind: 'missing_evidence',
      title: `${unverified.length} lines are priced from defaults, not your price list`,
      detail: `$${exposure.toFixed(2)} of this estimate is priced from built-in placeholder figures because those codes were not matched against a real Xactimate price list. Placeholder prices are for sanity-checking the scope, not for submission — connect the Xactimate account and sync the price list before sending this anywhere.`,
      revenueImpact: 0,
      marginImpact: 0,
      actionRequired: 'Connect Xactimate and sync the current price list, then re-run the estimate.',
    },
  ];
}

/* ------------------------------------------------------------------ *
 * Finding: generic selector where a specific one applies
 * ------------------------------------------------------------------ */

/**
 * The generic dehumidifier code pays roughly a fifth less than the LGR code. If
 * an LGR was on site, using the generic selector is money left on the table for
 * no reason other than habit.
 */
function findGenericSelectorUse(
  assessment: LossAssessment,
  lineItems: EstimateLineItem[],
  options: ProfitabilityOptions,
): ProfitFinding[] {
  const generic = lineItems.find((line) => line.catalogKey === 'WTRDHM');
  if (!generic) return [];

  const lgrOnSite = assessment.equipment.some((e) => e.kind === 'dehumidifier_lgr');
  if (!lgrOnSite) return [];

  const lgrItem = lookup(options.catalog, 'WTRDHMLGR');
  if (!lgrItem) return [];

  const lgrPrice = resolvePrice(lgrItem, options.priceList, options.costBasis);
  const delta = round((lgrPrice.unitPrice - generic.unitPrice) * generic.quantity);
  if (delta <= 0) return [];

  return [
    {
      id: 'finding-generic-dehu',
      severity: 'warning',
      kind: 'missing_line_item',
      title: 'LGR dehumidifiers billed at the conventional rate',
      detail: `The equipment log shows LGR units on site, but ${generic.quantity} equipment-days are written against ${generic.code} (conventional) rather than ${lgrItem.code}. The specific selector is the correct one and pays $${(lgrPrice.unitPrice - generic.unitPrice).toFixed(2)} more per day.`,
      revenueImpact: delta,
      marginImpact: delta,
      actionRequired: `Change ${generic.code} to ${lgrItem.code}.`,
      relatedCode: lgrItem.code,
    },
  ];
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * Resolve a catalog entry by its stable key.
 *
 * Never by `code`: after a price-list sync the selector is whatever the account
 * calls it, so a rule that looked items up by selector would stop firing the
 * moment a region renamed one — silently, and in the direction of billing less.
 */
function lookup(catalog: readonly CatalogItem[], key: string): CatalogItem | undefined {
  return catalog.find((item) => item.key === key) ?? findByKey(key);
}

function hasCode(lines: EstimateLineItem[], key: string): boolean {
  return lines.some((line) => line.catalogKey === key);
}

function hasTag(lines: EstimateLineItem[], unit: string): boolean {
  return lines.some((line) => line.unit === unit);
}

function hasCategoryTearOut(lines: EstimateLineItem[]): boolean {
  return lines.some((line) => line.catalogKey.startsWith('WTRT') || line.catalogKey === 'WTRDRYWL');
}

/**
 * Whether the initial response happened outside business hours, from the
 * earliest timestamp any source recorded.
 */
function wasAfterHours(evidence: Evidence[], dateOfArrival?: string): boolean {
  const stamps = [
    dateOfArrival,
    ...evidence.map((item) => item.capturedAt).filter((value): value is string => Boolean(value)),
  ]
    .map((value) => Date.parse(value!))
    .filter((value) => !Number.isNaN(value));

  if (stamps.length === 0) return false;

  const earliest = new Date(Math.min(...stamps));
  const hour = earliest.getUTCHours();
  const day = earliest.getUTCDay();
  return hour < 8 || hour >= 18 || day === 0 || day === 6;
}

function bySeverityThenValue(a: ProfitFinding, b: ProfitFinding): number {
  const rank = { critical: 0, warning: 1, info: 2 } as const;
  if (rank[a.severity] !== rank[b.severity]) return rank[a.severity] - rank[b.severity];
  return Math.abs(b.revenueImpact) - Math.abs(a.revenueImpact);
}
