import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { createUserClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { HttpError } from '../lib/errors.js';
import { draftProjectUpdate, generateBrief, writingEnabled } from '../pm/brief.js';
import { analyzeCompliance } from '../pm/compliance.js';
import { analyzeDrying } from '../pm/drying.js';
import { runEngine } from '../pm/engine.js';
import { projectHealth } from '../pm/health.js';
import { PHASE_SEQUENCE, playbookFor } from '../pm/playbooks.js';
import { ruleCatalogue } from '../pm/rules.js';
import { analyzeCrewLoad, analyzeSchedule } from '../pm/scheduling.js';
import { seedProject } from '../pm/seed.js';
import { loadOrgSnapshot } from '../pm/snapshot.js';
import * as store from '../pm/store.js';
import * as orch from '../pm/orchestration/store.js';
import { deriveEquipmentPlan } from '../pm/orchestration/equipmentFromEstimate.js';
import {
  connectPlatform,
  decideApproval,
  disconnectPlatform,
  linkProjectToPlatform,
  PLATFORM_CATALOGUE,
  syncPlatformLink,
} from '../pm/orchestration/platforms.js';
import {
  openDumpsterProcurement,
  openMaterialReferralOrder,
  selectBidForApproval,
} from '../pm/orchestration/procurement.js';
import { buildSituation } from '../pm/orchestration/situation.js';
import { ingestMention } from '../pm/orchestration/messaging.js';
import { config } from '../config.js';
import type { ProjectContext } from '../pm/types.js';
import {
  acceptPartnerInvite,
  claimAcceptedInvites,
  invitePartner,
  networkSummary,
} from '../pm/orchestration/network.js';
import * as netStore from '../pm/orchestration/networkStore.js';
import { createThread } from '../pm/orchestration/threads.js';
import {
  alertActionSchema,
  assertPhaseAllowed,
  assignCrewSchema,
  acceptPartnerInviteSchema,
  briefQuerySchema,
  communicationStatusSchema,
  connectPlatformSchema,
  createAreaSchema,
  createEquipmentSchema,
  createMilestoneSchema,
  createProjectSchema,
  createReadingsSchema,
  createTaskSchema,
  createThreadSchema,
  decideApprovalSchema,
  deriveEquipmentPlanSchema,
  draftUpdateSchema,
  dumpsterSearchSchema,
  linkPlatformSchema,
  manualCommunicationSchema,
  materialReferralSchema,
  partnerInviteSchema,
  partnerProfileSchema,
  placeEquipmentSchema,
  postThreadMessageSchema,
  projectQuerySchema,
  selectBidSchema,
  settingsSchema,
  syncPlatformSchema,
  updateAreaSchema,
  updateDocumentSchema,
  updateDraftSchema,
  updateMilestoneSchema,
  updateProjectSchema,
  updateTaskSchema,
  updateThreadSchema,
} from '../pm/validation.js';

export const pmRouter = Router();

/**
 * No body parser of its own. A moisture log for a whole visit — every affected
 * area plus controls — needs well over a login form's worth of JSON, and the
 * app-level parser already admits 256kb, which covers it. Mounting a second
 * `express.json()` here would be dead code either way: the first parser to run
 * consumes the stream, so a route-level limit is never the one enforced.
 */
pmRouter.use(requireAuth);

/** The engine touches every open project, so it is metered against re-firing. */
const engineLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many automation runs. Wait a moment.', code: 'rate_limited' },
});

/** Model calls cost credits, so drafting is metered separately and harder. */
const writingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many drafting requests. Wait a moment.', code: 'rate_limited' },
});

/* ------------------------------------------------------------------ *
 * Context helpers
 * ------------------------------------------------------------------ */

async function ctxOf(req: Request) {
  const supabase = createUserClient(req.accessToken!);
  const org = await store.resolveOrgContext(supabase, req.user!.id);
  return { supabase, org, userId: req.user!.id };
}

/** Load one project's full working set, for the detail screen and for drafting. */
async function loadProjectContext(
  supabase: ReturnType<typeof createUserClient>,
  orgId: string,
  projectId: string,
): Promise<ProjectContext> {
  const project = await store.getProject(supabase, projectId);
  if (!project || project.orgId !== orgId) {
    throw new HttpError(404, 'Project not found.', 'pm_not_found');
  }

  const [tasks, originKeys, assignments, areas, readings, placements, documents, milestones] =
    await Promise.all([
      store.listTasks(supabase, { projectId }),
      store.listOriginKeys(supabase, orgId),
      store.listAssignments(supabase, { projectId, activeOnly: true }),
      store.listAreas(supabase, { projectId }),
      store.listReadings(supabase, { projectId, limit: 2000 }),
      store.listPlacements(supabase, { projectId, openOnly: true }),
      store.listDocuments(supabase, { projectId }),
      store.listMilestones(supabase, { projectId }),
    ]);

  // Orchestration tables are optional until the migration is applied.
  let platformLinks: ProjectContext['platformLinks'] = [];
  let communications: ProjectContext['communications'] = [];
  let procurement: ProjectContext['procurement'] = [];
  let planItems: ProjectContext['planItems'] = [];
  try {
    const [links, comms, proc, items] = await Promise.all([
      orch.listLinks(supabase, orgId, { projectId }),
      orch.listCommunications(supabase, orgId, { projectId, limit: 100 }),
      orch.listProcurement(supabase, orgId, { projectId, limit: 100 }),
      orch.listPlanItems(supabase, orgId, { projectId }),
    ]);
    platformLinks = links;
    communications = comms;
    procurement = proc;
    planItems = items;
  } catch (err) {
    if ((err as { code?: string })?.code !== 'pm_orchestration_schema_missing') throw err;
  }

  return {
    project,
    // The detail screen shows every task; the analyzers only read the open ones,
    // and they filter for themselves.
    tasks,
    usedOriginKeys: originKeys.get(projectId) ?? [],
    assignments,
    areas,
    readings,
    placements,
    documents,
    milestones,
    platformLinks,
    communications,
    procurement,
    planItems,
  };
}

