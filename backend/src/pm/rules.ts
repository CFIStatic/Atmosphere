import { analyzeCompliance } from './compliance.js';
import { analyzeDrying, hasReadingToday } from './drying.js';
import { analyzeCrewLoad, analyzeSchedule, unstaffedStartingProjects } from './scheduling.js';
import { expectedTasksUpTo, playbookFor } from './playbooks.js';
import { daysBetween } from './psychrometrics.js';
import type { Finding, ProjectContext, Rule } from './types.js';

/**
 * The rule set.
 *
 * Each rule is a pure function of the snapshot. It returns findings — statements
 * about what is true right now — and never writes anything. The engine owns the
 * translation from finding to alert, which is where de-duplication and
 * auto-resolution live.
 *
 * Two conventions every rule here holds to:
 *
 *   1. **The fingerprint is stable.** Same problem on the same entity must
 *      produce the same fingerprint on every pass, or the alert list becomes a
 *      log and a PM learns to ignore it. It must NOT contain anything that
 *      changes between runs — no counts, no timestamps, no hours-elapsed.
 *   2. **A finding says what to do.** `suggestedAction` is not decoration. An
 *      alert that reports a problem without naming the next move has moved the
 *      work from the machine back to the human, which is the opposite of the point.
 */

/** Shorthand for "PRJ-0012 · 14 Elm St", used in every title. */
const label = (ctx: ProjectContext): string => `${ctx.project.projectNumber} · ${ctx.project.name}`;

/* ------------------------------------------------------------------ *
 * Drying and equipment
 * ------------------------------------------------------------------ */

const dryingReadingOverdue: Rule = {
  key: 'drying_reading_overdue',
  label: 'Missed moisture reading',
  description:
    'An area that is still drying has not been measured within the reading interval. A day without a reading is a day that cannot be billed or defended.',
  category: 'drying',
  scope: 'project',
  evaluate({ snapshot, ctx }) {
    if (!ctx) return [];
    const drying = analyzeDrying(ctx, snapshot.settings, snapshot.now);
    if (!drying.isDrying) return [];

    return drying.areas
      .filter((a) => a.readingOverdue && a.state !== 'signed_off' && a.state !== 'goal_met')
      .map((area) => {
        const hours = area.hoursSinceReading;
        const detail =
          hours === null
            ? `${area.label} was set up as a drying area but has never been measured.`
            : `${area.label} was last measured ${hours} hours ago (the interval is ${snapshot.settings.readingIntervalHours}h). Last reading ${area.latestMoisturePct}%, dry standard ${area.dryGoalPct}%.`;

        return {
          ruleKey: 'drying_reading_overdue',
          // Area id only — never the hour count, which changes every pass.
          fingerprint: `drying_reading_overdue:${area.areaId}`,
          projectId: ctx.project.id,
          severity: hours !== null && hours >= snapshot.settings.readingIntervalHours * 2
            ? 'critical'
            : 'warn',
          category: 'drying',
          title: `${label(ctx)} — no reading in ${area.label}`,
          detail,
          suggestedAction: `Send someone to take moisture and psychrometric readings in ${area.label}.`,
          entityType: 'pm_drying_areas',
          entityId: area.areaId,
          facts: {
            areaLabel: area.label,
            hoursSinceReading: hours,
            latestMoisturePct: area.latestMoisturePct,
            dryGoalPct: area.dryGoalPct,
          },
          task: {
            originKey: `agent:reading:${area.areaId}`,
            title: `Take readings in ${area.label}`,
            details: detail,
            category: 'drying',
            priority: 'urgent',
            dueInHours: 8,
          },
        } satisfies Finding;
      });
  },
};

const dryingStalled: Rule = {
  key: 'drying_stalled',
  label: 'Dry-out has stalled',
  description:
    'Moisture has stopped falling, or started rising. Usually means the chamber is leaking, a dehumidifier has failed, or there is trapped water nobody has found.',
  category: 'drying',
  scope: 'project',
  evaluate({ snapshot, ctx }) {
    if (!ctx) return [];
    const drying = analyzeDrying(ctx, snapshot.settings, snapshot.now);
    if (!drying.isDrying) return [];

    return drying.areas
      .filter((a) => a.state === 'stalled' || a.state === 'wetter')
      .map((area) => {
        const rising = area.state === 'wetter';
        return {
          ruleKey: 'drying_stalled',
          fingerprint: `drying_stalled:${area.areaId}`,
          projectId: ctx.project.id,
          severity: rising ? 'critical' : 'warn',
          category: 'drying',
          title: `${label(ctx)} — ${area.label} ${rising ? 'is getting wetter' : 'has stalled'}`,
          detail: rising
            ? `${area.label} rose to ${area.latestMoisturePct}% at the last reading. Something is adding water, or the chamber is open.`
            : `${area.label} has not dropped more than ${snapshot.settings.dryingProgressMinPct}% for ${area.trend.flatDays} day(s). It sits at ${area.latestMoisturePct}% against a ${area.dryGoalPct}% standard.`,
          suggestedAction: rising
            ? `Get someone on site: check containment, look for an ongoing source, and verify every dehumidifier is running and draining.`
            : `Check equipment placement and function in ${area.label}, and confirm the chamber is sealed. Consider adding capacity.`,
          entityType: 'pm_drying_areas',
          entityId: area.areaId,
          facts: {
            areaLabel: area.label,
            flatDays: area.trend.flatDays,
            latestMoisturePct: area.latestMoisturePct,
            dryGoalPct: area.dryGoalPct,
            lastDropPct: area.trend.lastDropPct,
            equipmentSufficient: drying.equipment.sufficient,
          },
          task: {
            originKey: `agent:stall:${area.areaId}`,
            title: `Investigate stalled drying in ${area.label}`,
            details: drying.equipment.shortfallNote
              ? `Equipment check says: ${drying.equipment.shortfallNote}.`
              : 'Check containment, equipment function, and for an ongoing water source.',
            category: 'drying',
            priority: 'urgent',
            dueInHours: 12,
          },
        } satisfies Finding;
      });
  },
};

