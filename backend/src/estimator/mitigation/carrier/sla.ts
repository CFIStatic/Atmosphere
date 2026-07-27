import { round } from '../lib/geometry.js';
import { hoursBetween } from '../lib/psychrometrics.js';
import type { PricingOptions } from '../pricing.js';
import type { EstimateLineItem, LossAssessment, ProfitabilitySummary } from '../types.js';
import type {
  CarrierIdentification,
  ProgramAgreement,
  SlaCheck,
  SlaComplianceReport,
  SlaDeviation,
  SlaRule,
} from './types.js';

/**
 * Applying and checking a program agreement.
 *
 * Two halves, deliberately separated:
 *
 *   `applyAgreementToPricing` runs **before** the estimate is built. Terms that
 *   change how the estimate is priced — the mandated price list, whether O&P is
 *   payable, a negotiated concession — are settings, and the cleanest way to
 *   obey them is to price correctly in the first place rather than to build a
 *   non-compliant estimate and correct it afterwards.
 *
 *   `checkAgreement` runs **after**. Terms that constrain the finished scope —
 *   quantity caps, prohibited codes, approval thresholds, documentation and
 *   timelines — can only be evaluated once there is a scope to evaluate.
 *
 * Nothing here silently reduces a quantity to fit a cap. A cap that the job
 * genuinely exceeded is reported, with the deviation grounds if the evidence
 * supports any, because quietly trimming equipment days to stay inside a limit
 * would hide the exact fact the franchise needs to raise with the carrier.
 */

/* ------------------------------------------------------------------ *
 * Pricing terms
 * ------------------------------------------------------------------ */

export interface AppliedPricing {
  pricing: PricingOptions;
  /** Which price list the agreement mandates, if any. */
  requiredPriceListId: string | null;
  /** Concession to apply to unit prices, 0–1. */
  discountPct: number;
  /** Human-readable record of what the agreement changed and why. */
  notes: string[];
}

export function applyAgreementToPricing(
  pricing: PricingOptions,
  agreement: ProgramAgreement | null,
): AppliedPricing {
  if (!agreement) {
    return { pricing, requiredPriceListId: null, discountPct: 0, notes: [] };
  }

  const notes: string[] = [];
  let next: PricingOptions = { ...pricing };
  let requiredPriceListId: string | null = null;
  let discountPct = 0;

  for (const rule of agreement.rules) {
    switch (rule.constraint.kind) {
      case 'price_list':
        requiredPriceListId = rule.constraint.priceListId;
        notes.push(`${agreement.programName} requires price list ${rule.constraint.priceListId}.`);
        break;

      case 'overhead_and_profit': {
        const { allowed, maxRate } = rule.constraint;
        if (!allowed) {
          next = { ...next, oAndPEligible: false };
          notes.push(
            `${agreement.programName} does not pay overhead and profit on this program, so none is applied.`,
          );
        } else if (maxRate !== undefined && next.overheadAndProfitRate > maxRate) {
          notes.push(
            `Overhead and profit capped at ${(maxRate * 100).toFixed(0)}% by the program, down from the org default of ${(next.overheadAndProfitRate * 100).toFixed(0)}%.`,
          );
          next = { ...next, overheadAndProfitRate: maxRate };
        }
        break;
      }

      case 'rate_concession':
        discountPct = Math.max(discountPct, rule.constraint.discountPct);
        notes.push(
          `A ${(rule.constraint.discountPct * 100).toFixed(1)}% program concession applies${rule.constraint.categories?.length ? ` to ${rule.constraint.categories.join(', ')}` : ''}.`,
        );
        break;

      default:
        break; // checked after the estimate is built
    }
  }

  return { pricing: next, requiredPriceListId, discountPct, notes };
}

/* ------------------------------------------------------------------ *
 * Compliance
 * ------------------------------------------------------------------ */

export interface CheckInput {
  assessment: LossAssessment;
  lineItems: EstimateLineItem[];
  profitability: ProfitabilitySummary;
  identification: CarrierIdentification;
  agreement: ProgramAgreement | null;
  /** Deviations a human has accepted for this job. */
  deviations?: SlaDeviation[];
  /** The price list the estimate was actually priced against. */
  actualPriceListId?: string | null;
}