/* ------------------------------------------------------------------ *
 * Overview
 * ------------------------------------------------------------------ */

/**
 * GET /api/pm/overview
 * The cockpit: alerts, project health, crew load, and today's work in one call.
 */
pmRouter.get('/overview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org, userId } = await ctxOf(req);
    const snapshot = await loadOrgSnapshot(supabase, org.orgId);
    const alerts = await store.listAlerts(supabase, org.orgId, { limit: 200 });

    let orchestrationCounts = {
      pendingApprovals: 0,
      unreviewedComms: 0,
      openProcurement: 0,
    };
    try {
      const situation = await buildSituation(supabase, org.orgId, { limit: 1 });
      orchestrationCounts = {
        pendingApprovals: situation.counts.pendingApprovals,
        unreviewedComms: situation.counts.unreviewedComms,
        openProcurement: situation.counts.openProcurement,
      };
    } catch (err) {
      if ((err as { code?: string })?.code !== 'pm_orchestration_schema_missing') throw err;
    }

    const projects = snapshot.projects.map((ctx) => {
      const drying = analyzeDrying(ctx, snapshot.settings, snapshot.now);
      const schedule = analyzeSchedule(ctx, snapshot.now);
      const compliance = analyzeCompliance(ctx, snapshot.now, snapshot.settings.milestoneLeadDays);
      const health = projectHealth(ctx, drying, schedule, compliance);
      return {
        project: ctx.project,
        health,
        openTasks: ctx.tasks.length,
        overdueTasks: schedule.overdueTasks.length,
        crewCount: ctx.assignments.length,
        daysSinceActivity: schedule.daysSinceActivity,
        drying: drying.isDrying
          ? {
              openAreas: drying.openAreas,
              areasAtGoal: drying.areasAtGoal,
              areasOverdue: drying.areasOverdue,
              areasStalled: drying.areasStalled,
              daysDrying: drying.daysDrying,
              allAreasAtGoal: drying.allAreasAtGoal,
            }
          : null,
        documentation: {
          completionPct: compliance.completionPct,
          invoiceReady: compliance.invoiceReady,
          blocking: compliance.missingBlocking.length,
        },
      };
    });

    res.json({
      settings: snapshot.settings,
      role: org.role,
      canManage: org.canManage,
      writingEnabled: writingEnabled(),
      counts: {
        projects: projects.length,
        critical: alerts.filter((a) => a.severity === 'critical' && a.status === 'open').length,
        warn: alerts.filter((a) => a.severity === 'warn' && a.status === 'open').length,
        mine: projects.filter((p) => p.project.pmUserId === userId).length,
        pendingApprovals: orchestrationCounts.pendingApprovals,
        unreviewedComms: orchestrationCounts.unreviewedComms,
        openProcurement: orchestrationCounts.openProcurement,
      },
      alerts,
      projects,
      crew: analyzeCrewLoad(snapshot),
      members: snapshot.members,
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ *
 * Projects
 * ------------------------------------------------------------------ */

pmRouter.get('/projects', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org, userId } = await ctxOf(req);
    const q = projectQuerySchema.parse(req.query);
    const projects = await store.listProjects(supabase, org.orgId, {
      status: q.status ? q.status.split(',') : ['active', 'on_hold'],
      phase: q.phase,
      workType: q.workType,
      pmUserId: q.mine === 'true' ? userId : undefined,
      q: q.q,
      limit: q.limit,
    });
    res.json({ projects });
  } catch (err) {
    next(err);
  }
});

pmRouter.post('/projects', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    store.requireManager(org);
    const input = createProjectSchema.parse(req.body);

    const project = await store.createProject(supabase, org.orgId, {
      name: input.name,
      description: input.description ?? null,
      work_type: input.workType,
      loss_type: input.lossType ?? null,
      priority: input.priority ?? 'normal',
      pm_user_id: input.pmUserId ?? null,
      customer_name: input.customerName ?? null,
      customer_phone: input.customerPhone ?? null,
      customer_email: input.customerEmail || null,
      address_line1: input.addressLine1 ?? null,
      address_line2: input.addressLine2 ?? null,
      city: input.city ?? null,
      region: input.region ?? null,
      postal_code: input.postalCode ?? null,
      carrier: input.carrier ?? null,
      claim_number: input.claimNumber ?? null,
      adjuster_name: input.adjusterName ?? null,
      adjuster_email: input.adjusterEmail || null,
      adjuster_phone: input.adjusterPhone ?? null,
      deductible_cents: input.deductibleCents ?? null,
      approved_amount_cents: input.approvedAmountCents ?? null,
      loss_at: input.lossAt ?? null,
      scheduled_start_at: input.scheduledStartAt ?? null,
      target_completion_at: input.targetCompletionAt ?? null,
    });

    // A new project arrives with its checklist, its deadlines, and its first
    // phase of work already on it. This is most of what the automation is.
    const seeded = await seedProject(supabase, project);

    res.status(201).json({ project, seeded });
  } catch (err) {
    next(err);
  }
});