const dryingUnderEquipped: Rule = {
  key: 'drying_under_equipped',
  label: 'Not enough drying equipment',
  description:
    'The equipment on site is below what S500 calls for given the affected area and water class.',
  category: 'equipment',
  scope: 'project',
  evaluate({ snapshot, ctx }) {
    if (!ctx) return [];
    const drying = analyzeDrying(ctx, snapshot.settings, snapshot.now);
    if (!drying.isDrying || drying.equipment.sufficient !== false) return [];

    return [
      {
        ruleKey: 'drying_under_equipped',
        fingerprint: `drying_under_equipped:${ctx.project.id}`,
        projectId: ctx.project.id,
        severity: 'warn',
        category: 'equipment',
        title: `${label(ctx)} — under-equipped for the affected area`,
        detail: `S500 sizing for what is recorded as wet calls for ${drying.equipment.airMoversRequired} air mover(s) and ${drying.equipment.dehuPintsRequired} AHAM pints/day. On site: ${drying.equipment.airMoversOnSite} air mover(s) and ${drying.equipment.dehuPintsOnSite} pints/day.`,
        suggestedAction: `Add ${drying.equipment.shortfallNote}.`,
        entityType: 'pm_projects',
        entityId: ctx.project.id,
        facts: { ...drying.equipment },
        task: {
          originKey: `agent:equipment_short:${ctx.project.id}`,
          title: 'Add drying equipment to meet the S500 sizing',
          details: drying.equipment.shortfallNote ?? undefined,
          category: 'equipment',
          priority: 'high',
          dueInHours: 24,
        },
      },
    ];
  },
};

const equipmentIdleOnSite: Rule = {
  key: 'equipment_idle_on_site',
  label: 'Equipment left on a dried job',
  description:
    'Every area has met its dry standard but equipment is still on site. It is not billable after sign-off and it is not on the next job either.',
  category: 'equipment',
  scope: 'project',
  evaluate({ snapshot, ctx }) {
    if (!ctx) return [];
    const drying = analyzeDrying(ctx, snapshot.settings, snapshot.now);
    if (!drying.allAreasAtGoal || ctx.placements.length === 0) return [];

    // Give the crew the grace period before nagging — they may be on their way
    // to pick it up right now.
    const goalMetAt = drying.areas
      .filter((a) => a.state === 'goal_met' && a.latestReadingAt)
      .map((a) => new Date(a.latestReadingAt!).getTime())
      .sort((a, b) => b - a)[0];
    if (!goalMetAt) return [];
    const hoursSince = (snapshot.now.getTime() - goalMetAt) / 3_600_000;
    if (hoursSince < snapshot.settings.equipmentIdleHours) return [];

    const assets = ctx.placements
      .map((p) => p.equipment?.assetTag ?? p.equipmentId.slice(0, 8))
      .join(', ');
    const dailyCost = ctx.placements.reduce((sum, p) => sum + (p.billedRateCents ?? 0), 0);

    return [
      {
        ruleKey: 'equipment_idle_on_site',
        fingerprint: `equipment_idle_on_site:${ctx.project.id}`,
        projectId: ctx.project.id,
        severity: 'warn',
        category: 'equipment',
        title: `${label(ctx)} — ${ctx.placements.length} unit(s) still on a dried job`,
        detail: `Every area met its dry standard ${Math.floor(hoursSince)} hours ago, but ${assets} are still placed.${
          dailyCost ? ` That is ${(dailyCost / 100).toFixed(2)} a day of equipment not earning anywhere.` : ''
        }`,
        suggestedAction: 'Schedule the equipment pull and check the units back in.',
        entityType: 'pm_projects',
        entityId: ctx.project.id,
        facts: { units: ctx.placements.length, assets, hoursSince: Math.floor(hoursSince) },
        task: {
          originKey: `agent:pull_equipment:${ctx.project.id}`,
          title: 'Pull equipment — the job is dry',
          details: `Units on site: ${assets}.`,
          category: 'equipment',
          priority: 'high',
          dueInHours: 24,
        },
      },
    ];
  },
};

