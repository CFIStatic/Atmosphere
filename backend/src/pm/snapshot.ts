import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getSettings,
  listAreas,
  listAssignments,
  listDocuments,
  listEquipment,
  listMembers,
  listMilestones,
  listOriginKeys,
  listPlacements,
  listProjects,
  listReadings,
  listTasks,
} from './store.js';
import type { OrgSnapshot, ProjectContext, Project } from './types.js';

/**
 * Load everything the rules need, in a fixed number of queries.
 *
 * Eleven round trips for the whole organization, regardless of how many projects
 * it has. The alternative — fetching per project — turns a shop with forty open
 * jobs into several hundred queries per engine pass, which is the difference
 * between an automation that can run on every page load and one that has to be
 * a nightly batch.
 *
 * The rules are then pure functions over this snapshot. No rule touches the
 * database, which is what makes them cheap to test and impossible to make
 * accidentally quadratic.
 */

/**
 * How far back to pull readings.
 *
 * The drying rules look at trend over a handful of days; a job that has been
 * running for three months has hundreds of readings that no rule consults. This
 * is generous enough to cover a stalled dry-out and the stall threshold's
 * maximum of fourteen days, with room to spare.
 */
const READING_WINDOW_DAYS = 30;

export interface SnapshotOptions {
  /** Restrict to one project — used by the per-project "re-check now" path. */
  projectId?: string;
  /** Fixed clock for the pass, so every rule agrees on what "now" means. */
  now?: Date;
}

export async function loadOrgSnapshot(
  supabase: SupabaseClient,
  orgId: string,
  options: SnapshotOptions = {},
): Promise<OrgSnapshot> {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - READING_WINDOW_DAYS * 86_400_000);

  const settings = await getSettings(supabase, orgId);

  // Only projects that can still go wrong. A closed or cancelled job has no
  // outstanding obligations, and including them would mean every rule needed to
  // remember to filter — the sort of thing that gets forgotten in exactly one
  // rule and produces a permanent false alarm.
  const allProjects = await listProjects(supabase, orgId, {
    status: ['active', 'on_hold'],
    limit: 500,
  });
  const projects = options.projectId
    ? allProjects.filter((p) => p.id === options.projectId)
    : allProjects;

  // Nothing open: skip the rest of the round trips entirely. Ten queries saved
  // on every page load for an org between jobs.
  if (!projects.length) {
    return {
      orgId,
      settings,
      now,
      projects: [],
      equipment: await listEquipment(supabase, orgId),
      members: await listMembers(supabase, orgId),
    };
  }

  const [
    tasks,
    originKeys,
    assignments,
    areas,
    readings,
    placements,
    documents,
    milestones,
    equipment,
    members,
  ] = await Promise.all([
    listTasks(supabase, { orgId, open: true, completedSince: since }),
    listOriginKeys(supabase, orgId),
    listAssignments(supabase, { orgId, activeOnly: true }),
    listAreas(supabase, { orgId }),
    listReadings(supabase, { orgId, since }),
    listPlacements(supabase, { orgId, openOnly: true }),
    listDocuments(supabase, { orgId }),
    listMilestones(supabase, { orgId }),
    listEquipment(supabase, orgId),
    listMembers(supabase, orgId),
  ]);

  const byProject = <T extends { projectId: string }>(rows: T[]): Map<string, T[]> => {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      const list = map.get(row.projectId);
      if (list) list.push(row);
      else map.set(row.projectId, [row]);
    }
    return map;
  };

  const tasksBy = byProject(tasks);
  const assignmentsBy = byProject(assignments);
  const areasBy = byProject(areas);
  const readingsBy = byProject(readings);
  const placementsBy = byProject(placements);
  const documentsBy = byProject(documents);
  const milestonesBy = byProject(milestones);

  const contexts: ProjectContext[] = projects.map((project: Project) => ({
    project,
    tasks: tasksBy.get(project.id) ?? [],
    usedOriginKeys: originKeys.get(project.id) ?? [],
    assignments: assignmentsBy.get(project.id) ?? [],
    areas: areasBy.get(project.id) ?? [],
    readings: readingsBy.get(project.id) ?? [],
    placements: placementsBy.get(project.id) ?? [],
    documents: documentsBy.get(project.id) ?? [],
    milestones: milestonesBy.get(project.id) ?? [],
  }));

  return { orgId, settings, now, projects: contexts, equipment, members };
}