pmRouter.get('/projects/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    const settings = await store.getSettings(supabase, org.orgId);
    const ctx = await loadProjectContext(supabase, org.orgId, req.params.id!);
    const now = new Date();

    const drying = analyzeDrying(ctx, settings, now);
    const schedule = analyzeSchedule(ctx, now);
    const compliance = analyzeCompliance(ctx, now, settings.milestoneLeadDays);
    const health = projectHealth(ctx, drying, schedule, compliance);
    const alerts = await store.listAlerts(supabase, org.orgId, { projectId: ctx.project.id });
    const updates = await store.listUpdates(supabase, { projectId: ctx.project.id, limit: 50 });

    res.json({
      project: ctx.project,
      tasks: ctx.tasks,
      assignments: ctx.assignments,
      areas: ctx.areas,
      readings: ctx.readings.slice(0, 500),
      placements: ctx.placements,
      documents: ctx.documents,
      milestones: ctx.milestones,
      alerts,
      updates,
      analysis: { drying, schedule, compliance, health },
      phases: PHASE_SEQUENCE[ctx.project.workType],
      playbook: playbookFor(ctx.project.workType, ctx.project.phase),
      canManage: org.canManage,
    });
  } catch (err) {
    next(err);
  }
});

pmRouter.patch('/projects/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    store.requireManager(org);
    const input = updateProjectSchema.parse(req.body);

    const existing = await store.getProject(supabase, req.params.id!);
    if (!existing || existing.orgId !== org.orgId) {
      throw new HttpError(404, 'Project not found.', 'pm_not_found');
    }
    assertPhaseAllowed(input.workType ?? existing.workType, input.phase);

    const patch: Record<string, unknown> = {};
    const map: Record<string, string> = {
      name: 'name',
      description: 'description',
      workType: 'work_type',
      lossType: 'loss_type',
      status: 'status',
      phase: 'phase',
      priority: 'priority',
      pmUserId: 'pm_user_id',
      customerName: 'customer_name',
      customerPhone: 'customer_phone',
      customerEmail: 'customer_email',
      addressLine1: 'address_line1',
      addressLine2: 'address_line2',
      city: 'city',
      region: 'region',
      postalCode: 'postal_code',
      carrier: 'carrier',
      claimNumber: 'claim_number',
      adjusterName: 'adjuster_name',
      adjusterEmail: 'adjuster_email',
      adjusterPhone: 'adjuster_phone',
      deductibleCents: 'deductible_cents',
      approvedAmountCents: 'approved_amount_cents',
      lossAt: 'loss_at',
      scheduledStartAt: 'scheduled_start_at',
      targetCompletionAt: 'target_completion_at',
    };
    for (const [key, column] of Object.entries(map)) {
      const value = (input as Record<string, unknown>)[key];
      if (value !== undefined) patch[column] = value === '' ? null : value;
    }

    const project = await store.updateProject(supabase, req.params.id!, patch);

    // Moving phase brings the next phase's standard work with it.
    const seeded = input.phase ? await seedProject(supabase, project) : null;

    res.json({ project, seeded });
  } catch (err) {
    next(err);
  }
});

/** POST /api/pm/projects/:id/seed — regenerate the checklist and playbook. */
pmRouter.post('/projects/:id/seed', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    store.requireManager(org);
    const project = await store.getProject(supabase, req.params.id!);
    if (!project || project.orgId !== org.orgId) {
      throw new HttpError(404, 'Project not found.', 'pm_not_found');
    }
    res.json({ seeded: await seedProject(supabase, project) });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ *
 * Tasks
 * ------------------------------------------------------------------ */

pmRouter.post('/projects/:id/tasks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    store.requireManager(org);
    const input = createTaskSchema.parse(req.body);
    const task = await store.createTask(supabase, {
      project_id: req.params.id,
      title: input.title,
      details: input.details ?? null,
      category: input.category ?? 'general',
      priority: input.priority ?? 'normal',
      assigned_to: input.assignedTo ?? null,
      due_at: input.dueAt ?? null,
      position: input.position ?? 0,
      source: 'manual',
    });
    res.status(201).json({ task });
  } catch (err) {
    next(err);
  }
});

pmRouter.patch('/tasks/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase } = await ctxOf(req);
    const input = updateTaskSchema.parse(req.body);
    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.details !== undefined) patch.details = input.details;
    if (input.status !== undefined) patch.status = input.status;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.category !== undefined) patch.category = input.category;
    if (input.assignedTo !== undefined) patch.assigned_to = input.assignedTo;
    if (input.dueAt !== undefined) patch.due_at = input.dueAt;
    if (input.position !== undefined) patch.position = input.position;
    if (input.blockedReason !== undefined) patch.blocked_reason = input.blockedReason;

    // The policy and the guard trigger decide whether this caller may make this
    // particular change — a technician closing their own task is allowed, the
    // same technician reassigning it is not.
    res.json({ task: await store.updateTask(supabase, req.params.id!, patch) });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ *
 * Crew
 * ------------------------------------------------------------------ */

pmRouter.post('/projects/:id/crew', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    store.requireManager(org);
    const input = assignCrewSchema.parse(req.body);
    const assignment = await store.createAssignment(supabase, {
      project_id: req.params.id,
      user_id: input.userId,
      role_on_project: input.roleOnProject ?? 'crew',
      allocation_pct: input.allocationPct ?? 100,
    });
    res.status(201).json({ assignment });
  } catch (err) {
    next(err);
  }
});