const dryingGoalMet: Rule = {
  key: 'drying_goal_met',
  label: 'Ready for dry-out sign-off',
  description: 'Every area has met its dry standard — the job can move to sign-off and demobilisation.',
  category: 'drying',
  scope: 'project',
  evaluate({ snapshot, ctx }) {
    if (!ctx) return [];
    const drying = analyzeDrying(ctx, snapshot.settings, snapshot.now);
    if (!drying.allAreasAtGoal || ctx.project.phase !== 'drying') return [];

    return [
      {
        ruleKey: 'drying_goal_met',
        fingerprint: `drying_goal_met:${ctx.project.id}`,
        projectId: ctx.project.id,
        severity: 'info',
        category: 'drying',
        title: `${label(ctx)} — dry standard met in all ${drying.openAreas} area(s)`,
        detail: `Drying ran ${drying.daysDrying} day(s). Every area is at or below its documented standard.`,
        suggestedAction: 'Record final readings, move the project to dry-out complete, and pull the equipment.',
        entityType: 'pm_projects',
        entityId: ctx.project.id,
        facts: { areas: drying.openAreas, daysDrying: drying.daysDrying },
      },
    ];
  },
};

const monitoringVisitMissing: Rule = {
  key: 'monitoring_visit_missing',
  label: 'No monitoring visit today',
  description: 'A drying job with no reading of any kind logged today.',
  category: 'drying',
  scope: 'project',
  evaluate({ snapshot, ctx }) {
    if (!ctx) return [];
    if (ctx.project.workType !== 'mitigation' || ctx.project.phase !== 'drying') return [];
    if (hasReadingToday(ctx, snapshot.now, snapshot.settings.timezone)) return [];
    if (ctx.areas.filter((a) => !a.signedOffAt).length === 0) return [];

    return [
      {
        ruleKey: 'monitoring_visit_missing',
        fingerprint: `monitoring_visit_missing:${ctx.project.id}`,
        projectId: ctx.project.id,
        severity: 'warn',
        category: 'drying',
        title: `${label(ctx)} — no monitoring visit logged today`,
        detail: 'A drying job owes a daily reading set: every affected area, one unaffected control, and one outside reading.',
        suggestedAction: 'Assign today’s monitoring visit before end of day.',
        entityType: 'pm_projects',
        entityId: ctx.project.id,
        facts: { openAreas: ctx.areas.filter((a) => !a.signedOffAt).length },
      },
    ];
  },
};

/* ------------------------------------------------------------------ *
 * Scheduling and crew
 * ------------------------------------------------------------------ */

const tasksOverdue: Rule = {
  key: 'tasks_overdue',
  label: 'Overdue tasks',
  description: 'Open work past its due date.',
  category: 'scheduling',
  scope: 'project',
  evaluate({ snapshot, ctx }) {
    if (!ctx) return [];
    const schedule = analyzeSchedule(ctx, snapshot.now);
    if (!schedule.overdueTasks.length) return [];

    const worst = schedule.overdueTasks
      .slice()
      .sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime())[0]!;
    const daysLate = daysBetween(new Date(worst.dueAt!), snapshot.now);

    return [
      {
        ruleKey: 'tasks_overdue',
        // Per project, not per task: five overdue tasks on one job is one
        // problem for a PM, not five interruptions.
        fingerprint: `tasks_overdue:${ctx.project.id}`,
        projectId: ctx.project.id,
        severity: daysLate >= 3 ? 'critical' : 'warn',
        category: 'scheduling',
        title: `${label(ctx)} — ${schedule.overdueTasks.length} overdue task(s)`,
        detail: `Oldest: “${worst.title}”, ${daysLate} day(s) past due.`,
        suggestedAction: 'Reassign, re-date, or close out the overdue work.',
        entityType: 'pm_projects',
        entityId: ctx.project.id,
        facts: {
          count: schedule.overdueTasks.length,
          oldestTitle: worst.title,
          daysLate,
          titles: schedule.overdueTasks.slice(0, 5).map((t) => t.title),
        },
      },
    ];
  },
};

const taskBlocked: Rule = {
  key: 'task_blocked',
  label: 'Blocked work',
  description: 'A task somebody stopped on. Blocked work is invisible unless something surfaces it.',
  category: 'scheduling',
  scope: 'project',
  evaluate({ snapshot, ctx }) {
    if (!ctx) return [];
    const schedule = analyzeSchedule(ctx, snapshot.now);
    return schedule.blockedTasks.map((task) => ({
      ruleKey: 'task_blocked',
      fingerprint: `task_blocked:${task.id}`,
      projectId: ctx.project.id,
      severity: 'warn',
      category: 'scheduling',
      title: `${label(ctx)} — blocked: ${task.title}`,
      detail: task.blockedReason ?? 'No reason recorded.',
      suggestedAction: 'Clear the blocker or hand it to whoever can.',
      entityType: 'pm_tasks',
      entityId: task.id,
      facts: { taskTitle: task.title, blockedReason: task.blockedReason },
    }));
  },
};