export function checkAgreement(input: CheckInput): SlaComplianceReport {
  const { identification, agreement } = input;

  if (!agreement) {
    return noAgreementReport(identification);
  }

  const accepted = (input.deviations ?? []).filter(isUsableDeviation);
  const checks = agreement.rules.map((rule) => checkRule(rule, input, accepted));
  const proposedDeviations = proposeDeviations(agreement, input, checks);

  const met = checks.filter((c) => c.status === 'met').length;
  const violated = checks.filter((c) => c.status === 'violated').length;
  const deviations = checks.filter((c) => c.status === 'deviation_documented').length;

  // Only an unexcused breach of a hard term blocks. A soft term is reported and
  // the estimator decides.
  const blocksSubmission = checks.some((c) => c.status === 'violated' && c.severity === 'hard');

  return {
    identification,
    agreement,
    checks,
    met,
    violated,
    deviations,
    proposedDeviations,
    blocksSubmission,
    summary: writeSummary(agreement, checks, met, violated, deviations, blocksSubmission),
  };
}

/**
 * A deviation counts only when it carries both a reason and evidence.
 *
 * This is the line between "documented" and "asserted", and it is the only thing
 * standing between a considered exception and a habit of writing "per carrier"
 * next to every overage.
 */
function isUsableDeviation(deviation: SlaDeviation): boolean {
  return Boolean(deviation.reason?.trim()) && (deviation.evidenceIds?.length ?? 0) > 0 && !deviation.proposed;
}

function noAgreementReport(identification: CarrierIdentification): SlaComplianceReport {
  const named = identification.carrierName ?? 'the carrier';
  return {
    identification,
    agreement: null,
    checks: [],
    met: 0,
    violated: 0,
    deviations: 0,
    proposedDeviations: [],
    // Missing terms do not block — plenty of work is written outside a program.
    // But it is stated plainly, because a program job estimated blind to its
    // terms is the usual route to a chargeback.
    blocksSubmission: false,
    summary:
      identification.confidence === 'unknown'
        ? 'No carrier could be identified from the sources, so no program terms were applied. If this job came through a national account, load its agreement before submitting — estimating blind to the terms is how chargebacks start.'
        : `No program agreement is loaded for ${named}${identification.programName ? ` via ${identification.programName}` : ''}, so the estimate follows your own settings rather than the program's. Load the agreement if this is program work.`,
  };
}

/* ------------------------------------------------------------------ *
 * Per-rule checks
 * ------------------------------------------------------------------ */

function checkRule(rule: SlaRule, input: CheckInput, accepted: SlaDeviation[]): SlaCheck {
  const raw = evaluate(rule, input);
  if (raw.status !== 'violated') return raw;

  // A breach with an accepted, evidence-backed deviation is reclassified rather
  // than suppressed: the estimate still shows the term was exceeded, alongside
  // the written reason.
  const deviation = accepted.find((d) => d.ruleId === rule.id);
  if (!deviation) return raw;

  return {
    ...raw,
    status: 'deviation_documented',
    deviation,
    detail: `${raw.detail} Exceeded under a documented deviation: ${deviation.reason}`,
    remedy: undefined,
  };
}