pmRouter.post('/crew/:id/release', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    store.requireManager(org);
    res.json({ assignment: await store.releaseAssignment(supabase, req.params.id!) });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ *
 * Equipment
 * ------------------------------------------------------------------ */

pmRouter.get('/equipment', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    const [equipment, placements] = await Promise.all([
      store.listEquipment(supabase, org.orgId),
      store.listPlacements(supabase, { orgId: org.orgId, openOnly: true }),
    ]);
    res.json({ equipment, placements });
  } catch (err) {
    next(err);
  }
});

pmRouter.post('/equipment', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    store.requireManager(org);
    const input = createEquipmentSchema.parse(req.body);
    const equipment = await store.createEquipment(supabase, org.orgId, {
      asset_tag: input.assetTag,
      kind: input.kind,
      make_model: input.makeModel ?? null,
      capacity_pints_day: input.capacityPintsDay ?? null,
      capacity_cfm: input.capacityCfm ?? null,
      daily_rate_cents: input.dailyRateCents ?? null,
    });
    res.status(201).json({ equipment });
  } catch (err) {
    next(err);
  }
});

pmRouter.post('/projects/:id/equipment', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase } = await ctxOf(req);
    const input = placeEquipmentSchema.parse(req.body);
    const placement = await store.placeEquipment(supabase, {
      project_id: req.params.id,
      equipment_id: input.equipmentId,
      area_label: input.areaLabel ?? null,
      billed_rate_cents: input.billedRateCents ?? null,
    });
    res.status(201).json({ placement });
  } catch (err) {
    next(err);
  }
});

pmRouter.post('/placements/:id/remove', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, userId } = await ctxOf(req);
    res.json({ placement: await store.removePlacement(supabase, req.params.id!, userId) });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ *
 * Drying
 * ------------------------------------------------------------------ */

pmRouter.post('/projects/:id/areas', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase } = await ctxOf(req);
    const input = createAreaSchema.parse(req.body);
    const area = await store.createArea(supabase, {
      project_id: req.params.id,
      label: input.label,
      material: input.material ?? 'drywall',
      dry_goal_pct: input.dryGoalPct,
      water_class: input.waterClass ?? null,
      affected_sqft: input.affectedSqft ?? null,
      affected_cuft: input.affectedCuft ?? null,
    });
    res.status(201).json({ area });
  } catch (err) {
    next(err);
  }
});

pmRouter.patch('/areas/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, userId } = await ctxOf(req);
    const input = updateAreaSchema.parse(req.body);
    const patch: Record<string, unknown> = {};
    if (input.label !== undefined) patch.label = input.label;
    if (input.dryGoalPct !== undefined) patch.dry_goal_pct = input.dryGoalPct;
    if (input.waterClass !== undefined) patch.water_class = input.waterClass;
    if (input.affectedSqft !== undefined) patch.affected_sqft = input.affectedSqft;
    if (input.affectedCuft !== undefined) patch.affected_cuft = input.affectedCuft;
    if (input.signOff !== undefined) {
      patch.signed_off_at = input.signOff ? new Date().toISOString() : null;
      patch.signed_off_by = input.signOff ? userId : null;
      if (input.signOff) patch.dried_at = new Date().toISOString();
    }
    res.json({ area: await store.updateArea(supabase, req.params.id!, patch) });
  } catch (err) {
    next(err);
  }
});

pmRouter.post('/projects/:id/readings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase } = await ctxOf(req);
    const input = createReadingsSchema.parse(req.body);
    const { grainsPerPound } = await import('../pm/psychrometrics.js');

    const rows = input.readings.map((r) => ({
      project_id: req.params.id,
      area_id: r.areaId ?? null,
      kind: r.kind ?? 'affected',
      moisture_pct: r.moisturePct ?? null,
      temperature_f: r.temperatureF ?? null,
      humidity_pct: r.humidityPct ?? null,
      // Derived once, on the way in — drying progress is a falling GPP, and
      // recomputing it on every read of a long log is wasted work.
      gpp:
        r.temperatureF !== undefined && r.humidityPct !== undefined
          ? grainsPerPound(r.temperatureF, r.humidityPct)
          : null,
      note: r.note ?? null,
      taken_at: r.takenAt ?? new Date().toISOString(),
    }));

    res.status(201).json({ readings: await store.createReadings(supabase, rows) });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ *
 * Documents and milestones
 * ------------------------------------------------------------------ */

pmRouter.patch('/documents/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase } = await ctxOf(req);
    const input = updateDocumentSchema.parse(req.body);
    const patch: Record<string, unknown> = {};
    if (input.status !== undefined) patch.status = input.status;
    if (input.externalRef !== undefined) patch.external_ref = input.externalRef;
    if (input.note !== undefined) patch.note = input.note;
    if (input.waivedReason !== undefined) patch.waived_reason = input.waivedReason;
    res.json({ document: await store.updateDocument(supabase, req.params.id!, patch) });
  } catch (err) {
    next(err);
  }
});

pmRouter.post('/projects/:id/milestones', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    store.requireManager(org);
    const input = createMilestoneSchema.parse(req.body);
    const created = await store.createMilestonesIfAbsent(supabase, [
      {
        project_id: req.params.id,
        milestone_key: null,
        label: input.label,
        kind: input.kind ?? 'internal',
        due_at: input.dueAt,
        note: input.note ?? null,
      },
    ]);
    res.status(201).json({ milestone: created[0] ?? null });
  } catch (err) {
    next(err);
  }
});