const projectNoNextStep: Rule = {
  key: 'project_no_next_step',
  label: 'No next step',
  description: 'An active project with no open task. Nothing says what happens next.',
  category: 'scheduling',
  scope: 'project',
  evaluate({ snapshot, ctx }) {
    if (!ctx) return [];
    if (ctx.project.status !== 'active') return [];
    if (ctx.project.phase === 'paid') return [];
    const schedule = analyzeSchedule(ctx, snapshot.now);
    if (!schedule.hasNoNextStep) return [];

    const book = playbookFor(ctx.project.workType, ctx.project.phase);
    return [
      {
        ruleKey: 'project_no_next_step',
        fingerprint: `project_no_next_step:${ctx.project.id}`,
        projectId: ctx.project.id,
        severity: 'warn',
        category: 'scheduling',
        title: `${label(ctx)} — no open task`,
        detail: `The project is in ${book?.label ?? ctx.project.phase} and has nothing outstanding. Either it is ready to move phase, or the next step was never written down.`,
        suggestedAction: book
          ? `Move it on, or add the next piece of work. ${book.label}: ${book.intent}`
          : 'Add the next piece of work, or move the project to its next phase.',
        entityType: 'pm_projects',
        entityId: ctx.project.id,
        facts: { phase: ctx.project.phase },
      },
    ];
  },
};

const projectStale: Rule = {
  key: 'project_stale',
  label: 'Stale project',
  description: 'An active project nobody has touched. The quiet ones are where jobs get lost.',
  category: 'scheduling',
  scope: 'project',
  evaluate({ snapshot, ctx }) {
    if (!ctx) return [];
    if (ctx.project.status !== 'active') return [];
    const schedule = analyzeSchedule(ctx, snapshot.now);
    if (schedule.daysSinceActivity < snapshot.settings.staleProjectDays) return [];

    return [
      {
        ruleKey: 'project_stale',
        fingerprint: `project_stale:${ctx.project.id}`,
        projectId: ctx.project.id,
        severity: schedule.daysSinceActivity >= snapshot.settings.staleProjectDays * 3 ? 'critical' : 'warn',
        category: 'scheduling',
        title: `${label(ctx)} — nothing logged for ${schedule.daysSinceActivity} days`,
        detail: `No task update, reading, document or equipment movement since ${new Date(
          snapshot.now.getTime() - schedule.daysSinceActivity * 86_400_000,
        ).toDateString()}.`,
        suggestedAction: 'Check where this job actually stands and update it, or close it out.',
        entityType: 'pm_projects',
        entityId: ctx.project.id,
        facts: { daysSinceActivity: schedule.daysSinceActivity, phase: ctx.project.phase },
      },
    ];
  },
};

const projectUnassigned: Rule = {
  key: 'project_unassigned',
  label: 'Project with no owner',
  description: 'An active project with no project manager, or no crew as its start date arrives.',
  category: 'scheduling',
  scope: 'project',
  evaluate({ ctx }) {
    if (!ctx || ctx.project.status !== 'active') return [];
    const findings: Finding[] = [];

    if (!ctx.project.pmUserId) {
      findings.push({
        ruleKey: 'project_unassigned',
        fingerprint: `project_unassigned:pm:${ctx.project.id}`,
        projectId: ctx.project.id,
        severity: 'warn',
        category: 'scheduling',
        title: `${label(ctx)} — no project manager`,
        detail: 'Nobody owns this job. Unowned jobs are the ones that go quiet.',
        suggestedAction: 'Assign a project manager.',
        entityType: 'pm_projects',
        entityId: ctx.project.id,
        facts: {},
      });
    }

    return findings;
  },
};

const crewOverloaded: Rule = {
  key: 'crew_overloaded',
  label: 'Overloaded crew member',
  description: 'Somebody carrying more concurrent projects or allocation than the org allows for.',
  category: 'scheduling',
  scope: 'org',
  evaluate({ snapshot }) {
    const loads = analyzeCrewLoad(snapshot);
    return loads
      .filter(
        (l) =>
          l.projectCount > snapshot.settings.maxProjectsPerCrew || l.allocationPct > 100,
      )
      .map((load) => {
        const who = load.fullName ?? load.email ?? load.userId.slice(0, 8);
        const overAllocated = load.allocationPct > 100;
        return {
          ruleKey: 'crew_overloaded',
          fingerprint: `crew_overloaded:${load.userId}`,
          projectId: null,
          severity: load.allocationPct > 150 ? 'critical' : 'warn',
          category: 'scheduling',
          title: `${who} is on ${load.projectCount} active project(s)`,
          detail: overAllocated
            ? `Allocations total ${load.allocationPct}% of one person's day across ${load.projectNumbers.join(', ')}, with ${load.openTaskCount} open task(s) and ${load.overdueTaskCount} overdue.`
            : `Above the limit of ${snapshot.settings.maxProjectsPerCrew}. Projects: ${load.projectNumbers.join(', ')}.`,
          suggestedAction: 'Move work to someone with room, or re-sequence the starts.',
          entityType: 'user',
          entityId: load.userId,
          facts: {
            projectCount: load.projectCount,
            allocationPct: load.allocationPct,
            openTaskCount: load.openTaskCount,
            overdueTaskCount: load.overdueTaskCount,
            projectNumbers: load.projectNumbers,
          },
        } satisfies Finding;
      });
  },
};

