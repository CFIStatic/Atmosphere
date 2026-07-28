/**
 * Domain types for the Project Manager Agent.
 *
 * These mirror the `pm_*` tables in
 * `supabase/migrations/20260727150000_project_manager_agent.sql`, in camelCase —
 * the serialisation boundary is the store, so nothing above it ever sees a
 * snake_case key.
 */

export const WORK_TYPES = ['mitigation', 'construction'] as const;
export type WorkType = (typeof WORK_TYPES)[number];

export const LOSS_TYPES = [
  'water',
  'fire',
  'mold',
  'storm',
  'biohazard',
  'remodel',
  'other',
] as const;
export type LossType = (typeof LOSS_TYPES)[number];

export const PROJECT_STATUSES = ['active', 'on_hold', 'closed', 'cancelled'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/**
 * Every phase either workflow can be in. Which subset is legal for a given work
 * type lives in `playbooks.ts` — the database check is deliberately the union,
 * because the mapping changes more often than the schema should.
 */
export const PROJECT_PHASES = [
  'intake',
  'inspection',
  'approval',
  'scheduled',
  'mitigation',
  'drying',
  'drying_complete',
  'permitting',
  'production',
  'punch_list',
  'final_review',
  'invoicing',
  'paid',
] as const;
export type ProjectPhase = (typeof PROJECT_PHASES)[number];

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_CATEGORIES = [
  'general',
  'documentation',
  'drying',
  'equipment',
  'scheduling',
  'customer',
  'insurance',
  'inspection',
  'billing',
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const EQUIPMENT_KINDS = [
  'dehumidifier',
  'air_mover',
  'air_scrubber',
  'heater',
  'hydroxyl',
  'ozone',
  'generator',
  'other',
] as const;
export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number];

export const MATERIALS = [
  'drywall',
  'wood',
  'engineered_wood',
  'concrete',
  'plaster',
  'carpet',
  'subfloor',
  'insulation',
  'other',
] as const;
export type Material = (typeof MATERIALS)[number];

export const READING_KINDS = ['affected', 'control', 'ambient', 'outside', 'dehu_outlet'] as const;
export type ReadingKind = (typeof READING_KINDS)[number];

export const DOCUMENT_KINDS = [
  'photo',
  'form',
  'signature',
  'report',
  'estimate',
  'invoice',
  'reading_log',
  'certificate',
  'other',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_STATUSES = ['missing', 'provided', 'waived', 'rejected'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const MILESTONE_KINDS = ['carrier', 'permit', 'customer', 'internal', 'billing'] as const;
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];

export const ALERT_SEVERITIES = ['info', 'warn', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_CATEGORIES = [
  'general',
  'drying',
  'equipment',
  'scheduling',
  'documentation',
  'insurance',
  'billing',
  'customer',
] as const;
export type AlertCategory = (typeof ALERT_CATEGORIES)[number];

export const ALERT_STATUSES = ['open', 'acknowledged', 'snoozed', 'resolved', 'dismissed'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const UPDATE_AUDIENCES = ['customer', 'adjuster', 'team'] as const;
export type UpdateAudience = (typeof UPDATE_AUDIENCES)[number];

export const UPDATE_STATUSES = ['draft', 'approved', 'sent', 'discarded'] as const;
export type UpdateStatus = (typeof UPDATE_STATUSES)[number];

/* ------------------------------------------------------------------ *
 * Records
 * ------------------------------------------------------------------ */

export interface Project {
  id: string;
  orgId: string;
  projectNumber: string;
  seqNo: number;
  name: string;
  description: string | null;
  workType: WorkType;
  lossType: LossType | null;
  status: ProjectStatus;
  phase: ProjectPhase;
  priority: Priority;
  pmUserId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  carrier: string | null;
  claimNumber: string | null;
  adjusterName: string | null;
  adjusterEmail: string | null;
  adjusterPhone: string | null;
  deductibleCents: number | null;
  approvedAmountCents: number | null;
  lossAt: string | null;
  scheduledStartAt: string | null;
  targetCompletionAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  closedAt: string | null;
  sourceLeadId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  orgId: string;
  projectId: string;
  title: string;
  details: string | null;
  status: TaskStatus;
  priority: Priority;
  category: TaskCategory;
  assignedTo: string | null;
  dueAt: string | null;
  position: number;
  source: 'manual' | 'playbook' | 'agent';
  originKey: string | null;
  agentRunId: string | null;
  blockedReason: string | null;
  completedAt: string | null;
  completedBy: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Assignment {
  id: string;
  orgId: string;
  projectId: string;
  userId: string;
  roleOnProject: 'lead' | 'crew' | 'estimator' | 'supervisor' | 'observer';
  allocationPct: number;
  assignedBy: string;
  assignedAt: string;
  releasedAt: string | null;
}

export interface Equipment {
  id: string;
  orgId: string;
  assetTag: string;
  kind: EquipmentKind;
  makeModel: string | null;
  capacityPintsDay: number | null;
  capacityCfm: number | null;
  status: 'available' | 'deployed' | 'maintenance' | 'retired';
  dailyRateCents: number | null;
  createdAt: string;
}

export interface Placement {
  id: string;
  orgId: string;
  projectId: string;
  equipmentId: string;
  areaLabel: string | null;
  placedAt: string;
  removedAt: string | null;
  billedRateCents: number | null;
  /** Joined from pm_equipment for display and for the drying capacity maths. */
  equipment?: Pick<Equipment, 'assetTag' | 'kind' | 'capacityPintsDay' | 'capacityCfm'> | null;
}

export interface DryingArea {
  id: string;
  orgId: string;
  projectId: string;
  label: string;
  material: Material;
  dryGoalPct: number;
  waterClass: number | null;
  affectedSqft: number | null;
  affectedCuft: number | null;
  establishedAt: string;
  driedAt: string | null;
  signedOffAt: string | null;
  signedOffBy: string | null;
}

export interface MoistureReading {
  id: string;
  orgId: string;
  projectId: string;
  areaId: string | null;
  kind: ReadingKind;
  moisturePct: number | null;
  temperatureF: number | null;
  humidityPct: number | null;
  gpp: number | null;
  note: string | null;
  takenAt: string;
  takenBy: string;
}

export interface ProjectDocument {
  id: string;
  orgId: string;
  projectId: string;
  requirementKey: string;
  label: string;
  kind: DocumentKind;
  status: DocumentStatus;
  externalRef: string | null;
  note: string | null;
  isBlocking: boolean;
  requiredByPhase: string | null;
  providedAt: string | null;
  providedBy: string | null;
  waivedReason: string | null;
}

export interface Milestone {
  id: string;
  orgId: string;
  projectId: string;
  milestoneKey: string | null;
  label: string;
  kind: MilestoneKind;
  dueAt: string;
  completedAt: string | null;
  completedBy: string | null;
  note: string | null;
}

export interface Alert {
  id: string;
  orgId: string;
  projectId: string | null;
  ruleKey: string;
  fingerprint: string;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  detail: string | null;
  suggestedAction: string | null;
  entityType: string | null;
  entityId: string | null;
  facts: Record<string, unknown>;
  status: AlertStatus;
  resolution: 'cleared' | 'handled' | 'dismissed' | 'expired' | null;
  snoozeUntil: string | null;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  agentRunId: string | null;
  /** Joined for list rendering, so the UI never needs a second round trip. */
  project?: Pick<Project, 'id' | 'projectNumber' | 'name'> | null;
}

export interface Brief {
  id: string;
  orgId: string;
  userId: string;
  forDate: string;
  kind: 'morning' | 'end_of_day' | 'ad_hoc';
  facts: Record<string, unknown>;
  headline: string | null;
  body: string;
  modelId: string | null;
  agentRunId: string | null;
  createdAt: string;
}

export interface ProjectUpdate {
  id: string;
  orgId: string;
  projectId: string;
  audience: UpdateAudience;
  channel: 'email' | 'sms' | 'call' | 'note';
  status: UpdateStatus;
  subject: string | null;
  body: string;
  origin: 'agent' | 'manual';
  modelId: string | null;
  agentRunId: string | null;
  createdBy: string;
  approvedBy: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface AutomationSettings {
  orgId: string;
  enabled: boolean;
  timezone: string;
  digestHour: number;
  readingIntervalHours: number;
  dryingStallDays: number;
  dryingProgressMinPct: number;
  equipmentIdleHours: number;
  staleProjectDays: number;
  milestoneLeadDays: number;
  maxProjectsPerCrew: number;
  disabledRules: string[];
  autoCreateTasks: boolean;
  updatedAt: string;
}

/* ------------------------------------------------------------------ *
 * The engine's working set
 * ------------------------------------------------------------------ */

/**
 * Everything the rules need about one project, assembled once.
 *
 * The rules are pure functions over this — no database access inside a rule.
 * That is what makes them cheap to reason about and trivial to unit-test, and it
 * is why the engine can evaluate an entire org from a fixed number of queries
 * instead of one per project per rule.
 */
export interface ProjectContext {
  project: Project;
  /**
   * Open work, plus anything completed inside the snapshot's recent window.
   *
   * The completed tail is load-bearing, not a convenience: two rules ask
   * questions that only finished work can answer — "has the customer been
   * updated this week?" and "has anything happened on this job at all?" — and
   * with open work alone both would answer no on exactly the projects somebody
   * had just caught up on.
   */
  tasks: Task[];
  /**
   * Every `origin_key` ever used on this project, including on tasks that are
   * done or cancelled.
   *
   * Kept separately from `tasks` because `tasks` deliberately holds only open
   * work: without this, a playbook task that was completed would look like it
   * had never been created, and the engine would propose it again on every pass
   * for the life of the job.
   */
  usedOriginKeys: string[];
  assignments: Assignment[];
  areas: DryingArea[];
  readings: MoistureReading[];
  placements: Placement[];
  documents: ProjectDocument[];
  milestones: Milestone[];
}

/** The org-wide working set: every active project plus the shared inventory. */
export interface OrgSnapshot {
  orgId: string;
  settings: AutomationSettings;
  /** Now, captured once so every rule in a run agrees on what "today" means. */
  now: Date;
  projects: ProjectContext[];
  equipment: Equipment[];
  members: { userId: string; email: string | null; fullName: string | null; role: string }[];
}

/**
 * A rule's output. Deliberately not an alert row: a finding has no identity or
 * lifecycle, it is just "this is true right now". The engine turns findings into
 * alerts, and that translation is where de-duplication and auto-resolution live.
 */
export interface Finding {
  ruleKey: string;
  /**
   * Identifies this problem on this entity, stably across runs. Two runs that
   * both see the same missed reading must produce the same fingerprint, or the
   * alert list becomes a log.
   */
  fingerprint: string;
  projectId: string | null;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  detail?: string;
  /** What to actually do. An alert without one of these is just an observation. */
  suggestedAction?: string;
  entityType?: string;
  entityId?: string;
  facts?: Record<string, unknown>;
  /**
   * Work the engine should create if the org allows it. Carries its own
   * origin_key so re-running cannot duplicate the task.
   */
  task?: ProposedTask;
}

export interface ProposedTask {
  originKey: string;
  title: string;
  details?: string;
  category: TaskCategory;
  priority: Priority;
  /** Hours from now. Resolved against the snapshot's `now`, not the wall clock. */
  dueInHours?: number;
  assignTo?: string | null;
}

export interface Rule {
  key: string;
  /** Shown in the settings screen so an org knows what it is switching off. */
  label: string;
  description: string;
  category: AlertCategory;
  /** Org-level rules see the whole snapshot; project rules see one project. */
  scope: 'project' | 'org';
  evaluate(input: { snapshot: OrgSnapshot; ctx?: ProjectContext }): Finding[];
}

/** What one engine pass did. Returned to the caller and written to the trace. */
export interface EngineResult {
  orgId: string;
  ranAt: string;
  durationMs: number;
  projectsEvaluated: number;
  rulesEvaluated: number;
  findings: number;
  alertsOpened: number;
  alertsUpdated: number;
  alertsCleared: number;
  tasksCreated: number;
  /** Rules skipped because the org disabled them. */
  rulesSkipped: string[];
  agentRunId: string | null;
  /** Non-fatal problems — a rule that threw, a write that was refused. */
  warnings: string[];
}