pmRouter.patch('/milestones/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org, userId } = await ctxOf(req);
    store.requireManager(org);
    const input = updateMilestoneSchema.parse(req.body);
    const patch: Record<string, unknown> = {};
    if (input.label !== undefined) patch.label = input.label;
    if (input.dueAt !== undefined) patch.due_at = input.dueAt;
    if (input.note !== undefined) patch.note = input.note;
    if (input.complete !== undefined) {
      patch.completed_at = input.complete ? new Date().toISOString() : null;
      patch.completed_by = input.complete ? userId : null;
    }
    res.json({ milestone: await store.updateMilestone(supabase, req.params.id!, patch) });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ *
 * Alerts and the engine
 * ------------------------------------------------------------------ */

pmRouter.get('/alerts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    const statuses =
      typeof req.query.status === 'string'
        ? req.query.status.split(',')
        : ['open', 'acknowledged', 'snoozed'];
    res.json({ alerts: await store.listAlerts(supabase, org.orgId, { statuses }) });
  } catch (err) {
    next(err);
  }
});

pmRouter.post('/alerts/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase } = await ctxOf(req);
    const input = alertActionSchema.parse(req.body);
    const patch: Record<string, unknown> = { status: input.status };

    if (input.status === 'snoozed') {
      patch.snooze_until = new Date(Date.now() + input.snoozeHours! * 3_600_000).toISOString();
    }
    // 'handled' vs 'dismissed' is the difference between a fixed problem and an
    // ignored one, and the engine treats them differently on the next pass.
    if (input.status === 'resolved') patch.resolution = 'handled';
    if (input.status === 'dismissed') patch.resolution = 'dismissed';

    res.json({ alert: await store.updateAlert(supabase, req.params.id!, patch) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/pm/run
 * Evaluate every rule now. Optionally scoped to one project.
 */
pmRouter.post('/run', engineLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org, userId } = await ctxOf(req);
    const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : undefined;
    const result = await runEngine(supabase, org.orgId, {
      projectId,
      actorType: 'user',
      actorUserId: userId,
      actorLabel: req.user!.email ?? null,
    });
    res.json({ result });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ *
 * Brief and drafted updates
 * ------------------------------------------------------------------ */

pmRouter.get('/brief', writingLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org, userId } = await ctxOf(req);
    const q = briefQuerySchema.parse(req.query);
    const snapshot = await loadOrgSnapshot(supabase, org.orgId);
    const members = snapshot.members.find((m) => m.userId === userId);

    const brief = await generateBrief(supabase, snapshot, {
      userId,
      pmName: members?.fullName ?? members?.email ?? null,
      kind: q.kind ?? 'morning',
      reuseExisting: q.refresh !== 'true',
    });

    res.json({ brief, writingEnabled: writingEnabled() });
  } catch (err) {
    next(err);
  }
});

pmRouter.post(
  '/projects/:id/updates',
  writingLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { supabase, org, userId } = await ctxOf(req);
      const input = draftUpdateSchema.parse(req.body);
      const snapshot = await loadOrgSnapshot(supabase, org.orgId, { projectId: req.params.id });
      const ctx =
        snapshot.projects[0] ?? (await loadProjectContext(supabase, org.orgId, req.params.id!));

      const update = await draftProjectUpdate(supabase, snapshot, ctx, {
        userId,
        audience: input.audience,
        instruction: input.instruction,
      });
      res.status(201).json({ update });
    } catch (err) {
      next(err);
    }
  },
);

pmRouter.get('/updates', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    const statuses =
      typeof req.query.status === 'string' ? req.query.status.split(',') : ['draft', 'approved'];
    res.json({ updates: await store.listUpdates(supabase, { orgId: org.orgId, statuses }) });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/pm/updates/:id
 * Approve, mark sent, or discard. Nothing here delivers anything — marking an
 * update "sent" records that a human sent it, it does not send it.
 */
pmRouter.patch('/updates/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    store.requireManager(org);
    const input = updateDraftSchema.parse(req.body);
    res.json({ update: await store.updateUpdate(supabase, req.params.id!, { status: input.status }) });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

pmRouter.get('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    res.json({
      settings: await store.getSettings(supabase, org.orgId),
      rules: ruleCatalogue(),
      canManage: org.canManage,
      writingEnabled: writingEnabled(),
    });
  } catch (err) {
    next(err);
  }
});

pmRouter.patch('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    store.requireManager(org);
    const input = settingsSchema.parse(req.body);
    const patch: Record<string, unknown> = {};
    const map: Record<string, string> = {
      enabled: 'enabled',
      timezone: 'timezone',
      digestHour: 'digest_hour',
      readingIntervalHours: 'reading_interval_hours',
      dryingStallDays: 'drying_stall_days',
      dryingProgressMinPct: 'drying_progress_min_pct',
      equipmentIdleHours: 'equipment_idle_hours',
      staleProjectDays: 'stale_project_days',
      milestoneLeadDays: 'milestone_lead_days',
      maxProjectsPerCrew: 'max_projects_per_crew',
      disabledRules: 'disabled_rules',
      autoCreateTasks: 'auto_create_tasks',
    };
    for (const [key, column] of Object.entries(map)) {
      const value = (input as Record<string, unknown>)[key];
      if (value !== undefined) patch[column] = value;
    }
    patch.updated_by = req.user!.id;

    res.json({ settings: await store.updateSettings(supabase, org.orgId, patch) });
  } catch (err) {
    next(err);
  }
});

/** The rule catalogue, so the settings screen can name what it is switching off. */
pmRouter.get('/rules', (_req: Request, res: Response) => {
  res.json({ rules: ruleCatalogue() });
});

/* ------------------------------------------------------------------ *
 * Orchestration — platforms, messaging, equipment plans, procurement
 * ------------------------------------------------------------------ */