const startingUnstaffed: Rule = {
  key: 'starting_unstaffed',
  label: 'Starting with nobody on it',
  description: 'A project whose start date is here with no crew assigned.',
  category: 'scheduling',
  scope: 'org',
  evaluate({ snapshot }) {
    return unstaffedStartingProjects(snapshot).map((ctx) => ({
      ruleKey: 'starting_unstaffed',
      fingerprint: `starting_unstaffed:${ctx.project.id}`,
      projectId: ctx.project.id,
      severity: 'critical',
      category: 'scheduling',
      title: `${label(ctx)} starts ${new Date(ctx.project.scheduledStartAt!).toDateString()} with no crew`,
      detail: 'The start date was promised to a customer and nobody is assigned.',
      suggestedAction: 'Assign a crew, or move the start date and tell the customer.',
      entityType: 'pm_projects',
      entityId: ctx.project.id,
      facts: { scheduledStartAt: ctx.project.scheduledStartAt },
      task: {
        originKey: `agent:staff:${ctx.project.id}`,
        title: 'Assign a crew before the start date',
        category: 'scheduling',
        priority: 'urgent',
        dueInHours: 12,
      },
    }));
  },
};

const targetDateAtRisk: Rule = {
  key: 'target_date_at_risk',
  label: 'Target completion at risk',
  description: 'Past the target completion date, or projected to miss it based on the drying rate.',
  category: 'scheduling',
  scope: 'project',
  evaluate({ snapshot, ctx }) {
    if (!ctx) return [];
    const schedule = analyzeSchedule(ctx, snapshot.now);
    if (schedule.overrunDays === null) return [];

    return [
      {
        ruleKey: 'target_date_at_risk',
        fingerprint: `target_date_at_risk:${ctx.project.id}`,
        projectId: ctx.project.id,
        severity: schedule.overrunDays >= 5 ? 'critical' : 'warn',
        category: 'scheduling',
        title: `${label(ctx)} — ${schedule.overrunDays} day(s) past target completion`,
        detail: `Target was ${new Date(ctx.project.targetCompletionAt!).toDateString()} and the project is still in ${ctx.project.phase}.`,
        suggestedAction: 'Re-baseline the date and tell the customer before they ask.',
        entityType: 'pm_projects',
        entityId: ctx.project.id,
        facts: { overrunDays: schedule.overrunDays, phase: ctx.project.phase },
      },
    ];
  },
};

/* ------------------------------------------------------------------ *
 * Documentation and insurance
 * ------------------------------------------------------------------ */

const documentationMissing: Rule = {
  key: 'documentation_missing',
  label: 'Missing required documentation',
  description:
    'A blocking requirement that is past the phase it was due by. These are what hold up an invoice weeks later.',
  category: 'documentation',
  scope: 'project',
  evaluate({ snapshot, ctx }) {
    if (!ctx) return [];
    const compliance = analyzeCompliance(ctx, snapshot.now, snapshot.settings.milestoneLeadDays);
    if (!compliance.overdueBlocking.length) return [];

    const labels = compliance.overdueBlocking.map((d) => d.label);
    return [
      {
        ruleKey: 'documentation_missing',
        fingerprint: `documentation_missing:${ctx.project.id}`,
        projectId: ctx.project.id,
        severity: 'warn',
        category: 'documentation',
        title: `${label(ctx)} — ${labels.length} required document(s) outstanding`,
        detail: `Past their due phase: ${labels.join(', ')}.`,
        suggestedAction: `Collect ${labels[0]}${labels.length > 1 ? ` and ${labels.length - 1} other(s)` : ''} before this reaches billing.`,
        entityType: 'pm_projects',
        entityId: ctx.project.id,
        facts: { missing: labels, completionPct: compliance.completionPct },
        task: {
          originKey: `agent:docs:${ctx.project.id}`,
          title: `Collect outstanding documentation (${labels.length})`,
          details: labels.join('\n'),
          category: 'documentation',
          priority: 'high',
          dueInHours: 48,
        },
      },
    ];
  },
};

const invoiceBlocked: Rule = {
  key: 'invoice_blocked',
  label: 'Invoice blocked',
  description:
    'The job has reached billing but a blocking requirement is still outstanding. This is the most expensive alert in the set — it is the one that turns into a 60-day receivable.',
  category: 'billing',
  scope: 'project',
  evaluate({ snapshot, ctx }) {
    if (!ctx) return [];
    const compliance = analyzeCompliance(ctx, snapshot.now, snapshot.settings.milestoneLeadDays);
    if (!compliance.blockingInvoiceNow) return [];

    const missing = [
      ...compliance.missingBlocking.map((d) => d.label),
      ...compliance.unseededKeys.map((k) => `${k} (not yet tracked)`),
    ];

    return [
      {
        ruleKey: 'invoice_blocked',
        fingerprint: `invoice_blocked:${ctx.project.id}`,
        projectId: ctx.project.id,
        severity: 'critical',
        category: 'billing',
        title: `${label(ctx)} — cannot invoice yet`,
        detail: `${missing.length} blocking requirement(s) outstanding: ${missing.join(', ')}.`,
        suggestedAction: `Get ${missing[0]} in hand — everything else on this job is finished.`,
        entityType: 'pm_projects',
        entityId: ctx.project.id,
        facts: { missing, completionPct: compliance.completionPct },
        task: {
          originKey: `agent:invoice_block:${ctx.project.id}`,
          title: 'Close out the paperwork blocking this invoice',
          details: missing.join('\n'),
          category: 'billing',
          priority: 'urgent',
          dueInHours: 24,
        },
      },
    ];
  },
};

