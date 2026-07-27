import { daysBetween, hoursBetween } from './psychrometrics.js';
import { PHASE_SEQUENCE } from './playbooks.js';
import { requirementsFor, type ProjectShape } from './requirements.js';
import type { Milestone, ProjectContext, ProjectDocument } from './types.js';

/**
 * Documentation and insurance compliance.
 *
 * The question this exists to answer is "can we bill this job yet, and if not,
 * what exactly is missing?" — because the expensive version of that question is
 * an invoice that comes back six weeks later with a request for the
 * authorization form nobody scanned.
 */

export interface ComplianceAnalysis {
  /** Requirements the catalogue expects that have no row on the project yet. */
  unseededKeys: string[];
  missingBlocking: ProjectDocument[];
  missingOptional: ProjectDocument[];
  /** Missing *and* already past the phase they were due by. */
  overdueBlocking: ProjectDocument[];
  provided: number;
  totalTracked: number;
  completionPct: number;
  /** No blocking requirement outstanding. */
  invoiceReady: boolean;
  /** Set when the job is at or past invoicing but not ready. */
  blockingInvoiceNow: boolean;
  milestones: MilestoneStatus[];
  overdueMilestones: MilestoneStatus[];
  dueSoonMilestones: MilestoneStatus[];
}

export interface MilestoneStatus {
  milestone: Milestone;
  state: 'done' | 'overdue' | 'due_soon' | 'upcoming';
  hoursUntilDue: number;
  daysOverdue: number;
}

export function projectShape(ctx: ProjectContext): ProjectShape {
  return {
    workType: ctx.project.workType,
    lossType: ctx.project.lossType,
    isInsurance: Boolean(ctx.project.claimNumber || ctx.project.carrier),
  };
}

export function analyzeCompliance(
  ctx: ProjectContext,
  now: Date,
  milestoneLeadDays: number,
): ComplianceAnalysis {
  const expected = requirementsFor(projectShape(ctx));
  const existing = new Map(ctx.documents.map((d) => [d.requirementKey, d]));
  const unseededKeys = expected.filter((r) => !existing.has(r.key)).map((r) => r.key);

  // 'waived' counts as satisfied — a manager made that call, with a reason, and
  // the trigger in the migration made sure of both. 'rejected' does not.
  const isSatisfied = (d: ProjectDocument): boolean =>
    d.status === 'provided' || d.status === 'waived';

  const outstanding = ctx.documents.filter((d) => !isSatisfied(d));
  const missingBlocking = outstanding.filter((d) => d.isBlocking);
  const missingOptional = outstanding.filter((d) => !d.isBlocking);

  const sequence = PHASE_SEQUENCE[ctx.project.workType];
  const currentIndex = sequence.indexOf(ctx.project.phase);
  const overdueBlocking = missingBlocking.filter((d) => {
    if (!d.requiredByPhase) return false;
    const dueIndex = sequence.indexOf(d.requiredByPhase as (typeof sequence)[number]);
    return dueIndex >= 0 && currentIndex >= 0 && currentIndex > dueIndex;
  });

  const provided = ctx.documents.filter(isSatisfied).length;
  const totalTracked = ctx.documents.length;

  const milestones = ctx.milestones
    .map((m): MilestoneStatus => {
      const due = new Date(m.dueAt);
      const hoursUntilDue = hoursBetween(now, due);
      if (m.completedAt) {
        return { milestone: m, state: 'done', hoursUntilDue, daysOverdue: 0 };
      }
      if (due < now) {
        return { milestone: m, state: 'overdue', hoursUntilDue, daysOverdue: daysBetween(due, now) };
      }
      if (hoursUntilDue <= milestoneLeadDays * 24) {
        return { milestone: m, state: 'due_soon', hoursUntilDue, daysOverdue: 0 };
      }
      return { milestone: m, state: 'upcoming', hoursUntilDue, daysOverdue: 0 };
    })
    .sort((a, b) => new Date(a.milestone.dueAt).getTime() - new Date(b.milestone.dueAt).getTime());

  const invoiceReady = missingBlocking.length === 0 && unseededKeys.length === 0;
  const atBilling = ctx.project.phase === 'invoicing' || ctx.project.phase === 'final_review';

  return {
    unseededKeys,
    missingBlocking,
    missingOptional,
    overdueBlocking,
    provided,
    totalTracked,
    completionPct: totalTracked ? Math.round((provided / totalTracked) * 100) : 0,
    invoiceReady,
    blockingInvoiceNow: atBilling && !invoiceReady,
    milestones,
    overdueMilestones: milestones.filter((m) => m.state === 'overdue'),
    dueSoonMilestones: milestones.filter((m) => m.state === 'due_soon'),
  };
}