pmRouter.get('/situation', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    const projectId =
      typeof req.query.projectId === 'string' && req.query.projectId
        ? req.query.projectId
        : undefined;
    const situation = await buildSituation(supabase, org.orgId, { projectId });
    res.json(situation);
  } catch (err) {
    next(err);
  }
});

pmRouter.get('/platforms', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    const connections = await orch.listConnections(supabase, org.orgId);
    res.json({ catalogue: PLATFORM_CATALOGUE, connections });
  } catch (err) {
    next(err);
  }
});

pmRouter.post('/platforms/connect', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org, userId } = await ctxOf(req);
    store.requireManager(org);
    const input = connectPlatformSchema.parse(req.body);
    const connection = await connectPlatform(supabase, org.orgId, userId, input.platform, {
      label: input.label,
      externalAccountId: input.externalAccountId,
    });
    res.status(201).json({ connection });
  } catch (err) {
    next(err);
  }
});

pmRouter.post(
  '/platforms/:platform/disconnect',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { supabase, org } = await ctxOf(req);
      store.requireManager(org);
      const platform = connectPlatformSchema.shape.platform.parse(req.params.platform);
      const connection = await disconnectPlatform(supabase, org.orgId, platform);
      res.json({ connection });
    } catch (err) {
      next(err);
    }
  },
);

pmRouter.get('/projects/:id/platforms', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    const links = await orch.listLinks(supabase, org.orgId, { projectId: req.params.id });
    const events = await orch.listPlatformEvents(supabase, org.orgId, {
      projectId: req.params.id,
      limit: 50,
    });
    res.json({ links, events });
  } catch (err) {
    next(err);
  }
});

pmRouter.post('/projects/:id/platforms', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org, userId } = await ctxOf(req);
    store.requireManager(org);
    const input = linkPlatformSchema.parse(req.body);
    const result = await linkProjectToPlatform(supabase, org.orgId, userId, {
      projectId: req.params.id!,
      platform: input.platform,
      externalId: input.externalId,
      externalUrl: input.externalUrl,
      externalLabel: input.externalLabel,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

pmRouter.post('/platforms/links/:id/sync', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org, userId } = await ctxOf(req);
    store.requireManager(org);
    const input = syncPlatformSchema.parse(req.body);
    const result = await syncPlatformLink(supabase, org.orgId, userId, {
      linkId: req.params.id!,
      summary: input.summary,
      detail: input.detail,
      payload: input.payload,
      proposeAction: input.proposeAction ?? null,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

pmRouter.get('/approvals', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    const status =
      typeof req.query.status === 'string' && req.query.status
        ? req.query.status.split(',')
        : ['pending'];
    const approvals = await orch.listApprovals(supabase, org.orgId, {
      status,
      projectId: typeof req.query.projectId === 'string' ? req.query.projectId : undefined,
    });
    res.json({ approvals });
  } catch (err) {
    next(err);
  }
});

pmRouter.post('/approvals/:id/decide', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org, userId } = await ctxOf(req);
    store.requireManager(org);
    const input = decideApprovalSchema.parse(req.body);
    const approval = await decideApproval(supabase, userId, {
      approvalId: req.params.id!,
      decision: input.decision,
      note: input.note,
    });
    res.json({ approval });
  } catch (err) {
    next(err);
  }
});

pmRouter.get('/communications', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    const status =
      typeof req.query.status === 'string' && req.query.status
        ? req.query.status.split(',')
        : undefined;
    const communications = await orch.listCommunications(supabase, org.orgId, {
      status,
      projectId: typeof req.query.projectId === 'string' ? req.query.projectId : undefined,
      limit: 100,
    });
    res.json({ communications });
  } catch (err) {
    next(err);
  }
});

pmRouter.post('/communications', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org, userId } = await ctxOf(req);
    const input = manualCommunicationSchema.parse(req.body);
    const result = await ingestMention(
      supabase,
      {
        orgId: org.orgId,
        channel: input.channel,
        body: input.body,
        counterpartyName: input.counterpartyName,
        counterpartyHandle: input.counterpartyHandle,
        counterpartyKind: input.counterpartyKind,
        projectId: input.projectId,
        occurredAt: input.occurredAt,
        intake: 'manual',
        metadata: { recordedBy: userId },
      },
      { recordedBy: userId },
    );
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

pmRouter.patch('/communications/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org, userId } = await ctxOf(req);
    const input = communicationStatusSchema.parse(req.body);
    const patch: Record<string, unknown> = {
      status: input.status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: userId,
    };
    if (input.projectId !== undefined) patch.project_id = input.projectId;
    const communication = await orch.updateCommunication(supabase, req.params.id!, patch);
    if (communication.orgId !== org.orgId) {
      throw new HttpError(404, 'Communication not found.', 'pm_not_found');
    }
    res.json({ communication });
  } catch (err) {
    next(err);
  }
});