const milestoneDue: Rule = {
  key: 'milestone_due',
  label: 'Milestone due or missed',
  description: 'A dated commitment to a carrier, an inspector, or the customer.',
  category: 'insurance',
  scope: 'project',
  evaluate({ snapshot, ctx }) {
    if (!ctx) return [];
    const compliance = analyzeCompliance(ctx, snapshot.now, snapshot.settings.milestoneLeadDays);

    return [...compliance.overdueMilestones, ...compliance.dueSoonMilestones].map((status) => {
      const overdue = status.state === 'overdue';
      return {
        ruleKey: 'milestone_due',
        fingerprint: `milestone_due:${status.milestone.id}`,
        projectId: ctx.project.id,
        severity: overdue ? 'critical' : 'warn',
        category: status.milestone.kind === 'carrier' ? 'insurance' : 'scheduling',
        title: `${label(ctx)} — ${status.milestone.label} ${
          overdue ? `missed by ${status.daysOverdue} day(s)` : `due in ${Math.max(0, Math.ceil(status.hoursUntilDue / 24))} day(s)`
        }`,
        detail: `Due ${new Date(status.milestone.dueAt).toDateString()}.${
          status.milestone.note ? ` ${status.milestone.note}` : ''
        }`,
        suggestedAction: overdue
          ? `Do it now and note the delay — carrier programmes measure this.`
          : `Get ahead of it.`,
        entityType: 'pm_milestones',
        entityId: status.milestone.id,
        facts: {
          label: status.milestone.label,
          kind: status.milestone.kind,
          dueAt: status.milestone.dueAt,
          daysOverdue: status.daysOverdue,
        },
      } satisfies Finding;
    });
  },
};

const playbookGaps: Rule = {
  key: 'playbook_gaps',
  label: 'Playbook work never created',
  description:
    'Standard work for a phase the project has already reached that has never existed on it. Reported rather than silently created when auto-creation is off.',
  category: 'general',
  scope: 'project',
  evaluate({ snapshot, ctx }) {
    if (!ctx) return [];
    // When the engine is allowed to create the work itself, it does — and this
    // rule would then fire on tasks that are about to exist, which is noise.
    if (snapshot.settings.autoCreateTasks) return [];
    if (ctx.project.status !== 'active') return [];

    const schedule = analyzeSchedule(ctx, snapshot.now);
    if (!schedule.missingPlaybookKeys.length) return [];

    const all = expectedTasksUpTo(ctx.project.workType, ctx.project.phase);
    const missing = all.filter((t) => schedule.missingPlaybookKeys.includes(t.key));

    return [
      {
        ruleKey: 'playbook_gaps',
        fingerprint: `playbook_gaps:${ctx.project.id}:${ctx.project.phase}`,
        projectId: ctx.project.id,
        severity: 'info',
        category: 'general',
        title: `${label(ctx)} — ${missing.length} standard task(s) never created`,
        detail: missing.map((t) => t.title).join(', '),
        suggestedAction: 'Generate the phase playbook for this project.',
        entityType: 'pm_projects',
        entityId: ctx.project.id,
        facts: { missing: missing.map((t) => t.key), phase: ctx.project.phase },
      },
    ];
  },
};

const customerUpdateOverdue: Rule = {
  key: 'customer_update_overdue',
  label: 'Customer has not been updated',
  description:
    'A long-running job with no customer-facing communication logged. The complaint is almost never about the schedule — it is about not being told about the schedule.',
  category: 'customer',
  scope: 'project',
  evaluate({ snapshot, ctx }) {
    if (!ctx || ctx.project.status !== 'active') return [];
    if (!ctx.project.customerName) return [];

    const daysRunning = daysBetween(new Date(ctx.project.createdAt), snapshot.now);
    if (daysRunning < 7) return [];

    // A customer task done in the last week counts as having communicated.
    const recentContact = ctx.tasks.some(
      (t) =>
        t.category === 'customer' &&
        t.status === 'done' &&
        t.completedAt &&
        daysBetween(new Date(t.completedAt), snapshot.now) <= 7,
    );
    if (recentContact) return [];

    return [
      {
        ruleKey: 'customer_update_overdue',
        fingerprint: `customer_update_overdue:${ctx.project.id}`,
        projectId: ctx.project.id,
        severity: 'info',
        category: 'customer',
        title: `${label(ctx)} — ${ctx.project.customerName} has not been updated in a week`,
        detail: `The job has been running ${daysRunning} days with no completed customer contact in the last seven.`,
        suggestedAction: 'Send a short progress update — the agent can draft one.',
        entityType: 'pm_projects',
        entityId: ctx.project.id,
        facts: { daysRunning, customerName: ctx.project.customerName },
        task: {
          originKey: `agent:customer_update:${ctx.project.id}:${Math.floor(daysRunning / 7)}`,
          title: `Update ${ctx.project.customerName} on progress`,
          category: 'customer',
          priority: 'normal',
          dueInHours: 48,
        },
      },
    ];
  },
};