function evaluate(rule: SlaRule, input: CheckInput): SlaCheck {
  const { assessment, lineItems, profitability } = input;
  const base = { ruleId: rule.id, title: rule.title, severity: rule.severity, sourceRef: rule.sourceRef };
  const c = rule.constraint;

  switch (c.kind) {
    case 'price_list': {
      if (!input.actualPriceListId) {
        return {
          ...base,
          status: 'undetermined',
          detail: `The program requires price list ${c.priceListId}, but this estimate was priced from built-in defaults rather than a synced list.`,
          remedy: `Sync ${c.priceListId} from Xactimate, or upload it, then rebuild.`,
        };
      }
      return input.actualPriceListId === c.priceListId
        ? { ...base, status: 'met', detail: `Priced against ${c.priceListId}, as the program requires.` }
        : {
            ...base,
            status: 'violated',
            detail: `Priced against ${input.actualPriceListId}, but the program requires ${c.priceListId}.`,
            remedy: `Sync ${c.priceListId} and rebuild. Submitting on the wrong list gets the estimate re-priced.`,
          };
    }

    case 'overhead_and_profit': {
      const hasOandP = profitability.overheadAndProfit > 0;
      if (!c.allowed) {
        return hasOandP
          ? {
              ...base,
              status: 'violated',
              detail: `The program does not pay overhead and profit, but ${money(profitability.overheadAndProfit)} is on this estimate.`,
              remedy: 'Remove O&P, or document why this job qualifies as an exception.',
              revenueImpact: -profitability.overheadAndProfit,
            }
          : { ...base, status: 'met', detail: 'No overhead and profit applied, as the program requires.' };
      }
      const rate = profitability.subtotal > 0 ? profitability.overheadAndProfit / profitability.subtotal : 0;
      if (c.maxRate !== undefined && rate > c.maxRate + 0.001) {
        const allowed = profitability.subtotal * c.maxRate;
        return {
          ...base,
          status: 'violated',
          detail: `Overhead and profit is at ${(rate * 100).toFixed(1)}%, above the program ceiling of ${(c.maxRate * 100).toFixed(0)}%.`,
          remedy: `Reduce O&P to ${money(allowed)}.`,
          revenueImpact: round(allowed - profitability.overheadAndProfit),
        };
      }
      return { ...base, status: 'met', detail: `Overhead and profit at ${(rate * 100).toFixed(1)}%, within the program ceiling.` };
    }

    case 'rate_concession':
      // Applied at pricing time; there is nothing to verify after the fact
      // beyond the note the pricing layer already recorded.
      return {
        ...base,
        status: 'met',
        detail: `A ${(c.discountPct * 100).toFixed(1)}% program concession was applied when the estimate was priced.`,
      };

    case 'max_quantity': {
      const matching = lineItems.filter((line) => line.catalogKey === c.catalogKey);
      if (matching.length === 0) {
        return { ...base, status: 'not_applicable', detail: `No ${c.catalogKey} lines on this estimate.` };
      }
      const total = round(matching.reduce((sum, line) => sum + line.quantity, 0));
      const limit = c.per === 'room' ? c.max * Math.max(1, assessment.rooms.length) : c.max;

      if (total <= limit) {
        return { ...base, status: 'met', detail: `${total} ${c.unit} of ${c.catalogKey} against a program limit of ${limit}.` };
      }
      const overage = round(total - limit);
      const unitPrice = matching[0].unitPrice;
      return {
        ...base,
        status: 'violated',
        detail: `${total} ${c.unit} of ${c.catalogKey} exceeds the program limit of ${limit} ${c.unit} by ${overage}.`,
        remedy: `Reduce to ${limit} ${c.unit}, or document why the job required more.`,
        revenueImpact: round(-overage * unitPrice),
      };
    }

    case 'max_equipment_days': {
      const days = round(
        lineItems.filter((line) => line.unit === 'DA').reduce((sum, line) => sum + line.quantity, 0),
      );
      if (days === 0) return { ...base, status: 'not_applicable', detail: 'No equipment days on this estimate.' };
      if (assessment.dryingDays <= c.maxDays) {
        return {
          ...base,
          status: 'met',
          detail: `Drying ran ${assessment.dryingDays} days, within the program allowance of ${c.maxDays}.`,
        };
      }
      return {
        ...base,
        status: 'violated',
        detail: `Drying ran ${assessment.dryingDays} days against a program allowance of ${c.maxDays} before written approval is required.`,
        remedy: `Obtain approval for the additional ${assessment.dryingDays - c.maxDays} day(s), or document why the structure was not dry at day ${c.maxDays}.`,
      };
    }

    case 'approval_threshold':
      return profitability.total > c.amount
        ? {
            ...base,
            // Not a violation. The estimate is legitimate; it needs a signature
            // before the work proceeds, and conflating the two would train
            // people to ignore genuine breaches.
            status: 'approval_required',
            detail: `The estimate totals ${money(profitability.total)}, above the ${money(c.amount)} threshold for written pre-approval.`,
            remedy: 'Obtain written approval before proceeding, and attach it to the file.',
          }
        : { ...base, status: 'met', detail: `${money(profitability.total)} is below the ${money(c.amount)} approval threshold.` };

    case 'line_item_prohibited': {
      const offending = lineItems.filter((line) => c.catalogKeys.includes(line.catalogKey));
      if (offending.length === 0) {
        return { ...base, status: 'met', detail: 'No prohibited line items are on this estimate.' };
      }
      const value = round(offending.reduce((sum, line) => sum + line.rcv, 0));
      return {
        ...base,
        status: 'violated',
        detail: `The program does not pay ${offending.map((l) => l.code).join(', ')} — ${money(value)} on this estimate.`,
        remedy: 'Remove these lines, or document a specific authorisation for them.',
        revenueImpact: -value,
      };
    }

    case 'required_documentation': {
      const missing = c.items.filter((item) => !hasDocumentation(item, assessment));
      if (missing.length === 0) {
        return { ...base, status: 'met', detail: `All ${c.items.length} required document types are present.` };
      }
      return {
        ...base,
        status: 'violated',
        detail: `Required documentation missing: ${missing.join(', ')}.`,
        // No deviation path offered — you cannot document your way out of
        // missing documentation. It has to be supplied.
        remedy: 'Attach the missing items. The program will not pay the invoice without them.',
      };
    }

    case 'timeline': {
      const actual = milestoneAt(c.milestone, assessment);
      if (!assessment.dateOfLoss || !actual) {
        return {
          ...base,
          status: 'undetermined',
          detail: `Cannot verify the ${c.milestone.replace(/_/g, ' ')} deadline — the sources do not carry both the loss date and that milestone.`,
          remedy: 'Record the milestone timestamps; program timelines are audited against them.',
        };
      }
      const elapsed = hoursBetween(assessment.dateOfLoss, actual);
      return elapsed <= c.withinHours
        ? {
            ...base,
            status: 'met',
            detail: `${label(c.milestone)} at ${Math.round(elapsed)} hours, within the ${c.withinHours}-hour requirement.`,
          }
        : {
            ...base,
            status: 'violated',
            detail: `${label(c.milestone)} at ${Math.round(elapsed)} hours, past the ${c.withinHours}-hour requirement.`,
            remedy: 'Document the reason for the delay. Missed timelines are scored against the franchise even when the estimate is otherwise clean.',
          };
    }

    case 'invoice_window':
      // Nothing to check at estimate time — the invoice does not exist yet.
      return {
        ...base,
        status: 'not_applicable',
        detail: `The program requires invoicing within ${c.withinDays} days of completion. Checked at invoicing, not here.`,
      };
  }
}