pmRouter.post(
  '/projects/:id/equipment-plan',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { supabase, org, userId } = await ctxOf(req);
      store.requireManager(org);
      const input = deriveEquipmentPlanSchema.parse(req.body);
      const derived = deriveEquipmentPlan({
        source:
          input.source === 'manual' || input.source === 's500'
            ? 'mitigation_estimate'
            : input.source,
        sourceRef: input.sourceRef,
        equipment: input.equipment,
        lineItems: input.lineItems,
        materials: input.materials,
      });

      const plan = await orch.createEquipmentPlan(supabase, org.orgId, {
        project_id: req.params.id,
        source: input.source,
        source_ref: input.sourceRef ?? null,
        status: input.approve ? 'approved' : 'draft',
        summary: derived.summary,
        dumpster_required: derived.dumpsterRequired,
        created_by: userId,
        approved_by: input.approve ? userId : null,
        approved_at: input.approve ? new Date().toISOString() : null,
      });

      const items = await orch.insertPlanItems(
        supabase,
        org.orgId,
        derived.items.map((item) => ({
          plan_id: plan.id,
          project_id: req.params.id,
          item_kind: item.itemKind,
          label: item.label,
          quantity: item.quantity,
          unit: item.unit,
          fulfillment: item.fulfillment,
          status: 'needed',
          notes: item.notes ?? null,
          estimate_code: item.estimateCode ?? null,
          metadata: item.metadata ?? {},
        })),
      );

      // Dumpster on an approved plan → open procurement automatically.
      let dumpsterRequest = null;
      if (input.approve && derived.dumpsterRequired) {
        const dumpsterItem = items.find((i) => i.itemKind === 'dumpster');
        const project = await store.getProject(supabase, req.params.id!);
        dumpsterRequest = await openDumpsterProcurement(supabase, org.orgId, userId, {
          projectId: req.params.id!,
          planItemId: dumpsterItem?.id,
          postal: project?.postalCode,
          address: [project?.addressLine1, project?.city, project?.region]
            .filter(Boolean)
            .join(', '),
          sizeHint: '20 yard',
          searchUrl: config.pm.webSearchUrl || undefined,
        });
      }

      res.status(201).json({ plan, items, derived, dumpsterRequest });
    } catch (err) {
      next(err);
    }
  },
);

pmRouter.get(
  '/projects/:id/equipment-plan',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { supabase, org } = await ctxOf(req);
      const plans = await orch.listEquipmentPlans(supabase, org.orgId, {
        projectId: req.params.id,
      });
      const items = await orch.listPlanItems(supabase, org.orgId, { projectId: req.params.id });
      res.json({ plans, items });
    } catch (err) {
      next(err);
    }
  },
);

pmRouter.get('/procurement', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    const requests = await orch.listProcurement(supabase, org.orgId, {
      projectId: typeof req.query.projectId === 'string' ? req.query.projectId : undefined,
      limit: 100,
    });
    res.json({ requests });
  } catch (err) {
    next(err);
  }
});

pmRouter.get('/procurement/referrals', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    const referrals = await orch.listReferrals(supabase, org.orgId);
    res.json({ referrals });
  } catch (err) {
    next(err);
  }
});