/* ------------------------------------------------------------------ *
 * Orchestration — platforms, messaging, procurement, approvals
 * ------------------------------------------------------------------ */

const approvalPending: Rule = {
  key: 'approval_pending',
  label: 'Approval waiting on you',
  description:
    'An irreversible action (platform write, bid accept, material order) is sitting in the queue. The agent never executes these alone.',
  category: 'orchestration',
  scope: 'org',
  evaluate({ snapshot }) {
    const staleHours = 4;
    return snapshot.pendingApprovals
      .filter((a) => a.status === 'pending')
      .map((a) => {
        const ageMs = snapshot.now.getTime() - new Date(a.createdAt).getTime();
        const hours = Math.floor(ageMs / 3_600_000);
        return {
          ruleKey: 'approval_pending',
          fingerprint: `approval_pending:${a.id}`,
          projectId: a.projectId,
          severity:
            a.priority === 'urgent' || hours >= staleHours * 2
              ? 'critical'
              : hours >= staleHours || a.priority === 'high'
                ? 'warn'
                : 'info',
          category: 'orchestration' as const,
          title: `Needs your OK — ${a.title}`,
          detail: a.detail ?? `Pending since ${a.createdAt}.`,
          suggestedAction: 'Open Approvals, review the proposed action, and approve or reject it.',
          entityType: 'pm_approvals',
          entityId: a.id,
          facts: { kind: a.kind, platform: a.platform, hoursWaiting: hours, priority: a.priority },
        };
      });
  },
};

const communicationUnreviewed: Rule = {
  key: 'communication_unreviewed',
  label: 'Unreviewed @atmosphere message',
  description:
    'A vendor, customer or adjuster mentioned @atmosphere in iMessage, WhatsApp, Signal or SMS and nobody has filed it yet.',
  category: 'communication',
  scope: 'project',
  evaluate({ ctx }) {
    if (!ctx) return [];
    return ctx.communications
      .filter((c) => c.status === 'new')
      .map((c) => ({
        ruleKey: 'communication_unreviewed',
        fingerprint: `communication_unreviewed:${c.id}`,
        projectId: ctx.project.id,
        severity: 'warn' as const,
        category: 'communication' as const,
        title: `${label(ctx)} — new ${c.channel} from ${c.counterpartyName || c.counterpartyHandle || 'unknown'}`,
        detail: c.mentionExcerpt || c.body.slice(0, 280),
        suggestedAction: 'Review the message, file it to the job, and approve any action it requested.',
        entityType: 'pm_communications',
        entityId: c.id,
        facts: {
          channel: c.channel,
          counterpartyKind: c.counterpartyKind,
          intake: c.intake,
        },
        task: {
          originKey: `agent:comm_review:${c.id}`,
          title: `Review ${c.channel} message`,
          details: c.mentionExcerpt || c.body.slice(0, 400),
          category: 'communication' as const,
          priority: 'high' as const,
          dueInHours: 8,
        },
      }));
  },
};

const equipmentPlanGaps: Rule = {
  key: 'equipment_plan_gaps',
  label: 'Equipment still needed from the estimate',
  description:
    'The mitigation or construction estimate called for gear or materials that are not yet on site, ordered, or bid out.',
  category: 'equipment',
  scope: 'project',
  evaluate({ ctx }) {
    if (!ctx) return [];
    const needed = ctx.planItems.filter((i) => i.status === 'needed');
    if (!needed.length) return [];

    const dumpster = needed.filter((i) => i.itemKind === 'dumpster');
    const other = needed.filter((i) => i.itemKind !== 'dumpster');
    const findings = [];

    if (dumpster.length) {
      findings.push({
        ruleKey: 'equipment_plan_gaps',
        fingerprint: `equipment_plan_gaps:dumpster:${ctx.project.id}`,
        projectId: ctx.project.id,
        severity: 'warn' as const,
        category: 'procurement' as const,
        title: `${label(ctx)} — dumpster required, not yet ordered`,
        detail: 'The estimate implies tear-out / debris. Search local haulers and pick a bid for approval.',
        suggestedAction: 'Open Procurement and run a dumpster bid search for this job.',
        entityType: 'pm_projects',
        entityId: ctx.project.id,
        facts: { itemCount: dumpster.length },
        task: {
          originKey: `agent:dumpster_bid:${ctx.project.id}`,
          title: 'Get dumpster bids',
          category: 'procurement' as const,
          priority: 'high' as const,
          dueInHours: 24,
        },
      });
    }

    if (other.length) {
      findings.push({
        ruleKey: 'equipment_plan_gaps',
        fingerprint: `equipment_plan_gaps:needed:${ctx.project.id}`,
        projectId: ctx.project.id,
        severity: 'info' as const,
        category: 'equipment' as const,
        title: `${label(ctx)} — ${other.length} plan item${other.length === 1 ? '' : 's'} still needed`,
        detail: other
          .slice(0, 6)
          .map((i) => `${i.quantity} ${i.unit} ${i.label} (${i.fulfillment})`)
          .join('; '),
        suggestedAction:
          'Reserve from inventory, open a referral order for materials, or rent what you do not own.',
        entityType: 'pm_projects',
        entityId: ctx.project.id,
        facts: {
          itemCount: other.length,
          kinds: other.map((i) => i.itemKind),
        },
      });
    }

    return findings;
  },
};