/**
 * Whether the job carries a required document type.
 *
 * Matching is by evidence kind and tag, which is why the photo adapter works so
 * hard at reading captions — a program that requires "before photos" is
 * satisfied by a photo captioned as one, and by nothing else.
 */
function hasDocumentation(item: string, assessment: LossAssessment): boolean {
  const want = item.toLowerCase();

  if (/moisture|reading|log/.test(want)) return assessment.moistureReadings.length > 0;
  if (/psychro|atmospheric|temperature|humidity/.test(want)) return assessment.psychrometrics.length > 0;
  if (/monitor|daily/.test(want)) return assessment.monitoringVisits > 0;
  if (/sketch|diagram|floor plan|measure/.test(want)) return assessment.sourcesUsed.includes('docusketch');
  if (/equipment/.test(want)) return assessment.equipment.length > 0;

  if (/before|pre-?loss/.test(want)) {
    return assessment.evidence.some((e) => e.kind === 'photo' && e.tags.includes('before'));
  }
  if (/after|post|completion/.test(want)) {
    return assessment.evidence.some((e) => e.kind === 'photo' && e.tags.includes('after'));
  }
  if (/photo|picture|image/.test(want)) {
    return assessment.evidence.some((e) => e.kind === 'photo');
  }

  // An unrecognised requirement is reported as missing rather than assumed
  // satisfied — the failure that costs money is the one nobody was told about.
  return false;
}

function milestoneAt(
  milestone: Extract<SlaRule['constraint'], { kind: 'timeline' }>['milestone'],
  assessment: LossAssessment,
): string | undefined {
  switch (milestone) {
    case 'contact':
    case 'on_site':
    case 'inspection':
      return assessment.dateOfArrival;
    case 'work_complete':
    case 'estimate_submitted': {
      const stamps = assessment.evidence
        .map((e) => e.capturedAt)
        .filter((value): value is string => Boolean(value))
        .map((value) => Date.parse(value))
        .filter((value) => !Number.isNaN(value));
      return stamps.length ? new Date(Math.max(...stamps)).toISOString() : undefined;
    }
  }
}

/* ------------------------------------------------------------------ *
 * Deviation proposals
 * ------------------------------------------------------------------ */

/**
 * Find breaches the job's own documentation already justifies.
 *
 * This is the part that makes "follow the agreement unless there is
 * documentation" workable rather than aspirational. When a term is exceeded, the
 * agent goes looking through the evidence for the reason — a structure still
 * above its drying goal on the day the equipment allowance ran out is the
 * commonest one, and the moisture readings that prove it are already in the file.
 *
 * Proposals are never applied automatically. Agreeing to exceed a carrier's
 * terms is a commercial decision with a relationship behind it, so the agent
 * assembles the argument and a human decides whether to make it.
 */
