import { daysBetween, hoursBetween } from './psychrometrics.js';
import { expectedTasksUpTo } from './playbooks.js';
import type { OrgSnapshot, ProjectContext, Task } from './types.js';

/**
 * Scheduling and crew analysis.
 *
 * Two different questions, deliberately in one place because they trade off
 * against each other: "is this project moving?" and "is this person buried?".
 * A PM who only sees the first reassigns work to someone already at capacity.
 */

export interface ProjectSchedule {
  overdueTasks: Task[];
  dueTodayTasks: Task[];
  blockedTasks: Task[];
  unassignedOpenTasks: Task[];
  /** Playbook work for phases the project has reached that has never existed. */
  missingPlaybookKeys: string[];
  /** No open tasks at all — nobody has said what happens next. */
  hasNoNextStep: boolean;
  /** Days since anything on this project changed. */
  daysSinceActivity: number;
  crewCount: number;
  /** Past its target completion date and not finished. */
  overrunDays: number | null;
  daysUntilTarget: number | null;
}

const OPEN_STATUSES = new Set(['todo', 'in_progress', 'blocked']);

export function analyzeSchedule(ctx: ProjectContext, now: Date): ProjectSchedule {
  const open = ctx.tasks.filter((t) => OPEN_STATUSES.has(t.status));

  const overdueTasks = open.filter((t) => t.dueAt && new Date(t.dueAt) < now);
  const dueTodayTasks = open.filter((t) => {
    if (!t.dueAt) return false;
    const due = new Date(t.dueAt);
    return due >= now && hoursBetween(now, due) < 24;
  });

  // Every key ever used, not just the open tasks — a playbook task that was
  // completed has not gone "missing", and reporting it as such would mean the
  // gap list grew as the crew got things done.
  const existingKeys = new Set(ctx.usedOriginKeys);
  const missingPlaybookKeys = expectedTasksUpTo(ctx.project.workType, ctx.project.phase)
    .filter((t) => !existingKeys.has(t.key))
    .map((t) => t.key);

  // "Activity" is the most recent thing anybody did on the job in any table.
  // Task updates alone would call a job stale while a crew was on site logging
  // readings all week.
  const stamps: number[] = [
    new Date(ctx.project.updatedAt).getTime(),
    ...ctx.tasks.map((t) => new Date(t.updatedAt).getTime()),
    ...ctx.readings.map((r) => new Date(r.takenAt).getTime()),
    ...ctx.placements.map((p) => new Date(p.placedAt).getTime()),
    ...ctx.documents.map((d) => (d.providedAt ? new Date(d.providedAt).getTime() : 0)),
  ].filter((n) => Number.isFinite(n) && n > 0);
  const lastActivity = stamps.length ? new Date(Math.max(...stamps)) : new Date(ctx.project.createdAt);

  const target = ctx.project.targetCompletionAt ? new Date(ctx.project.targetCompletionAt) : null;
  const finished = ctx.project.phase === 'paid' || ctx.project.status === 'closed';

  return {
    overdueTasks,
    dueTodayTasks,
    blockedTasks: open.filter((t) => t.status === 'blocked'),
    unassignedOpenTasks: open.filter((t) => !t.assignedTo),
    missingPlaybookKeys,
    hasNoNextStep: open.length === 0,
    daysSinceActivity: daysBetween(lastActivity, now),
    crewCount: ctx.assignments.length,
    overrunDays: target && !finished && target < now ? daysBetween(target, now) : null,
    daysUntilTarget: target && !finished && target >= now ? daysBetween(now, target) : null,
  };
}

export interface CrewLoad {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: string;
  projectCount: number;
  /** Sum of allocation_pct across live assignments. Over 100 is oversubscribed. */
  allocationPct: number;
  openTaskCount: number;
  overdueTaskCount: number;
  projectNumbers: string[];
}

/**
 * How loaded each crew member is, across the whole org.
 *
 * Org-scoped rather than per-project on purpose: the double-booking that hurts
 * is never visible from inside one job.
 */
export function analyzeCrewLoad(snapshot: OrgSnapshot): CrewLoad[] {
  const byUser = new Map<string, CrewLoad>();

  const ensure = (userId: string): CrewLoad => {
    let row = byUser.get(userId);
    if (!row) {
      const member = snapshot.members.find((m) => m.userId === userId);
      row = {
        userId,
        email: member?.email ?? null,
        fullName: member?.fullName ?? null,
        role: member?.role ?? 'unknown',
        projectCount: 0,
        allocationPct: 0,
        openTaskCount: 0,
        overdueTaskCount: 0,
        projectNumbers: [],
      };
      byUser.set(userId, row);
    }
    return row;
  };

  for (const ctx of snapshot.projects) {
    // On-hold work is not competing for anybody's day.
    if (ctx.project.status !== 'active') continue;

    for (const a of ctx.assignments) {
      const row = ensure(a.userId);
      row.projectCount += 1;
      row.allocationPct += a.allocationPct;
      row.projectNumbers.push(ctx.project.projectNumber);
    }

    for (const t of ctx.tasks) {
      if (!t.assignedTo || !OPEN_STATUSES.has(t.status)) continue;
      const row = ensure(t.assignedTo);
      row.openTaskCount += 1;
      if (t.dueAt && new Date(t.dueAt) < snapshot.now) row.overdueTaskCount += 1;
    }
  }

  return [...byUser.values()].sort((a, b) => b.allocationPct - a.allocationPct);
}

/**
 * Projects whose scheduled start has passed with nobody assigned to them.
 *
 * The classic Monday-morning failure: the job was sold, the date was promised,
 * and nobody was ever put on it.
 */
export function unstaffedStartingProjects(snapshot: OrgSnapshot): ProjectContext[] {
  return snapshot.projects.filter((ctx) => {
    if (ctx.project.status !== 'active') return false;
    if (!ctx.project.scheduledStartAt) return false;
    if (ctx.assignments.length > 0) return false;
    // Warn from 24 hours before the start, not after it — after is too late to
    // be useful, which is the difference between an alert and a postmortem.
    return new Date(ctx.project.scheduledStartAt).getTime() - snapshot.now.getTime() < 86_400_000;
  });
}
