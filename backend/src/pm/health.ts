import type { ComplianceAnalysis } from './compliance.js';
import type { DryingAnalysis } from './drying.js';
import type { ProjectSchedule } from './scheduling.js';
import type { ProjectContext } from './types.js';

/**
 * A single number for "how is this job doing", so a PM with thirty open projects
 * can decide what to look at before they have read anything.
 *
 * The score is a deduction from 100, and every deduction carries its reason.
 * That is deliberate: a bare score invites the question "why?", and if the
 * answer needs a second screen the number has cost more attention than it saved.
 */

export type HealthBand = 'good' | 'watch' | 'at_risk' | 'critical';

export interface ProjectHealth {
  score: number;
  band: HealthBand;
  /** Ordered worst-first. The first one is the headline. */
  reasons: { weight: number; text: string }[];
}

interface Deduction {
  when: boolean;
  weight: number;
  text: string;
}

export function projectHealth(
  ctx: ProjectContext,
  drying: DryingAnalysis,
  schedule: ProjectSchedule,
  compliance: ComplianceAnalysis,
): ProjectHealth {
  const overdueCount = schedule.overdueTasks.length;

  const deductions: Deduction[] = [
    {
      when: drying.areasStalled > 0,
      weight: 25,
      text:
        drying.areasStalled === 1
          ? '1 drying area has stalled'
          : `${drying.areasStalled} drying areas have stalled`,
    },
    {
      when: drying.areasOverdue > 0,
      weight: 20,
      text:
        drying.areasOverdue === 1
          ? '1 area is overdue a reading'
          : `${drying.areasOverdue} areas are overdue a reading`,
    },
    {
      when: compliance.overdueMilestones.length > 0,
      weight: 20,
      text: `${compliance.overdueMilestones.length} milestone(s) missed`,
    },
    {
      when: schedule.overrunDays !== null,
      weight: 18,
      text: `${schedule.overrunDays} day(s) past the target completion date`,
    },
    {
      when: compliance.blockingInvoiceNow,
      weight: 15,
      text: `${compliance.missingBlocking.length} requirement(s) are holding up the invoice`,
    },
    {
      when: overdueCount > 0,
      weight: Math.min(15, 4 + overdueCount * 2),
      text: overdueCount === 1 ? '1 overdue task' : `${overdueCount} overdue tasks`,
    },
    {
      when: drying.equipmentStillOnDriedProject,
      weight: 12,
      text: 'Equipment is still on site after the job dried out',
    },
    {
      when: schedule.blockedTasks.length > 0,
      weight: 10,
      text: `${schedule.blockedTasks.length} blocked task(s)`,
    },
    {
      when: drying.equipment.sufficient === false,
      weight: 10,
      text: 'Under-equipped for the affected area',
    },
    {
      when: schedule.crewCount === 0 && ctx.project.status === 'active',
      weight: 10,
      text: 'Nobody is assigned to this project',
    },
    {
      when: schedule.hasNoNextStep && ctx.project.status === 'active',
      weight: 8,
      text: 'No open task — nothing says what happens next',
    },
    {
      when: schedule.daysSinceActivity >= 3,
      weight: Math.min(12, schedule.daysSinceActivity),
      text: `No activity for ${schedule.daysSinceActivity} days`,
    },
    {
      when: !ctx.project.pmUserId,
      weight: 8,
      text: 'No project manager assigned',
    },
    {
      when: compliance.missingBlocking.length > 0 && !compliance.blockingInvoiceNow,
      weight: 5,
      text: `${compliance.missingBlocking.length} required document(s) outstanding`,
    },
  ];

  const applied = deductions
    .filter((d) => d.when)
    .map((d) => ({ weight: d.weight, text: d.text }))
    .sort((a, b) => b.weight - a.weight);

  const score = Math.max(0, 100 - applied.reduce((sum, d) => sum + d.weight, 0));

  // A project on hold is not failing, it is parked — scoring it like an active
  // job would fill the at-risk list with things nobody can act on.
  const band: HealthBand =
    ctx.project.status === 'on_hold'
      ? 'watch'
      : score >= 85
        ? 'good'
        : score >= 65
          ? 'watch'
          : score >= 40
            ? 'at_risk'
            : 'critical';

  return { score, band, reasons: applied };
}