export function proposeDeviations(
  agreement: ProgramAgreement,
  input: CheckInput,
  checks: SlaCheck[],
): SlaDeviation[] {
  const proposals: SlaDeviation[] = [];
  const { assessment } = input;

  for (const check of checks) {
    if (check.status !== 'violated') continue;
    const rule = agreement.rules.find((r) => r.id === check.ruleId);
    if (!rule) continue;

    if (rule.constraint.kind === 'max_equipment_days') {
      const cap = rule.constraint.maxDays;
      const grounds = readingsAboveGoalAfterDay(assessment, cap);
      if (grounds.length > 0) {
        proposals.push({
          ruleId: rule.id,
          reason: `The structure had not reached its drying goal at day ${cap}. ${grounds
            .map((g) => `${g.material} in ${g.roomName} read ${g.value} against a goal of ${g.dryStandard} on ${g.takenAt.slice(0, 10)}`)
            .join('; ')}. Demobilising on the allowance would have left the assembly wet, which is a callback and a mould claim rather than a saving.`,
          evidenceIds: grounds.map((g) => g.evidenceId),
          proposed: true,
        });
      }
    }

    if (rule.constraint.kind === 'max_quantity' && rule.constraint.catalogKey.startsWith('WTRDHM')) {
      // A dehumidification cap exceeded because the class demanded the capacity
      // is defensible, and the arithmetic that says so is already on the
      // estimate.
      const sizingEvidence = assessment.evidence
        .filter((e) => e.kind === 'psychrometric' || e.tags.includes('dehumidifier'))
        .map((e) => e.id);
      if (sizingEvidence.length > 0) {
        proposals.push({
          ruleId: rule.id,
          reason: `The Class ${assessment.class} affected volume required more dehumidification capacity than the program allowance. The psychrometric log shows the conditions the installed capacity was holding.`,
          evidenceIds: sizingEvidence.slice(0, 6),
          proposed: true,
        });
      }
    }

    if (rule.constraint.kind === 'timeline') {
      const note = assessment.evidence.find(
        (e) => e.kind === 'note' && /delay|access|could not|no access|denied|reschedul/i.test(e.description),
      );
      if (note) {
        proposals.push({
          ruleId: rule.id,
          reason: `The field notes record a reason for the delay: "${note.description.slice(0, 200)}"`,
          evidenceIds: [note.id],
          proposed: true,
        });
      }
    }
  }

  return proposals;
}

interface ReadingGround {
  evidenceId: string;
  material: string;
  roomName: string;
  value: number;
  dryStandard: number;
  takenAt: string;
}

/** Readings still above their goal on or after the allowance expired. */
function readingsAboveGoalAfterDay(assessment: LossAssessment, day: number): ReadingGround[] {
  if (!assessment.dateOfArrival) return [];
  const start = Date.parse(assessment.dateOfArrival);
  if (Number.isNaN(start)) return [];
  const cutoff = start + day * 86_400_000;

  const rooms = new Map(assessment.rooms.map((room) => [room.id, room.name]));

  return assessment.moistureReadings
    .filter((reading) => {
      const at = Date.parse(reading.takenAt);
      return !Number.isNaN(at) && at >= cutoff && reading.value > reading.dryStandard;
    })
    .map((reading, index) => ({
      // Ties back to the evidence the MICA adapter minted for this reading.
      evidenceId:
        assessment.evidence.find(
          (e) => e.kind === 'moisture_reading' && e.capturedAt === reading.takenAt && e.tags.includes(reading.material),
        )?.id ?? `mica-moisture-${index}`,
      material: reading.material.replace(/_/g, ' '),
      roomName: rooms.get(reading.roomId) ?? reading.roomId,
      value: reading.value,
      dryStandard: reading.dryStandard,
      takenAt: reading.takenAt,
    }));
}

/* ------------------------------------------------------------------ */

function writeSummary(
  agreement: ProgramAgreement,
  checks: SlaCheck[],
  met: number,
  violated: number,
  deviations: number,
  blocks: boolean,
): string {
  const approvals = checks.filter((c) => c.status === 'approval_required').length;
  const applicable = checks.filter((c) => c.status !== 'not_applicable').length;

  const parts = [
    `${met} of ${applicable} applicable ${agreement.programName} terms met (agreement ${agreement.version})`,
  ];
  if (deviations > 0) parts.push(`${deviations} exceeded under a documented deviation`);
  if (violated > 0) parts.push(`${violated} not met`);
  if (approvals > 0) parts.push(`${approvals} needing written pre-approval`);

  const tail = blocks
    ? ' Submission is blocked until the unexcused breaches are resolved or documented.'
    : '';

  return `${parts.join(', ')}.${tail}`;
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function label(milestone: string): string {
  const map: Record<string, string> = {
    contact: 'Customer contact',
    on_site: 'Arrival on site',
    inspection: 'Inspection',
    estimate_submitted: 'Estimate submission',
    work_complete: 'Work completion',
  };
  return map[milestone] ?? milestone;
}