const procurementAwaiting: Rule = {
  key: 'procurement_awaiting',
  label: 'Procurement waiting on a decision',
  description:
    'A dumpster bid or material referral order is open and needs a human to pick a vendor or approve the Atmosphere referral link.',
  category: 'procurement',
  scope: 'project',
  evaluate({ ctx }) {
    if (!ctx) return [];
    return ctx.procurement
      .filter((p) => p.status === 'bidding' || p.status === 'awaiting_approval')
      .map((p) => ({
        ruleKey: 'procurement_awaiting',
        fingerprint: `procurement_awaiting:${p.id}`,
        projectId: ctx.project.id,
        severity: (p.status === 'awaiting_approval' ? 'warn' : 'info') as 'warn' | 'info',
        category: 'procurement' as const,
        title: `${label(ctx)} — ${p.title} (${p.status.replace(/_/g, ' ')})`,
        detail: p.description ?? undefined,
        suggestedAction:
          p.status === 'bidding'
            ? 'Review collected bids and select one for approval.'
            : 'Approve or reject the pending procurement action.',
        entityType: 'pm_procurement_requests',
        entityId: p.id,
        facts: { kind: p.kind, status: p.status, referralVendorKey: p.referralVendorKey },
      }));
  },
};

const platformSyncStale: Rule = {
  key: 'platform_sync_stale',
  label: 'Platform link has gone quiet',
  description:
    'A Dash / XactAnalysis / Xactimate / Outlook link has not synced recently, so Atmosphere may be missing what is happening on that job elsewhere.',
  category: 'orchestration',
  scope: 'project',
  evaluate({ snapshot, ctx }) {
    if (!ctx) return [];
    const staleMs = 3 * 86_400_000;
    return ctx.platformLinks
      .filter((l) => {
        if (l.syncStatus === 'error' || l.syncStatus === 'stale') return true;
        if (!l.lastSyncedAt) return true;
        return snapshot.now.getTime() - new Date(l.lastSyncedAt).getTime() >= staleMs;
      })
      .map((l) => ({
        ruleKey: 'platform_sync_stale',
        fingerprint: `platform_sync_stale:${l.id}`,
        projectId: ctx.project.id,
        severity: (l.syncStatus === 'error' ? 'warn' : 'info') as 'warn' | 'info',
        category: 'orchestration' as const,
        title: `${label(ctx)} — ${l.platform} link needs a sync`,
        detail: l.lastError || `Last synced ${l.lastSyncedAt ?? 'never'}.`,
        suggestedAction: `Pull the latest from ${l.platform} so the board matches reality.`,
        entityType: 'pm_platform_links',
        entityId: l.id,
        facts: {
          platform: l.platform,
          externalId: l.externalId,
          syncStatus: l.syncStatus,
        },
        task: {
          originKey: `agent:platform_sync:${l.id}`,
          title: `Sync ${l.platform}`,
          category: 'platform' as const,
          priority: 'normal' as const,
          dueInHours: 24,
        },
      }));
  },
};

/* ------------------------------------------------------------------ *
 * Registry
 * ------------------------------------------------------------------ */

export const RULES: Rule[] = [
  // Drying and equipment
  dryingReadingOverdue,
  monitoringVisitMissing,
  dryingStalled,
  dryingUnderEquipped,
  dryingGoalMet,
  equipmentIdleOnSite,
  // Scheduling and crew
  tasksOverdue,
  taskBlocked,
  projectNoNextStep,
  projectStale,
  projectUnassigned,
  targetDateAtRisk,
  crewOverloaded,
  startingUnstaffed,
  // Documentation, insurance, billing
  documentationMissing,
  invoiceBlocked,
  milestoneDue,
  playbookGaps,
  customerUpdateOverdue,
  // Orchestration
  approvalPending,
  communicationUnreviewed,
  equipmentPlanGaps,
  procurementAwaiting,
  platformSyncStale,
];

export const RULES_BY_KEY = new Map(RULES.map((r) => [r.key, r]));

/** What the settings screen lists, so an org can see what it is switching off. */
export function ruleCatalogue(): { key: string; label: string; description: string; category: string; scope: string }[] {
  return RULES.map((r) => ({
    key: r.key,
    label: r.label,
    description: r.description,
    category: r.category,
    scope: r.scope,
  }));
}