pmRouter.post(
  '/projects/:id/procurement/dumpster',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { supabase, org, userId } = await ctxOf(req);
      store.requireManager(org);
      const input = dumpsterSearchSchema.parse(req.body);
      const project = await store.getProject(supabase, req.params.id!);
      if (!project || project.orgId !== org.orgId) {
        throw new HttpError(404, 'Project not found.', 'pm_not_found');
      }
      const result = await openDumpsterProcurement(supabase, org.orgId, userId, {
        projectId: req.params.id!,
        planItemId: input.planItemId,
        title: input.title,
        description: input.description,
        sizeHint: input.sizeHint,
        postal: input.postal ?? project.postalCode,
        address:
          input.address ??
          [project.addressLine1, project.city, project.region].filter(Boolean).join(', '),
        searchUrl: config.pm.webSearchUrl || undefined,
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

pmRouter.post(
  '/projects/:id/procurement/materials',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { supabase, org, userId } = await ctxOf(req);
      store.requireManager(org);
      const input = materialReferralSchema.parse(req.body);
      const project = await store.getProject(supabase, req.params.id!);
      if (!project || project.orgId !== org.orgId) {
        throw new HttpError(404, 'Project not found.', 'pm_not_found');
      }
      const result = await openMaterialReferralOrder(supabase, org.orgId, userId, {
        projectId: req.params.id!,
        planItemId: input.planItemId,
        vendorKey: input.vendorKey,
        title: input.title,
        query: input.query,
        postal: input.postal ?? project.postalCode,
        address: input.address,
        orgSlug: org.orgId.slice(0, 8),
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

pmRouter.get(
  '/procurement/:id/bids',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { supabase, org } = await ctxOf(req);
      const requests = await orch.listProcurement(supabase, org.orgId, { limit: 500 });
      const request = requests.find((r) => r.id === req.params.id);
      if (!request) throw new HttpError(404, 'Procurement request not found.', 'pm_not_found');
      const bids = await orch.listBids(supabase, request.id);
      res.json({ request, bids });
    } catch (err) {
      next(err);
    }
  },
);

pmRouter.post(
  '/procurement/:id/select-bid',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { supabase, org, userId } = await ctxOf(req);
      store.requireManager(org);
      const input = selectBidSchema.parse(req.body);
      const result = await selectBidForApproval(supabase, org.orgId, userId, {
        requestId: req.params.id!,
        bidId: input.bidId,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

/* ------------------------------------------------------------------ *
 * Partner network + adaptive internal threads
 * ------------------------------------------------------------------ */

pmRouter.get('/network', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org, userId } = await ctxOf(req);
    // Materialise any invites that accepted while we were away.
    try {
      await claimAcceptedInvites(supabase, org.orgId, userId);
    } catch (err) {
      if ((err as { code?: string })?.code !== 'pm_network_schema_missing') {
        /* non-fatal */
      }
    }
    const orgName =
      (req as { membership?: { org?: { name?: string } } }).membership?.org?.name ||
      'Atmosphere org';
    // Prefer the name from org_members join if available via a cheap profiles peek —
    // networkSummary will upsert a profile with this fallback.
    const summary = await networkSummary(supabase, org.orgId, orgName);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

pmRouter.patch('/network/profile', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    store.requireManager(org);
    const input = partnerProfileSchema.parse(req.body);
    const patch: Record<string, unknown> = {};
    if (input.displayName !== undefined) patch.display_name = input.displayName;
    if (input.kind !== undefined) patch.kind = input.kind;
    if (input.blurb !== undefined) patch.blurb = input.blurb ?? null;
    if (input.trades !== undefined) patch.trades = input.trades;
    if (input.serviceAreas !== undefined) patch.service_areas = input.serviceAreas;
    if (input.phone !== undefined) patch.phone = input.phone ?? null;
    if (input.email !== undefined) patch.email = input.email ?? null;
    if (input.website !== undefined) patch.website = input.website ?? null;
    if (input.discoverable !== undefined) patch.discoverable = input.discoverable;
    const profile = await netStore.upsertProfile(supabase, org.orgId, patch);
    res.json({ profile });
  } catch (err) {
    next(err);
  }
});

pmRouter.post('/network/invites', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org, userId } = await ctxOf(req);
    store.requireManager(org);
    const input = partnerInviteSchema.parse(req.body);
    const result = await invitePartner(supabase, org.orgId, userId, {
      ...input,
      orgName: 'Atmosphere org',
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

pmRouter.post(
  '/network/invites/:id/revoke',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { supabase, org } = await ctxOf(req);
      store.requireManager(org);
      const invite = await netStore.updateInvite(supabase, req.params.id!, {
        status: 'revoked',
      });
      if (invite.orgId !== org.orgId) {
        throw new HttpError(404, 'Invite not found.', 'pm_not_found');
      }
      res.json({ invite });
    } catch (err) {
      next(err);
    }
  },
);

pmRouter.post('/network/accept', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org, userId } = await ctxOf(req);
    store.requireManager(org);
    const input = acceptPartnerInviteSchema.parse(req.body);
    const result = await acceptPartnerInvite(supabase, org.orgId, userId, input.token, {
      displayName: input.displayName,
      kind: input.kind,
      trades: input.trades,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

pmRouter.get('/threads', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    const threads = await netStore.listThreads(supabase, org.orgId, {
      projectId: typeof req.query.projectId === 'string' ? req.query.projectId : undefined,
      status:
        typeof req.query.status === 'string' && req.query.status
          ? req.query.status.split(',')
          : ['open'],
    });
    res.json({ threads });
  } catch (err) {
    next(err);
  }
});

pmRouter.post('/threads', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org, userId } = await ctxOf(req);
    const input = createThreadSchema.parse(req.body);
    const thread = await createThread(supabase, org.orgId, userId, {
      kind: input.kind,
      mode: input.mode ?? 'live',
      title: input.title,
      urgency: input.urgency ?? 'normal',
      projectId: input.projectId,
      partnershipId: input.partnershipId,
      seedMessage: input.seedMessage,
      participantUserIds: input.participantUserIds,
    });
    res.status(201).json({ thread });
  } catch (err) {
    next(err);
  }
});

pmRouter.get('/threads/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org } = await ctxOf(req);
    const threads = await netStore.listThreads(supabase, org.orgId, {
      status: ['open', 'resolved', 'archived'],
      limit: 500,
    });
    const thread = threads.find((t) => t.id === req.params.id);
    if (!thread) throw new HttpError(404, 'Thread not found.', 'pm_not_found');
    const [messages, participants] = await Promise.all([
      netStore.listMessages(supabase, thread.id),
      netStore.listParticipants(supabase, thread.id),
    ]);
    res.json({ thread, messages, participants });
  } catch (err) {
    next(err);
  }
});

pmRouter.patch('/threads/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, org, userId } = await ctxOf(req);
    const input = updateThreadSchema.parse(req.body);
    const patch: Record<string, unknown> = {};
    if (input.status !== undefined) {
      patch.status = input.status;
      if (input.status === 'resolved') {
        patch.resolved_at = new Date().toISOString();
        patch.resolved_by = userId;
      }
    }
    if (input.mode !== undefined) patch.mode = input.mode;
    if (input.urgency !== undefined) patch.urgency = input.urgency;
    if (input.title !== undefined) patch.title = input.title;
    const thread = await netStore.updateThread(supabase, req.params.id!, patch);
    if (thread.orgId !== org.orgId) {
      throw new HttpError(404, 'Thread not found.', 'pm_not_found');
    }
    res.json({ thread });
  } catch (err) {
    next(err);
  }
});

pmRouter.post(
  '/threads/:id/messages',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { supabase, org, userId } = await ctxOf(req);
      const input = postThreadMessageSchema.parse(req.body);
      const threads = await netStore.listThreads(supabase, org.orgId, {
        status: ['open', 'resolved'],
        limit: 500,
      });
      const thread = threads.find((t) => t.id === req.params.id);
      if (!thread) throw new HttpError(404, 'Thread not found.', 'pm_not_found');
      if (thread.status !== 'open') {
        throw new HttpError(409, 'Thread is not open.', 'pm_thread_closed');
      }
      await netStore.addParticipant(supabase, org.orgId, {
        thread_id: thread.id,
        user_id: userId,
        role_in_thread: 'member',
      });
      const message = await netStore.postMessage(supabase, org.orgId, {
        thread_id: thread.id,
        author_user_id: userId,
        author_kind: 'user',
        body: input.body,
        payload: input.payload ?? {},
      });
      res.status(201).json({ message });
    } catch (err) {
      next(err);
    }
  },
);
