import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../lib/errors.js';
import type {
  Alert,
  Assignment,
  AutomationSettings,
  Brief,
  DryingArea,
  Equipment,
  Milestone,
  MoistureReading,
  Placement,
  Project,
  ProjectDocument,
  ProjectUpdate,
  Task,
} from './types.js';

/**
 * Persistence for the Project Manager Agent.
 *
 * Every read and write goes through the caller's own Supabase client, so Row
 * Level Security decides what is visible — the same contract the rest of this
 * backend holds to. The service-role key is never used here.
 *
 * That applies to the automation engine too. The engine is not a privileged
 * background process reaching across orgs; it is code that runs inside somebody's
 * session and can therefore see exactly what that person can see. If the agent
 * can reach data a human in that seat could not, that is a bug.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Postgres/PostgREST codes meaning "the table isn't there". */
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205', 'PGRST202']);

/**
 * Turn a Supabase error into something actionable.
 *
 * The missing-table case is called out because it has exactly one cause — the
 * migration has not been applied — and a generic 500 sends someone hunting
 * through logs for it.
 */
function fail(error: { code?: string; message: string }, action: string): never {
  if (error.code && MISSING_TABLE_CODES.has(error.code)) {
    throw new HttpError(
      503,
      'The Project Manager tables are not set up on this Supabase project yet. Apply supabase/migrations/20260727150000_project_manager_agent.sql, then try again.',
      'pm_schema_missing',
    );
  }
  // RLS refusals surface as 42501 (or an empty result on UPDATE). Saying
  // "permission" rather than "server error" is the difference between a user
  // adjusting what they did and a user filing a bug.
  if (error.code === '42501') {
    throw new HttpError(403, error.message, 'pm_forbidden');
  }
  throw new HttpError(500, `${action}: ${error.message}`, 'pm_store_failed');
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/* ------------------------------------------------------------------ *
 * Serialisers — snake_case in, camelCase out. The boundary is here.
 * ------------------------------------------------------------------ */

export function serializeProject(r: any): Project {
  return {
    id: r.id,
    orgId: r.org_id,
    projectNumber: r.project_number,
    seqNo: r.seq_no,
    name: r.name,
    description: r.description ?? null,
    workType: r.work_type,
    lossType: r.loss_type ?? null,
    status: r.status,
    phase: r.phase,
    priority: r.priority,
    pmUserId: r.pm_user_id ?? null,
    customerName: r.customer_name ?? null,
    customerPhone: r.customer_phone ?? null,
    customerEmail: r.customer_email ?? null,
    addressLine1: r.address_line1 ?? null,
    addressLine2: r.address_line2 ?? null,
    city: r.city ?? null,
    region: r.region ?? null,
    postalCode: r.postal_code ?? null,
    carrier: r.carrier ?? null,
    claimNumber: r.claim_number ?? null,
    adjusterName: r.adjuster_name ?? null,
    adjusterEmail: r.adjuster_email ?? null,
    adjusterPhone: r.adjuster_phone ?? null,
    deductibleCents: num(r.deductible_cents),
    approvedAmountCents: num(r.approved_amount_cents),
    lossAt: r.loss_at ?? null,
    scheduledStartAt: r.scheduled_start_at ?? null,
    targetCompletionAt: r.target_completion_at ?? null,
    startedAt: r.started_at ?? null,
    completedAt: r.completed_at ?? null,
    closedAt: r.closed_at ?? null,
    sourceLeadId: r.source_lead_id ?? null,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function serializeTask(r: any): Task {
  return {
    id: r.id,
    orgId: r.org_id,
    projectId: r.project_id,
    title: r.title,
    details: r.details ?? null,
    status: r.status,
    priority: r.priority,
    category: r.category,
    assignedTo: r.assigned_to ?? null,
    dueAt: r.due_at ?? null,
    position: r.position ?? 0,
    source: r.source,
    originKey: r.origin_key ?? null,
    agentRunId: r.agent_run_id ?? null,
    blockedReason: r.blocked_reason ?? null,
    completedAt: r.completed_at ?? null,
    completedBy: r.completed_by ?? null,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function serializeAssignment(r: any): Assignment {
  return {
    id: r.id,
    orgId: r.org_id,
    projectId: r.project_id,
    userId: r.user_id,
    roleOnProject: r.role_on_project,
    allocationPct: r.allocation_pct,
    assignedBy: r.assigned_by,
    assignedAt: r.assigned_at,
    releasedAt: r.released_at ?? null,
  };
}

export function serializeEquipment(r: any): Equipment {
  return {
    id: r.id,
    orgId: r.org_id,
    assetTag: r.asset_tag,
    kind: r.kind,
    makeModel: r.make_model ?? null,
    capacityPintsDay: num(r.capacity_pints_day),
    capacityCfm: num(r.capacity_cfm),
    status: r.status,
    dailyRateCents: num(r.daily_rate_cents),
    createdAt: r.created_at,
  };
}

export function serializePlacement(r: any): Placement {
  const e = Array.isArray(r.pm_equipment) ? r.pm_equipment[0] : r.pm_equipment;
  return {
    id: r.id,
    orgId: r.org_id,
    projectId: r.project_id,
    equipmentId: r.equipment_id,
    areaLabel: r.area_label ?? null,
    placedAt: r.placed_at,
    removedAt: r.removed_at ?? null,
    billedRateCents: num(r.billed_rate_cents),
    equipment: e
      ? {
          assetTag: e.asset_tag,
          kind: e.kind,
          capacityPintsDay: num(e.capacity_pints_day),
          capacityCfm: num(e.capacity_cfm),
        }
      : null,
  };
}

export function serializeArea(r: any): DryingArea {
  return {
    id: r.id,
    orgId: r.org_id,
    projectId: r.project_id,
    label: r.label,
    material: r.material,
    dryGoalPct: Number(r.dry_goal_pct),
    waterClass: num(r.water_class),
    affectedSqft: num(r.affected_sqft),
    affectedCuft: num(r.affected_cuft),
    establishedAt: r.established_at,
    driedAt: r.dried_at ?? null,
    signedOffAt: r.signed_off_at ?? null,
    signedOffBy: r.signed_off_by ?? null,
  };
}

export function serializeReading(r: any): MoistureReading {
  return {
    id: r.id,
    orgId: r.org_id,
    projectId: r.project_id,
    areaId: r.area_id ?? null,
    kind: r.kind,
    moisturePct: num(r.moisture_pct),
    temperatureF: num(r.temperature_f),
    humidityPct: num(r.humidity_pct),
    gpp: num(r.gpp),
    note: r.note ?? null,
    takenAt: r.taken_at,
    takenBy: r.taken_by,
  };
}

export function serializeDocument(r: any): ProjectDocument {
  return {
    id: r.id,
    orgId: r.org_id,
    projectId: r.project_id,
    requirementKey: r.requirement_key,
    label: r.label,
    kind: r.kind,
    status: r.status,
    externalRef: r.external_ref ?? null,
    note: r.note ?? null,
    isBlocking: r.is_blocking,
    requiredByPhase: r.required_by_phase ?? null,
    providedAt: r.provided_at ?? null,
    providedBy: r.provided_by ?? null,
    waivedReason: r.waived_reason ?? null,
  };
}

export function serializeMilestone(r: any): Milestone {
  return {
    id: r.id,
    orgId: r.org_id,
    projectId: r.project_id,
    milestoneKey: r.milestone_key ?? null,
    label: r.label,
    kind: r.kind,
    dueAt: r.due_at,
    completedAt: r.completed_at ?? null,
    completedBy: r.completed_by ?? null,
    note: r.note ?? null,
  };
}

export function serializeAlert(r: any): Alert {
  const p = Array.isArray(r.pm_projects) ? r.pm_projects[0] : r.pm_projects;
  return {
    id: r.id,
    orgId: r.org_id,
    projectId: r.project_id ?? null,
    ruleKey: r.rule_key,
    fingerprint: r.fingerprint,
    severity: r.severity,
    category: r.category,
    title: r.title,
    detail: r.detail ?? null,
    suggestedAction: r.suggested_action ?? null,
    entityType: r.entity_type ?? null,
    entityId: r.entity_id ?? null,
    facts: r.facts ?? {},
    status: r.status,
    resolution: r.resolution ?? null,
    snoozeUntil: r.snooze_until ?? null,
    occurrences: r.occurrences,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    acknowledgedAt: r.acknowledged_at ?? null,
    resolvedAt: r.resolved_at ?? null,
    agentRunId: r.agent_run_id ?? null,
    project: p ? { id: p.id, projectNumber: p.project_number, name: p.name } : null,
  };
}

export function serializeBrief(r: any): Brief {
  return {
    id: r.id,
    orgId: r.org_id,
    userId: r.user_id,
    forDate: r.for_date,
    kind: r.kind,
    facts: r.facts ?? {},
    headline: r.headline ?? null,
    body: r.body,
    modelId: r.model_id ?? null,
    agentRunId: r.agent_run_id ?? null,
    createdAt: r.created_at,
  };
}

export function serializeUpdate(r: any): ProjectUpdate {
  return {
    id: r.id,
    orgId: r.org_id,
    projectId: r.project_id,
    audience: r.audience,
    channel: r.channel,
    status: r.status,
    subject: r.subject ?? null,
    body: r.body,
    origin: r.origin,
    modelId: r.model_id ?? null,
    agentRunId: r.agent_run_id ?? null,
    createdBy: r.created_by,
    approvedBy: r.approved_by ?? null,
    sentAt: r.sent_at ?? null,
    createdAt: r.created_at,
  };
}

function serializeSettings(r: any): AutomationSettings {
  return {
    orgId: r.org_id,
    enabled: r.enabled,
    timezone: r.timezone,
    digestHour: r.digest_hour,
    readingIntervalHours: r.reading_interval_hours,
    dryingStallDays: r.drying_stall_days,
    dryingProgressMinPct: Number(r.drying_progress_min_pct),
    equipmentIdleHours: r.equipment_idle_hours,
    staleProjectDays: r.stale_project_days,
    milestoneLeadDays: r.milestone_lead_days,
    maxProjectsPerCrew: r.max_projects_per_crew,
    disabledRules: r.disabled_rules ?? [],
    autoCreateTasks: r.auto_create_tasks,
    updatedAt: r.updated_at,
  };
}

/* ------------------------------------------------------------------ *
 * Caller context
 * ------------------------------------------------------------------ */

export interface OrgContext {
  orgId: string;
  role: string;
  /** Whether this caller may change the plan, as opposed to report against it. */
  canManage: boolean;
}

const MANAGER_ROLES = new Set(['project_manager', 'office_manager']);

/**
 * The caller's organization and what they are allowed to do in it.
 *
 * `canManage` here is a convenience for shaping the UI and for returning a clean
 * 403 instead of an opaque RLS refusal. It is *not* the boundary — the policies
 * in the migration are. Nothing may rely on this check alone.
 */
export async function resolveOrgContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<OrgContext> {
  const { data, error } = await supabase
    .from('org_members')
    .select('org_id, role')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) fail(error, 'resolve organization');

  const row = data?.[0];
  if (!row) {
    throw new HttpError(
      409,
      'Finish onboarding — you need to be linked to an organization first.',
      'pm_no_org',
    );
  }
  return { orgId: row.org_id, role: row.role, canManage: MANAGER_ROLES.has(row.role) };
}

export function requireManager(ctx: OrgContext): void {
  if (!ctx.canManage) {
    throw new HttpError(
      403,
      'Only a project manager or office manager can change a project.',
      'pm_forbidden',
    );
  }
}

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

/**
 * The org's automation settings, creating the defaults row on first read.
 *
 * Insert-then-reread rather than upsert: two sessions opening the app at the
 * same moment would otherwise race, and the loser's upsert would overwrite
 * whatever the winner wrote with defaults. A conflicting insert is ignored and
 * we re-read, so the row is created exactly once and never clobbered.
 */
export async function getSettings(
  supabase: SupabaseClient,
  orgId: string,
): Promise<AutomationSettings> {
  const read = async () => {
    const { data, error } = await supabase
      .from('pm_automation_settings')
      .select('*')
      .eq('org_id', orgId)
      .maybeSingle();
    if (error) fail(error, 'read automation settings');
    return data;
  };

  const existing = await read();
  if (existing) return serializeSettings(existing);

  const { error: insertError } = await supabase
    .from('pm_automation_settings')
    .insert({ org_id: orgId });
  // 23505 = someone else created it in the gap, which is the expected race.
  if (insertError && insertError.code !== '23505') fail(insertError, 'create automation settings');

  const created = await read();
  if (!created) {
    throw new HttpError(500, 'Could not create automation settings', 'pm_settings_failed');
  }
  return serializeSettings(created);
}

export async function updateSettings(
  supabase: SupabaseClient,
  orgId: string,
  patch: Record<string, unknown>,
): Promise<AutomationSettings> {
  const { data, error } = await supabase
    .from('pm_automation_settings')
    .update(patch)
    .eq('org_id', orgId)
    .select('*')
    .maybeSingle();
  if (error) fail(error, 'update automation settings');
  if (!data) {
    // The UPDATE policy's USING clause hid the row rather than raising.
    throw new HttpError(403, 'Only a project manager can change automation settings.', 'pm_forbidden');
  }
  return serializeSettings(data);
}

/* ------------------------------------------------------------------ *
 * Projects
 * ------------------------------------------------------------------ */

export interface ProjectFilters {
  status?: string[];
  phase?: string;
  pmUserId?: string;
  workType?: string;
  q?: string;
  limit?: number;
}

export async function listProjects(
  supabase: SupabaseClient,
  orgId: string,
  filters: ProjectFilters = {},
): Promise<Project[]> {
  let query = supabase.from('pm_projects').select('*').eq('org_id', orgId);

  if (filters.status?.length) query = query.in('status', filters.status);
  if (filters.phase) query = query.eq('phase', filters.phase);
  if (filters.pmUserId) query = query.eq('pm_user_id', filters.pmUserId);
  if (filters.workType) query = query.eq('work_type', filters.workType);
  if (filters.q) {
    // Escaping matters: a comma or parenthesis in the search box would
    // otherwise be read as PostgREST filter syntax.
    const term = filters.q.replace(/[,()\\]/g, ' ').trim();
    if (term) {
      const like = `%${term}%`;
      query = query.or(
        `name.ilike.${like},project_number.ilike.${like},customer_name.ilike.${like},claim_number.ilike.${like},address_line1.ilike.${like}`,
      );
    }
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(Math.min(filters.limit ?? 200, 500));
  if (error) fail(error, 'list projects');
  return (data ?? []).map(serializeProject);
}

export async function getProject(supabase: SupabaseClient, id: string): Promise<Project | null> {
  const { data, error } = await supabase.from('pm_projects').select('*').eq('id', id).maybeSingle();
  if (error) fail(error, 'read project');
  return data ? serializeProject(data) : null;
}

export async function createProject(
  supabase: SupabaseClient,
  orgId: string,
  input: Record<string, unknown>,
): Promise<Project> {
  const { data, error } = await supabase
    .from('pm_projects')
    .insert({ ...input, org_id: orgId })
    .select('*')
    .single();
  if (error) fail(error, 'create project');
  return serializeProject(data);
}

export async function updateProject(
  supabase: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<Project> {
  const { data, error } = await supabase
    .from('pm_projects')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) fail(error, 'update project');
  if (!data) throw new HttpError(404, 'Project not found, or not yours to change.', 'pm_not_found');
  return serializeProject(data);
}

/* ------------------------------------------------------------------ *
 * Tasks
 * ------------------------------------------------------------------ */

export async function listTasks(
  supabase: SupabaseClient,
  where: {
    orgId?: string;
    projectId?: string;
    assignedTo?: string;
    open?: boolean;
    /**
     * Also include tasks finished since this instant.
     *
     * The engine needs these: "has anyone spoken to the customer this week?"
     * and "has anything happened on this job?" are both answered by work that
     * is *done*, and a snapshot of open work only would answer no every time —
     * so a PM who spent the morning closing things out would be told the job
     * had gone quiet.
     */
    completedSince?: Date;
    limit?: number;
  },
): Promise<Task[]> {
  let query = supabase.from('pm_tasks').select('*');
  if (where.orgId) query = query.eq('org_id', where.orgId);
  if (where.projectId) query = query.eq('project_id', where.projectId);
  if (where.assignedTo) query = query.eq('assigned_to', where.assignedTo);

  if (where.open && where.completedSince) {
    query = query.or(
      `status.in.(todo,in_progress,blocked),completed_at.gte.${where.completedSince.toISOString()}`,
    );
  } else if (where.open) {
    query = query.in('status', ['todo', 'in_progress', 'blocked']);
  }

  const { data, error } = await query
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(Math.min(where.limit ?? 1000, 2000));
  if (error) fail(error, 'list tasks');
  return (data ?? []).map(serializeTask);
}

/**
 * Every `origin_key` in use across the org, by project — including on tasks that
 * are done or cancelled.
 *
 * A narrow two-column read rather than widening the task query: the engine needs
 * to know a generated task *ever existed*, but nothing needs the body of a task
 * somebody finished three weeks ago.
 */
export async function listOriginKeys(
  supabase: SupabaseClient,
  orgId: string,
): Promise<Map<string, string[]>> {
  const { data, error } = await supabase
    .from('pm_tasks')
    .select('project_id, origin_key')
    .eq('org_id', orgId)
    .not('origin_key', 'is', null)
    .limit(20000);
  if (error) fail(error, 'list generated task keys');

  const map = new Map<string, string[]>();
  for (const row of data ?? []) {
    const list = map.get(row.project_id);
    if (list) list.push(row.origin_key);
    else map.set(row.project_id, [row.origin_key]);
  }
  return map;
}

export async function createTask(
  supabase: SupabaseClient,
  input: Record<string, unknown>,
): Promise<Task> {
  const { data, error } = await supabase.from('pm_tasks').insert(input).select('*').single();
  if (error) fail(error, 'create task');
  return serializeTask(data);
}

export async function updateTask(
  supabase: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<Task> {
  const { data, error } = await supabase
    .from('pm_tasks')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) fail(error, 'update task');
  if (!data) throw new HttpError(404, 'Task not found, or not yours to change.', 'pm_not_found');
  return serializeTask(data);
}

/**
 * Create generated tasks, skipping any whose `origin_key` already exists.
 *
 * `ignoreDuplicates` leans on the partial unique index rather than on a
 * read-then-write, so two engine passes running concurrently cannot both decide
 * a task is missing and create it twice.
 *
 * Returns the rows actually inserted, which is what the engine reports as
 * "tasks created" — an honest count rather than the number it attempted.
 */
export async function createTasksIfAbsent(
  supabase: SupabaseClient,
  rows: Record<string, unknown>[],
): Promise<Task[]> {
  if (!rows.length) return [];
  const { data, error } = await supabase
    .from('pm_tasks')
    .upsert(rows, { onConflict: 'project_id,origin_key', ignoreDuplicates: true })
    .select('*');
  if (error) fail(error, 'create generated tasks');
  return (data ?? []).map(serializeTask);
}

/* ------------------------------------------------------------------ *
 * Assignments, equipment, drying, documents, milestones
 * ------------------------------------------------------------------ */

export async function listAssignments(
  supabase: SupabaseClient,
  where: { orgId?: string; projectId?: string; activeOnly?: boolean },
): Promise<Assignment[]> {
  let query = supabase.from('pm_assignments').select('*');
  if (where.orgId) query = query.eq('org_id', where.orgId);
  if (where.projectId) query = query.eq('project_id', where.projectId);
  if (where.activeOnly) query = query.is('released_at', null);

  const { data, error } = await query.order('assigned_at', { ascending: false }).limit(2000);
  if (error) fail(error, 'list assignments');
  return (data ?? []).map(serializeAssignment);
}

export async function createAssignment(
  supabase: SupabaseClient,
  input: Record<string, unknown>,
): Promise<Assignment> {
  const { data, error } = await supabase.from('pm_assignments').insert(input).select('*').single();
  if (error) {
    if (error.code === '23505') {
      throw new HttpError(409, 'That person is already on this project.', 'pm_already_assigned');
    }
    fail(error, 'assign crew');
  }
  return serializeAssignment(data);
}

export async function releaseAssignment(
  supabase: SupabaseClient,
  id: string,
): Promise<Assignment> {
  const { data, error } = await supabase
    .from('pm_assignments')
    .update({ released_at: new Date().toISOString() })
    .eq('id', id)
    .is('released_at', null)
    .select('*')
    .maybeSingle();
  if (error) fail(error, 'release crew');
  if (!data) throw new HttpError(404, 'Assignment not found or already released.', 'pm_not_found');
  return serializeAssignment(data);
}

export async function listEquipment(
  supabase: SupabaseClient,
  orgId: string,
): Promise<Equipment[]> {
  const { data, error } = await supabase
    .from('pm_equipment')
    .select('*')
    .eq('org_id', orgId)
    .neq('status', 'retired')
    .order('asset_tag', { ascending: true })
    .limit(2000);
  if (error) fail(error, 'list equipment');
  return (data ?? []).map(serializeEquipment);
}

export async function createEquipment(
  supabase: SupabaseClient,
  orgId: string,
  input: Record<string, unknown>,
): Promise<Equipment> {
  const { data, error } = await supabase
    .from('pm_equipment')
    .insert({ ...input, org_id: orgId })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') {
      throw new HttpError(409, 'That asset tag is already in use.', 'pm_duplicate_asset');
    }
    fail(error, 'add equipment');
  }
  return serializeEquipment(data);
}

const PLACEMENT_SELECT =
  '*, pm_equipment(asset_tag, kind, capacity_pints_day, capacity_cfm)';

export async function listPlacements(
  supabase: SupabaseClient,
  where: { orgId?: string; projectId?: string; openOnly?: boolean },
): Promise<Placement[]> {
  let query = supabase.from('pm_equipment_placements').select(PLACEMENT_SELECT);
  if (where.orgId) query = query.eq('org_id', where.orgId);
  if (where.projectId) query = query.eq('project_id', where.projectId);
  if (where.openOnly) query = query.is('removed_at', null);

  const { data, error } = await query.order('placed_at', { ascending: false }).limit(2000);
  if (error) fail(error, 'list equipment placements');
  return (data ?? []).map(serializePlacement);
}

export async function placeEquipment(
  supabase: SupabaseClient,
  input: Record<string, unknown>,
): Promise<Placement> {
  const { data, error } = await supabase
    .from('pm_equipment_placements')
    .insert(input)
    .select(PLACEMENT_SELECT)
    .single();
  if (error) {
    if (error.code === '23505') {
      throw new HttpError(
        409,
        'That asset is already out on another job. Check it in before placing it.',
        'pm_equipment_busy',
      );
    }
    fail(error, 'place equipment');
  }
  return serializePlacement(data);
}

export async function removePlacement(
  supabase: SupabaseClient,
  id: string,
  userId: string,
): Promise<Placement> {
  const { data, error } = await supabase
    .from('pm_equipment_placements')
    .update({ removed_at: new Date().toISOString(), removed_by: userId })
    .eq('id', id)
    .is('removed_at', null)
    .select(PLACEMENT_SELECT)
    .maybeSingle();
  if (error) fail(error, 'check equipment back in');
  if (!data) throw new HttpError(404, 'Placement not found or already closed.', 'pm_not_found');
  return serializePlacement(data);
}

export async function listAreas(
  supabase: SupabaseClient,
  where: { orgId?: string; projectId?: string },
): Promise<DryingArea[]> {
  let query = supabase.from('pm_drying_areas').select('*');
  if (where.orgId) query = query.eq('org_id', where.orgId);
  if (where.projectId) query = query.eq('project_id', where.projectId);

  const { data, error } = await query.order('created_at', { ascending: true }).limit(2000);
  if (error) fail(error, 'list drying areas');
  return (data ?? []).map(serializeArea);
}

export async function createArea(
  supabase: SupabaseClient,
  input: Record<string, unknown>,
): Promise<DryingArea> {
  const { data, error } = await supabase.from('pm_drying_areas').insert(input).select('*').single();
  if (error) fail(error, 'create drying area');
  return serializeArea(data);
}

export async function updateArea(
  supabase: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<DryingArea> {
  const { data, error } = await supabase
    .from('pm_drying_areas')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) fail(error, 'update drying area');
  if (!data) throw new HttpError(404, 'Drying area not found.', 'pm_not_found');
  return serializeArea(data);
}

/**
 * Readings for a set of projects.
 *
 * Bounded by `since` because the drying rules only ever look at a recent window
 * and a long-running job accumulates hundreds of readings that nothing consults.
 */
export async function listReadings(
  supabase: SupabaseClient,
  where: { orgId?: string; projectId?: string; since?: Date; limit?: number },
): Promise<MoistureReading[]> {
  let query = supabase.from('pm_moisture_readings').select('*');
  if (where.orgId) query = query.eq('org_id', where.orgId);
  if (where.projectId) query = query.eq('project_id', where.projectId);
  if (where.since) query = query.gte('taken_at', where.since.toISOString());

  const { data, error } = await query
    .order('taken_at', { ascending: false })
    .limit(Math.min(where.limit ?? 2000, 5000));
  if (error) fail(error, 'list readings');
  return (data ?? []).map(serializeReading);
}

export async function createReadings(
  supabase: SupabaseClient,
  rows: Record<string, unknown>[],
): Promise<MoistureReading[]> {
  const { data, error } = await supabase.from('pm_moisture_readings').insert(rows).select('*');
  if (error) fail(error, 'record readings');
  return (data ?? []).map(serializeReading);
}

export async function listDocuments(
  supabase: SupabaseClient,
  where: { orgId?: string; projectId?: string },
): Promise<ProjectDocument[]> {
  let query = supabase.from('pm_documents').select('*');
  if (where.orgId) query = query.eq('org_id', where.orgId);
  if (where.projectId) query = query.eq('project_id', where.projectId);

  const { data, error } = await query.order('created_at', { ascending: true }).limit(3000);
  if (error) fail(error, 'list documents');
  return (data ?? []).map(serializeDocument);
}

/** Seed requirement rows, leaving any that already exist untouched. */
export async function createDocumentsIfAbsent(
  supabase: SupabaseClient,
  rows: Record<string, unknown>[],
): Promise<ProjectDocument[]> {
  if (!rows.length) return [];
  const { data, error } = await supabase
    .from('pm_documents')
    .upsert(rows, { onConflict: 'project_id,requirement_key', ignoreDuplicates: true })
    .select('*');
  if (error) fail(error, 'seed documentation requirements');
  return (data ?? []).map(serializeDocument);
}

export async function updateDocument(
  supabase: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<ProjectDocument> {
  const { data, error } = await supabase
    .from('pm_documents')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) fail(error, 'update document');
  if (!data) throw new HttpError(404, 'Requirement not found.', 'pm_not_found');
  return serializeDocument(data);
}

export async function listMilestones(
  supabase: SupabaseClient,
  where: { orgId?: string; projectId?: string },
): Promise<Milestone[]> {
  let query = supabase.from('pm_milestones').select('*');
  if (where.orgId) query = query.eq('org_id', where.orgId);
  if (where.projectId) query = query.eq('project_id', where.projectId);

  const { data, error } = await query.order('due_at', { ascending: true }).limit(3000);
  if (error) fail(error, 'list milestones');
  return (data ?? []).map(serializeMilestone);
}

export async function createMilestonesIfAbsent(
  supabase: SupabaseClient,
  rows: Record<string, unknown>[],
): Promise<Milestone[]> {
  if (!rows.length) return [];
  const { data, error } = await supabase
    .from('pm_milestones')
    .upsert(rows, { onConflict: 'project_id,milestone_key', ignoreDuplicates: true })
    .select('*');
  if (error) fail(error, 'seed milestones');
  return (data ?? []).map(serializeMilestone);
}

export async function updateMilestone(
  supabase: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<Milestone> {
  const { data, error } = await supabase
    .from('pm_milestones')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) fail(error, 'update milestone');
  if (!data) throw new HttpError(404, 'Milestone not found.', 'pm_not_found');
  return serializeMilestone(data);
}

/* ------------------------------------------------------------------ *
 * Alerts
 * ------------------------------------------------------------------ */

const ALERT_SELECT = '*, pm_projects(id, project_number, name)';

export async function listAlerts(
  supabase: SupabaseClient,
  orgId: string,
  where: { statuses?: string[]; projectId?: string; limit?: number } = {},
): Promise<Alert[]> {
  let query = supabase.from('pm_alerts').select(ALERT_SELECT).eq('org_id', orgId);
  query = query.in('status', where.statuses ?? ['open', 'acknowledged', 'snoozed']);
  if (where.projectId) query = query.eq('project_id', where.projectId);

  const { data, error } = await query
    .order('last_seen_at', { ascending: false })
    .limit(Math.min(where.limit ?? 300, 1000));
  if (error) fail(error, 'list alerts');
  return (data ?? []).map(serializeAlert);
}

/**
 * Every alert the engine has ever raised for this org, in **any** status.
 *
 * All statuses, not just the live ones, and that is load-bearing. Fingerprints
 * are unique per org, so a finding that recurs after being resolved lands on the
 * existing row whether the engine expects it to or not. Treating a resolved row
 * as absent would make the engine write `occurrences = 1` over a row that had
 * counted higher — which the guard trigger refuses, taking the whole pass down.
 * A cleared-then-recurring alert is the commonest lifecycle there is, so the
 * engine has to see the resolved and dismissed rows to handle them deliberately.
 */
export async function listAlertsForReconcile(
  supabase: SupabaseClient,
  orgId: string,
): Promise<Alert[]> {
  const { data, error } = await supabase
    .from('pm_alerts')
    .select('*')
    .eq('org_id', orgId)
    .limit(5000);
  if (error) fail(error, 'load alerts for reconciliation');
  return (data ?? []).map(serializeAlert);
}

/**
 * Insert-or-refresh a batch of findings.
 *
 * The conflict target is the `(org_id, fingerprint)` unique constraint, which is
 * what stops a rule that fires every fifteen minutes from becoming a log.
 * `occurrences` is bumped through a read of the existing row rather than a raw
 * increment because PostgREST cannot express `col = col + 1` in an upsert; the
 * engine passes the value it read in the same pass.
 */
export async function upsertAlerts(
  supabase: SupabaseClient,
  rows: Record<string, unknown>[],
): Promise<Alert[]> {
  if (!rows.length) return [];
  const { data, error } = await supabase
    .from('pm_alerts')
    .upsert(rows, { onConflict: 'org_id,fingerprint' })
    .select('*');
  if (error) fail(error, 'write alerts');
  return (data ?? []).map(serializeAlert);
}

export async function updateAlert(
  supabase: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<Alert> {
  const { data, error } = await supabase
    .from('pm_alerts')
    .update(patch)
    .eq('id', id)
    .select(ALERT_SELECT)
    .maybeSingle();
  if (error) fail(error, 'update alert');
  if (!data) throw new HttpError(404, 'Alert not found.', 'pm_not_found');
  return serializeAlert(data);
}

/** Bulk-clear the alerts whose condition the latest pass no longer sees. */
export async function clearAlerts(
  supabase: SupabaseClient,
  ids: string[],
): Promise<number> {
  if (!ids.length) return 0;
  const { data, error } = await supabase
    .from('pm_alerts')
    .update({ status: 'resolved', resolution: 'cleared' })
    .in('id', ids)
    .select('id');
  if (error) fail(error, 'clear resolved alerts');
  return data?.length ?? 0;
}

/* ------------------------------------------------------------------ *
 * Briefs and updates
 * ------------------------------------------------------------------ */

export async function getBrief(
  supabase: SupabaseClient,
  where: { orgId: string; userId: string; forDate: string; kind: string },
): Promise<Brief | null> {
  const { data, error } = await supabase
    .from('pm_briefs')
    .select('*')
    .eq('org_id', where.orgId)
    .eq('user_id', where.userId)
    .eq('for_date', where.forDate)
    .eq('kind', where.kind)
    .maybeSingle();
  if (error) fail(error, 'read brief');
  return data ? serializeBrief(data) : null;
}

export async function createBrief(
  supabase: SupabaseClient,
  input: Record<string, unknown>,
): Promise<Brief> {
  const { data, error } = await supabase.from('pm_briefs').insert(input).select('*').single();
  if (error) {
    if (error.code === '23505') {
      throw new HttpError(409, 'A brief for that day already exists.', 'pm_brief_exists');
    }
    fail(error, 'save brief');
  }
  return serializeBrief(data);
}

export async function listUpdates(
  supabase: SupabaseClient,
  where: { orgId?: string; projectId?: string; statuses?: string[]; limit?: number },
): Promise<ProjectUpdate[]> {
  let query = supabase.from('pm_updates').select('*');
  if (where.orgId) query = query.eq('org_id', where.orgId);
  if (where.projectId) query = query.eq('project_id', where.projectId);
  if (where.statuses?.length) query = query.in('status', where.statuses);

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(Math.min(where.limit ?? 100, 500));
  if (error) fail(error, 'list updates');
  return (data ?? []).map(serializeUpdate);
}

export async function createUpdate(
  supabase: SupabaseClient,
  input: Record<string, unknown>,
): Promise<ProjectUpdate> {
  const { data, error } = await supabase.from('pm_updates').insert(input).select('*').single();
  if (error) fail(error, 'save drafted update');
  return serializeUpdate(data);
}

export async function updateUpdate(
  supabase: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<ProjectUpdate> {
  const { data, error } = await supabase
    .from('pm_updates')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) fail(error, 'update drafted message');
  if (!data) {
    throw new HttpError(
      404,
      'Draft not found, or only a project manager can approve it.',
      'pm_not_found',
    );
  }
  return serializeUpdate(data);
}

/* ------------------------------------------------------------------ *
 * Members
 * ------------------------------------------------------------------ */

export async function listMembers(
  supabase: SupabaseClient,
  orgId: string,
): Promise<{ userId: string; email: string | null; fullName: string | null; role: string }[]> {
  const { data, error } = await supabase
    .from('org_members')
    .select('user_id, role, profiles(email, full_name)')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });
  if (error) fail(error, 'list members');

  return (data ?? []).map((row: any) => {
    const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return {
      userId: row.user_id,
      email: p?.email ?? null,
      fullName: p?.full_name ?? null,
      role: row.role,
    };
  });
}
