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
import * as orch from './orchestration/store.js';
import type { OrgSnapshot, ProjectContext, Project } from './types.js';
import type {
  Approval,
  Communication,
  EquipmentPlanItem,
  PlatformLink,
  ProcurementRequest,
} from './orchestration/types.js';

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

/** Orchestration tables may not be applied yet — degrade to empty rather than 503 the cockpit. */
async function loadOrchestration(
  supabase: SupabaseClient,
  orgId: string,
): Promise<{
  links: PlatformLink[];
  communications: Communication[];
  pendingApprovals: Approval[];
  procurement: ProcurementRequest[];
  planItems: EquipmentPlanItem[];
}> {
  try {
    const [links, communications, pendingApprovals, procurement, planItems] = await Promise.all([
      orch.listLinks(supabase, orgId),
      orch.listCommunications(supabase, orgId, {
        status: ['new', 'reviewed'],
        limit: 500,
      }),
      orch.listApprovals(supabase, orgId, { status: ['pending'], limit: 500 }),
      orch.listProcurement(supabase, orgId, {
        status: ['open', 'bidding', 'awaiting_approval'],
        limit: 500,
      }),
      orch.listPlanItems(supabase, orgId, { status: ['needed', 'reserved', 'ordered'] }),
    ]);
    return { links, communications, pendingApprovals, procurement, planItems };
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === 'pm_orchestration_schema_missing') {
      return {
        links: [],
        communications: [],
        pendingApprovals: [],
        procurement: [],
        planItems: [],
      };
    }
    throw err;
  }
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

  const emptyOrchestration = {
    links: [] as PlatformLink[],
    communications: [] as Communication[],
    pendingApprovals: [] as Approval[],
    procurement: [] as ProcurementRequest[],
    planItems: [] as EquipmentPlanItem[],
  };

  // Nothing open: skip the rest of the round trips entirely. Ten queries saved
  // on every page load for an org between jobs.
  if (!projects.length) {
    const orchestration = await loadOrchestration(supabase, orgId);
    return {
      orgId,
      settings,
      now,
      projects: [],
      equipment: await listEquipment(supabase, orgId),
      members: await listMembers(supabase, orgId),
      pendingApprovals: orchestration.pendingApprovals.length
        ? orchestration.pendingApprovals
        : emptyOrchestration.pendingApprovals,
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
    orchestration,
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
    loadOrchestration(supabase, orgId),
  ]);

  const byProject = <T extends { projectId: string | null }>(rows: T[]): Map<string, T[]> => {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      if (!row.projectId) continue;
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
  const linksBy = byProject(orchestration.links);
  const commsBy = byProject(orchestration.communications);
  const procurementBy = byProject(orchestration.procurement);
  const planItemsBy = byProject(orchestration.planItems);

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
    platformLinks: linksBy.get(project.id) ?? [],
    communications: commsBy.get(project.id) ?? [],
    procurement: procurementBy.get(project.id) ?? [],
    planItems: planItemsBy.get(project.id) ?? [],
  }));

  return {
    orgId,
    settings,
    now,
    projects: contexts,
    equipment,
    members,
    pendingApprovals: orchestration.pendingApprovals,
  };
}
