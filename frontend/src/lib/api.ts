/**
 * Thin API client for the Atmosphere backend.
 *
 * In development, requests go to a relative `/api/...` path which Vite proxies
 * to the backend (same-origin, so cookies work seamlessly). In production set
 * `VITE_API_BASE_URL` if the backend is served from a different origin.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export interface AuthUser {
  id: string;
  email: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  emailConfirmed: boolean;
  metadata: Record<string, unknown>;
}

export type MemberRole =
  | 'project_manager'
  | 'field_technician'
  | 'accountant'
  | 'office_manager'
  | 'sales';

export type WorkType = 'mitigation' | 'construction';

export type ContractorType =
  | 'restoration'
  | 'roofing'
  | 'general_contractor'
  | 'other';

export type UsageIntent =
  | 'mitigation_estimating'
  | 'construction_estimating'
  | 'project_management'
  | 'crm'
  | 'web_access'
  | 'field_work'
  | 'billing'
  | 'exploring';

export interface Org {
  id: string;
  name: string;
  joinCode: string;
  createdAt?: string;
  contractorType?: ContractorType | null;
}

export interface Membership {
  role: MemberRole;
  workType: WorkType;
  usageIntents: UsageIntent[];
  status: string;
  org: Org | null;
}

export interface Profile {
  id: string | null;
  email: string | null;
  fullName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface OrgMember {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: MemberRole;
  workType: WorkType;
  usageIntents: UsageIntent[];
  status: string;
}

/* ---- CRM (customers) -------------------------------------------------- */

/** The CRM's generic list envelope. */
export interface CrmList<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/** Camelized crm_accounts row — only the columns the UI reads are typed. */
export interface CrmAccount {
  id: string;
  name: string;
  kind?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  region?: string | null;
  createdAt?: string;
}

/** The stages a lead moves through, in pipeline order. */
export const LEAD_STAGES = ['new', 'contacted', 'qualified', 'estimate_sent', 'won', 'lost'] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  estimate_sent: 'Estimate sent',
  won: 'Won',
  lost: 'Lost',
};

export const LEAD_SOURCES = [
  'referral', 'insurance_carrier', 'web', 'phone', 'repeat_customer', 'marketing', 'other',
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const ACCOUNT_TYPES = [
  'insurance_carrier', 'property_management', 'general_contractor',
  'referral_partner', 'vendor', 'other',
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const CONTACT_TYPES = [
  'homeowner', 'tenant', 'adjuster', 'agent', 'property_manager', 'vendor', 'other',
] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export const ACTIVITY_KINDS = ['note', 'call', 'email', 'sms', 'meeting'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** snake_case → words, for enum values shown in the UI. */
export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  const s = value.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Camelized crm_leads row. */
export interface CrmLead {
  id: string;
  title: string;
  status: LeadStage;
  source?: LeadSource | null;
  workType?: WorkType | null;
  lossType?: LossType | null;
  estimatedValue?: number | null;
  description?: string | null;
  lostReason?: string | null;
  contactId?: string | null;
  accountId?: string | null;
  convertedJobId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CrmLeadInput {
  title: string;
  source?: LeadSource;
  workType?: WorkType | null;
  lossType?: LossType | null;
  estimatedValue?: number | null;
  description?: string | null;
  accountId?: string | null;
  contactId?: string | null;
  status?: LeadStage;
  lostReason?: string | null;
}

/** One logged touch — a call, an email, a note — against a lead or account. */
export interface CrmActivity {
  id: string;
  kind: ActivityKind;
  subject?: string | null;
  body?: string | null;
  leadId?: string | null;
  accountId?: string | null;
  contactId?: string | null;
  jobId?: string | null;
  occurredAt?: string | null;
  createdAt?: string;
  profiles?: { email: string | null; fullName: string | null } | null;
}

export interface CrmActivityInput {
  kind: ActivityKind;
  subject?: string;
  body?: string;
  leadId?: string;
  accountId?: string;
  contactId?: string;
  jobId?: string;
}

/* ---- Prospecting -------------------------------------------------------- */

/** A person a search turned up. Never carries contact details. */
export interface ProspectMatch {
  providerPersonId: string;
  fullName: string;
  title: string | null;
  companyName: string | null;
  companyDomain: string | null;
  location: string | null;
  linkedinUrl: string | null;
  confidence: number | null;
  hasEmail: boolean;
  hasPhone: boolean;
  /** Already a contact in the CRM — revealing would buy back our own data. */
  knownContactId: string | null;
  /** Already saved as a prospect. */
  prospectId: string | null;
  revealed: boolean;
  suppressed: boolean;
}

/** A saved prospect. Contact columns are null until a reveal is paid for. */
export interface Prospect {
  id: string;
  fullName: string;
  title: string | null;
  companyName: string | null;
  companyDomain: string | null;
  location: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  provider: string;
  providerPersonId: string | null;
  confidence: number | null;
  status: 'new' | 'saved' | 'contacted' | 'converted' | 'discarded';
  revealedAt: string | null;
  revealCostNanos: number;
  contactId: string | null;
  leadId: string | null;
  createdAt?: string;
}

/** What verification concluded about an address. */
export interface EmailVerification {
  verdict: 'valid' | 'risky' | 'invalid' | 'unknown';
  score: number;
  reason: string;
  /** The domain accepts everything, so no address can be confirmed. */
  catchAll: boolean;
}

export interface ProspectingStatus {
  provider: string;
  /** True when the people are invented. The UI must say so. */
  sandbox: boolean;
  revealPriceNanos: number;
}

export interface ProspectSearchResponse extends ProspectingStatus {
  matches: ProspectMatch[];
  total: number | null;
}

export interface ProspectQuery {
  q?: string;
  location?: string;
  companyDomain?: string;
  industry?: string;
  titles?: string[];
  limit?: number;
}

export interface Suppression {
  id: string;
  kind: 'email' | 'phone' | 'domain';
  value: string;
  reason: string | null;
  createdAt?: string;
}

export interface CrmSummary {
  contacts: number;
  properties: number;
  openLeads: number;
  activeJobs: number;
  completedJobs: number;
}

/** Camelized crm_contacts row. */
export interface CrmContact {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  createdAt?: string;
}

/**
 * The credential carried by a password-recovery link. Supabase emits one of
 * three shapes depending on the email template and flow type; the backend
 * normalises whichever arrives into a session.
 */
export interface RecoveryCredential {
  tokenHash?: string;
  code?: string;
  accessToken?: string;
  refreshToken?: string;
}

/* ---- Audit ledger ---------------------------------------------------- */

export type AgentRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type AgentActorType = 'user' | 'system' | 'schedule' | 'agent';
export type AgentStepStatus = 'ok' | 'error' | 'pending';
export type AgentAccent = 'brand' | 'neutral' | 'success' | 'caution' | 'danger';

export type AgentStepType =
  | 'status'
  | 'thought'
  | 'message'
  | 'tool_call'
  | 'tool_result'
  | 'observation'
  | 'navigation'
  | 'decision'
  | 'artifact'
  | 'usage'
  | 'error'
  | 'event';

/** An agent as the catalog describes it, independent of whether it has run. */
export interface AgentDefinition {
  key: string;
  name: string;
  blurb: string;
  accent: AgentAccent;
  /** 'ledger' — writes its own trace. 'bridge' — mirrored from its own table. */
  intake: 'ledger' | 'bridge';
  sourceTable?: string;
}

export interface AgentSummary extends AgentDefinition {
  total: number;
  succeeded: number;
  failed: number;
  active: number;
  steps: number;
  lastRunAt: string | null;
  avgDurationMs: number | null;
}

export interface AuditRun {
  id: string;
  agentKey: string;
  agent: AgentDefinition;
  agentLabel: string | null;
  actorType: AgentActorType;
  actorUserId: string | null;
  actorEmail: string | null;
  actorLabel: string | null;
  parentRunId: string | null;
  title: string;
  summary: string | null;
  status: AgentRunStatus;
  error: string | null;
  stepCount: number;
  inputTokens: number;
  outputTokens: number;
  sourceTable: string | null;
  sourceId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string | null;
  /** Detail view only — omitted from the list to keep pages small. */
  input?: unknown;
  result?: unknown;
}

export interface AuditStep {
  id: string;
  seq: number;
  type: AgentStepType;
  action: string | null;
  detail: string | null;
  target: string | null;
  payload: unknown;
  status: AgentStepStatus;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  createdAt: string;
}

export interface AuditStats {
  totalRuns: number;
  activeRuns: number;
  failedRuns: number;
  succeededRuns: number;
  totalSteps: number;
  inputTokens: number;
  outputTokens: number;
  runs24h: number;
  agentsSeen: number;
  lastRunAt: string | null;
}

export interface AuditRunFilters {
  agent?: string;
  status?: AgentRunStatus;
  actorType?: AgentActorType;
  q?: string;
  from?: string;
  limit?: number;
  cursor?: string;
}

/* ==========================================================================
 * Agent Memory
 * ========================================================================== */

/** crm_job_status — the CRM owns the job lifecycle. */
export type JobStatus =
  | 'draft'
  | 'scheduled'
  | 'in_progress'
  | 'on_hold'
  | 'completed'
  | 'invoiced'
  | 'paid'
  | 'cancelled';

/** crm_jobs.priority is a smallint 1-5, 1 being the most urgent. */
export type JobPriority = 1 | 2 | 3 | 4 | 5;
/** Tasks are ours, and keep a word-shaped priority. */
export type Priority = 'low' | 'normal' | 'high' | 'urgent';
export type LossType = 'water' | 'fire' | 'mold' | 'storm' | 'biohazard' | 'contents' | 'other';
export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
export type WorkLogKind = 'work' | 'note' | 'call' | 'site_visit' | 'photo' | 'material' | 'issue';
export type AssignmentRole = 'lead' | 'crew' | 'estimator' | 'supervisor' | 'observer';

export interface Person {
  id: string;
  email: string | null;
  fullName: string | null;
}

export interface Job {
  id: string;
  jobNumber: number;
  title: string;
  description: string | null;
  workType: WorkType;
  lossType: LossType | null;
  status: JobStatus;
  priority: JobPriority;
  claimNumber: string | null;
  policyNumber: string | null;
  ownerId: string | null;
  contactId: string | null;
  accountId: string | null;
  propertyId: string | null;
  lossDate: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  contractAmount: number | null;
  invoicedAmount: number | null;
  paidAmount: number | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A job as it appears in the list — the row plus its memory rolled up. */
export interface JobSummary {
  jobId: string;
  jobNumber: number;
  title: string;
  status: JobStatus;
  priority: JobPriority;
  workType: WorkType;
  ownerId: string | null;
  claimNumber: string | null;
  taskCount: number;
  tasksDone: number;
  crewSize: number;
  minutesLogged: number;
  eventCount: number;
  lastEvent: string | null;
  lastEventAt: string | null;
  contractAmount: number | null;
  invoicedAmount: number | null;
  paidAmount: number | null;
  scheduledStart: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobTask {
  id: string;
  jobId: string;
  title: string;
  details: string | null;
  status: TaskStatus;
  priority: Priority;
  assignedTo: string | null;
  assignee: Person | null;
  dueAt: string | null;
  position: number;
  completedAt: string | null;
  completedBy: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobAssignment {
  id: string;
  jobId: string;
  userId: string;
  agent: Person | null;
  roleOnJob: AssignmentRole;
  assignedBy: string;
  assignedAt: string;
  releasedAt: string | null;
  active: boolean;
}

export interface WorkLog {
  id: string;
  jobId: string;
  taskId: string | null;
  kind: WorkLogKind;
  body: string;
  minutes: number | null;
  occurredAt: string;
  authorId: string;
  author: Person | null;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
}

/** One entry in the record. `changes` holds the field-level before and after. */
export interface MemoryEvent {
  id: string;
  seq: number;
  actorId: string | null;
  /** Who they were when it happened — not who they are now. */
  actorEmail: string | null;
  actorRole: string | null;
  eventType: string;
  entityType: string;
  entityId: string | null;
  jobId: string | null;
  job?: { id: string; jobNumber: number; title: string } | null;
  summary: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  snapshot: Record<string, unknown> | null;
  source: 'trigger' | 'app';
  occurredAt: string;
}

export interface AgentMemory {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: MemberRole;
  workType: WorkType;
  eventCount: number;
  jobsTouched: number;
  openTasks: number;
  tasksCompleted: number;
  minutesLogged: number;
  lastActiveAt: string | null;
}

export interface MemoryStats {
  totalEvents: number;
  agents: number;
  activeToday: number;
  minutesLogged: number;
  eventsInWindow: number;
  byType: Record<string, number>;
}

export interface JobDetail {
  job: Job;
  tasks: JobTask[];
  crew: JobAssignment[];
  workLogs: WorkLog[];
  memory: MemoryEvent[];
}

export interface CreateJobInput {
  title: string;
  workType: WorkType;
  description?: string;
  lossType?: LossType;
  priority?: JobPriority;
  status?: JobStatus;
  claimNumber?: string;
  policyNumber?: string;
  ownerId?: string | null;
  scheduledStart?: string | null;
}

export interface CreateTaskInput {
  title: string;
  details?: string;
  status?: TaskStatus;
  priority?: Priority;
  assignedTo?: string | null;
  dueAt?: string | null;
  position?: number;
}

export interface CreateWorkLogInput {
  kind: WorkLogKind;
  body: string;
  taskId?: string | null;
  minutes?: number | null;
  occurredAt?: string | null;
}

export interface MemoryQuery {
  jobId?: string;
  actorId?: string;
  entityType?: string;
  eventType?: string;
  since?: string;
  until?: string;
  search?: string;
  before?: number;
  limit?: number;
}
/** What the deployment can actually do, so the UI can offer only what works. */
export interface TechnicianCapabilities {
  /** A language model is configured; otherwise replies come from a local fallback. */
  assistant: boolean;
  /** Server-side speech-to-text is configured (the fallback for Safari/Firefox). */
  transcription: boolean;
  maxAudioUploadBytes: number;
}

export interface AssistantTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Everything the assistant is told about the caller and their surroundings. */
export interface AssistantContext {
  role?: MemberRole;
  workType?: WorkType;
  orgName?: string;
  /** Current labels from the in-browser object detector. */
  detectedObjects?: string[];
}

export interface AssistantReply {
  reply: string;
  /** null when the rule-based fallback answered rather than a model. */
  model: string | null;
}

/** A website the organization has connected for the AI to work in. */
export interface WebConnection {
  id: string;
  label: string;
  siteUrl: string;
  loginUrl: string | null;
  username: string;
  status: 'unverified' | 'verified' | 'failed';
  lastVerifiedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

/** One action the AI took during a run — the audit trail for a task. */
export interface WebRunStep {
  index: number;
  action: string;
  detail: string;
  url: string;
  error?: string;
}

export type WebRunKind = 'pull' | 'push';
export type WebRunStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface WebRun {
  id: string;
  connectionId: string;
  kind: WebRunKind;
  instruction: string;
  status: WebRunStatus;
  result: { summary: string; records: unknown[] } | null;
  steps: WebRunStep[];
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface WebConnectionInput {
  label: string;
  siteUrl: string;
  loginUrl?: string;
  username: string;
  password: string;
}

/* ---------------------------------------------------------------------------
 * Verifier — the second agent, which re-opens the site after a run reports
 * success and checks the work is really there.
 * ------------------------------------------------------------------------- */

/** One checkable claim, derived from the task the user originally wrote. */
export interface Expectation {
  id: string;
  kind: 'record_exists' | 'field_value' | 'record_absent' | 'state_change' | 'reported_data_matches';
  description: string;
  where: string;
  identifiers: Record<string, string>;
  expected: Record<string, string>;
  critical: boolean;
}

export type Verdict = 'satisfied' | 'violated' | 'indeterminate';

/** What the verifier actually saw for one expectation, and where. */
export interface Finding {
  expectationId: string;
  verdict: Verdict;
  evidence: string;
  url: string;
  reasoning: string;
  repair?: {
    repairClass: 'create_missing' | 'correct_value' | 'needs_human';
    instruction: string;
    rationale: string;
  };
}

export interface VerifierStep {
  index: number;
  action: string;
  detail: string;
  url: string;
  phase: 'observe' | 'repair';
  error?: string;
}

export type VerificationStatus =
  | 'queued'
  | 'running'
  | 'verified'
  | 'repaired'
  | 'escalated'
  | 'rejected'
  | 'failed'
  | 'cancelled';

export interface Verification {
  id: string;
  runId: string;
  connectionId: string;
  status: VerificationStatus;
  verdict: Verdict | null;
  expectations: Expectation[];
  findings: Finding[];
  steps: VerifierStep[];
  repairAttempts: number;
  summary: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export type EscalationReason =
  | 'indeterminate'
  | 'unsafe_repair'
  | 'repair_exhausted'
  | 'repair_failed';

/** One answer a person can give. `action` is what the verifier does with it. */
export interface EscalationOption {
  id: string;
  label: string;
  detail: string;
  action: 'repair' | 'accept' | 'reject' | 'recheck';
}

export interface EscalationContext {
  reason?: EscalationReason;
  siteLabel?: string;
  runInstruction?: string;
  verdict?: Verdict;
  verifierSummary?: string;
  unsettled?: Array<{
    expectation: string;
    verdict: Verdict;
    evidence: string;
    url: string;
    reasoning: string;
    proposedFix: string | null;
    fixSafety: string | null;
  }>;
}

export interface Escalation {
  id: string;
  verificationId: string;
  runId: string;
  reason: EscalationReason;
  question: string;
  context: EscalationContext;
  options: EscalationOption[];
  status: 'open' | 'resolved' | 'dismissed';
  chosenOption: string | null;
  resolutionNote: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

/* ------------------------------ Computer use ------------------------------ */

export type CaptureQuality = 'economical' | 'balanced' | 'detailed';

/** A computer with the agent running and connected. */
export interface ComputerAgent {
  id: string;
  name: string;
  platform: string;
  version: string;
  screen: { width: number; height: number };
  /** Resolution the model sees; null until the computer is configured. */
  capture: { width: number; height: number; scale: number } | null;
  capabilities: string[];
  connectedAt: string;
  busy: boolean;
}

export interface CredentialStatus {
  connected: boolean;
  /** 'organization' — entered here; 'server' — set as ANTHROPIC_API_KEY. */
  source: 'organization' | 'server' | null;
  hint: string | null;
  updatedAt: string | null;
}

export interface ComputerStatus {
  enabled: boolean;
  credential: CredentialStatus;
  agents: ComputerAgent[];
  models: { id: string; label: string }[];
  defaults: { model: string; quality: CaptureQuality };
  limits: { maxSteps: number; runTimeoutMs: number };
}

export type RunStatus = 'starting' | 'running' | 'completed' | 'failed' | 'stopped';

export interface ComputerRun {
  id: string;
  agentId: string;
  agentName: string;
  instruction: string;
  model: string;
  status: RunStatus;
  startedAt: string;
  endedAt: string | null;
  steps: number;
  usage: { inputTokens: number; outputTokens: number };
  error: string | null;
}

/** One entry in the live transcript streamed over SSE. */
export type RunEvent = { seq: number; at: string } & (
  | { type: 'status'; status: RunStatus; message?: string }
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'action'; action: string; summary: string; ok: boolean; error?: string }
  | { type: 'screenshot'; image: string | null; width: number; height: number }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'error'; message: string }
);

/** The stream also carries periodic run summaries, which are not transcript entries. */
export type RunStreamMessage = RunEvent | { type: 'summary'; run: ComputerRun };

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, message: string, code = 'error') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: 'include', // send/receive the httpOnly session cookies
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(0, 'Network error — is the backend running?', 'network_error');
  }

  const text = await res.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!res.ok) {
    const message = (body.error as string) ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message, (body.code as string) ?? 'error');
  }

  return body as T;
}

export interface AuthResponse {
  user: AuthUser | null;
  needsEmailConfirmation?: boolean;
  message?: string;
}

export const api = {
  // ---- Auth ----
  signup: (email: string, password: string) =>
    request<AuthResponse>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  login: (email: string, password: string) =>
    request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  me: () => request<{ user: AuthUser }>('/api/auth/me', { method: 'GET' }),

  // ---- Password recovery ----
  forgotPassword: (email: string) =>
    request<{ ok: boolean; message: string }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  resetPassword: (credential: RecoveryCredential, password: string) =>
    request<{ user: AuthUser }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ ...credential, password }),
    }),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ user: AuthUser }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  // ---- Profile ----
  getProfile: () => request<{ profile: Profile }>('/api/profile', { method: 'GET' }),

  updateProfile: (fullName: string | null) =>
    request<{ profile: Profile }>('/api/profile', {
      method: 'PATCH',
      body: JSON.stringify({ fullName }),
    }),

  // ---- Device PIN ----
  pinStatus: () =>
    request<{ enrolled: boolean; lockedUntil?: string | null }>('/api/auth/pin/status', {
      method: 'GET',
    }),

  pinEnroll: (pin: string) =>
    request<{ ok: boolean }>('/api/auth/pin/enroll', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    }),

  pinUnlock: (pin: string) =>
    request<{ user: AuthUser }>('/api/auth/pin/unlock', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    }),

  pinDisable: () => request<{ ok: boolean }>('/api/auth/pin/disable', { method: 'POST' }),

  // ---- Organization / onboarding ----
  getMembership: () => request<{ membership: Membership | null }>('/api/org/me', { method: 'GET' }),

  updateMembership: (role: MemberRole, workType: WorkType, usageIntents: UsageIntent[]) =>
    request<{ membership: Membership }>('/api/org/me', {
      method: 'PATCH',
      body: JSON.stringify({ role, workType, usageIntents }),
    }),

  updateOrgProfile: (contractorType: ContractorType) =>
    request<{ org: Org }>('/api/org', {
      method: 'PATCH',
      body: JSON.stringify({ contractorType }),
    }),

  createOrg: (
    name: string,
    role: MemberRole,
    workType: WorkType,
    contractorType: ContractorType,
    usageIntents: UsageIntent[],
  ) =>
    request<{ org: Org }>('/api/org', {
      method: 'POST',
      body: JSON.stringify({ name, role, workType, contractorType, usageIntents }),
    }),

  joinOrg: (joinCode: string, role: MemberRole, workType: WorkType, usageIntents: UsageIntent[]) =>
    request<{ org: Org }>('/api/org/join', {
      method: 'POST',
      body: JSON.stringify({ joinCode, role, workType, usageIntents }),
    }),

  getMembers: () => request<{ members: OrgMember[] }>('/api/org/members', { method: 'GET' }),

  // ---- CRM (customers) ----
  crmAccounts: (search = '') =>
    request<CrmList<CrmAccount>>(
      `/api/crm/accounts${search ? `?search=${encodeURIComponent(search)}` : ''}`,
      { method: 'GET' },
    ),

  crmLeads: (search = '') =>
    request<CrmList<CrmLead>>(
      `/api/crm/leads${search ? `?search=${encodeURIComponent(search)}` : ''}`,
      { method: 'GET' },
    ),

  createLead: (input: CrmLeadInput) =>
    request<{ item: CrmLead }>('/api/crm/leads', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateLead: (id: string, patch: Partial<CrmLeadInput>) =>
    request<{ item: CrmLead }>(`/api/crm/leads/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  /** Turns a won lead into a job, carrying its people and value across. */
  convertLead: (id: string, overrides: { title?: string; workType?: WorkType } = {}) =>
    request<{ job: Job; leadUpdated: boolean }>(`/api/crm/leads/${id}/convert`, {
      method: 'POST',
      body: JSON.stringify(overrides),
    }),

  createAccount: (input: { name: string; type?: AccountType; phone?: string; email?: string; city?: string; region?: string; notes?: string }) =>
    request<{ item: CrmAccount }>('/api/crm/accounts', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  createContact: (input: { firstName?: string; lastName?: string; type?: ContactType; companyName?: string; email?: string; phone?: string; mobile?: string; accountId?: string }) =>
    request<{ item: CrmContact }>('/api/crm/contacts', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** Activities, optionally narrowed to one lead / account / job. */
  crmActivities: (filter: { leadId?: string; accountId?: string; jobId?: string } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(filter).forEach(([k, v]) => v && qs.set(k, v));
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<CrmList<CrmActivity>>(`/api/crm/activities${suffix}`, { method: 'GET' });
  },

  logActivity: (input: CrmActivityInput) =>
    request<{ item: CrmActivity }>('/api/crm/activities', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  crmSummary: () => request<{ summary: CrmSummary }>('/api/crm/summary', { method: 'GET' }),

  // ---- Prospecting (find contact details) ----
  prospectingStatus: () =>
    request<ProspectingStatus>('/api/prospecting/status', { method: 'GET' }),

  /** Free: people without their contact details. */
  prospectSearch: (query: ProspectQuery) =>
    request<ProspectSearchResponse>('/api/prospecting/search', {
      method: 'POST',
      body: JSON.stringify(query),
    }),

  /**
   * The metered call. `requestId` is the idempotency key — a retry must never
   * bill twice, so it is generated once per person per attempt.
   */
  prospectReveal: (providerPersonId: string, requestId: string) =>
    request<{
      prospect: Prospect;
      charged: boolean;
      reason?: string;
      /** 'People Data Labs', 'Pattern + verification', … */
      source?: string;
      verification?: EmailVerification | null;
    }>(
      '/api/prospecting/reveal',
      { method: 'POST', body: JSON.stringify({ providerPersonId, requestId }) },
    ),

  prospects: () => request<{ items: Prospect[] }>('/api/prospecting/prospects', { method: 'GET' }),

  /** Turns a revealed prospect into a contact and a lead. */
  prospectImport: (prospectId: string, overrides: { title?: string; estimatedValue?: number | null } = {}) =>
    request<{ contact: CrmContact; lead: CrmLead }>('/api/prospecting/import', {
      method: 'POST',
      body: JSON.stringify({ prospectId, ...overrides }),
    }),

  suppressions: () =>
    request<{ items: Suppression[] }>('/api/prospecting/suppressions', { method: 'GET' }),

  addSuppression: (input: { kind: Suppression['kind']; value: string; reason?: string }) =>
    request<{ item: Suppression }>('/api/prospecting/suppressions', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  removeSuppression: (id: string) =>
    request<{ ok: boolean }>(`/api/prospecting/suppressions/${id}`, { method: 'DELETE' }),

  crmContacts: (search = '') =>
    request<CrmList<CrmContact>>(
      `/api/crm/contacts${search ? `?search=${encodeURIComponent(search)}` : ''}`,
      { method: 'GET' },
    ),

  // ---- Audit ----
  auditAgents: () => request<{ agents: AgentSummary[] }>('/api/audit/agents', { method: 'GET' }),

  auditStats: () => request<{ stats: AuditStats }>('/api/audit/stats', { method: 'GET' }),

  auditRuns: (filters: AuditRunFilters = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    }
    const query = params.toString();
    return request<{ runs: AuditRun[]; nextCursor: string | null }>(
      `/api/audit/runs${query ? `?${query}` : ''}`,
      { method: 'GET' },
    );
  },

  /**
   * One run and its trace. `afterSeq` fetches only steps past the ones already
   * held, so tailing a running agent stays cheap however long it runs.
   */
  auditRun: (id: string, afterSeq = 0) =>
    request<{ run: AuditRun; steps: AuditStep[]; moreSteps: boolean }>(
      `/api/audit/runs/${id}${afterSeq > 0 ? `?afterSeq=${afterSeq}` : ''}`,
      { method: 'GET' },
    ),
  // ---- Jobs ----
  getJobs: (params: { status?: string; q?: string; mine?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.q) qs.set('q', params.q);
    if (params.mine) qs.set('mine', '1');
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<{ jobs: JobSummary[] }>(`/api/jobs${suffix}`, { method: 'GET' });
  },

  createJob: (input: CreateJobInput) =>
    request<{ job: Job }>('/api/jobs', { method: 'POST', body: JSON.stringify(input) }),

  getJob: (id: string) => request<JobDetail>(`/api/jobs/${id}`, { method: 'GET' }),

  updateJob: (id: string, patch: Partial<CreateJobInput>) =>
    request<{ job: Job }>(`/api/jobs/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  getJobMemory: (id: string) =>
    request<{ events: MemoryEvent[] }>(`/api/jobs/${id}/memory`, { method: 'GET' }),

  // ---- Tasks ----
  createTask: (jobId: string, input: CreateTaskInput) =>
    request<{ task: JobTask }>(`/api/jobs/${jobId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // ---- Technician app ----
  technicianCapabilities: () =>
    request<TechnicianCapabilities>('/api/technician/capabilities', { method: 'GET' }),

  assist: (message: string, history: AssistantTurn[], context?: AssistantContext) =>
    request<AssistantReply>('/api/technician/assist', {
      method: 'POST',
      body: JSON.stringify({ message, history, context }),
    }),

  /**
   * Server-side transcription for browsers with no usable SpeechRecognition.
   * The clip goes up as the raw request body — `request()` is bypassed because
   * it hard-codes a JSON content type.
   */
  transcribe: async (clip: Blob): Promise<{ text: string }> => {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/api/technician/transcribe`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': clip.type || 'audio/webm' },
        body: clip,
      });
    } catch {
      throw new ApiError(0, 'Network error — is the backend running?', 'network_error');
    }

    const text = await res.text();
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) {
      throw new ApiError(
        res.status,
        (body.error as string) ?? `Transcription failed (${res.status})`,
        (body.code as string) ?? 'error',
      );
    }
    return body as { text: string };
  },
  // ---- Billing ----
  getCatalog: () => request<Catalog>('/api/billing/catalog', { method: 'GET' }),

  getBillingOverview: () => request<BillingOverview>('/api/billing/overview', { method: 'GET' }),

  setPlan: (planCode: PlanCode, billingInterval: BillingInterval = 'monthly', seats = 1) =>
    request<SetPlanResult>('/api/billing/plan', {
      method: 'POST',
      body: JSON.stringify({ planCode, billingInterval, seats }),
    }),

  updateBillingSettings: (patch: BillingSettingsPatch) =>
    request<{ settings: BillingSettings }>('/api/billing/settings', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  getLedger: (limit = 50) =>
    request<{ entries: LedgerEntry[] }>(`/api/billing/ledger?limit=${limit}`, { method: 'GET' }),

  getPurchases: () => request<{ purchases: Purchase[] }>('/api/billing/purchases', { method: 'GET' }),

  startPurchase: (input: { packCode?: string; amountCents?: number }) =>
    request<{ purchase: Purchase; checkoutUrl: string | null; requiresConfirmation: boolean }>(
      '/api/billing/purchases',
      { method: 'POST', body: JSON.stringify(input) },
    ),

  /** Hosted Stripe Checkout for a paid plan. */
  startSubscriptionCheckout: (
    planCode: PlanCode,
    billingInterval: BillingInterval = 'monthly',
    seats = 1,
  ) =>
    request<{ checkoutUrl: string | null }>('/api/billing/checkout/subscription', {
      method: 'POST',
      body: JSON.stringify({ planCode, billingInterval, seats }),
    }),

  /** Stripe's hosted portal: cards, invoices and cancellation. */
  openBillingPortal: () =>
    request<{ portalUrl: string }>('/api/billing/portal', { method: 'POST' }),

  getPayments: (limit = 50) =>
    request<{ payments: Payment[] }>(`/api/billing/payments?limit=${limit}`, { method: 'GET' }),

  confirmPurchase: (purchaseId: string) =>
    request<{ purchaseId: string; status: string; creditedNanos: number; balance: CreditBalance }>(
      `/api/billing/purchases/${purchaseId}/confirm`,
      { method: 'POST' },
    ),

  // ---- Usage ----
  quoteUsage: (input: UsageTokens) =>
    request<UsageQuote>('/api/usage/quote', { method: 'POST', body: JSON.stringify(input) }),

  recordUsage: (input: UsageTokens & { requestId: string; feature?: string }) =>
    request<RecordUsageResult>('/api/usage/record', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // ---- Project Manager Agent ----
  pmOverview: () => request<PmOverview>('/api/pm/overview', { method: 'GET' }),

  pmProject: (id: string) => request<PmProjectDetail>(`/api/pm/projects/${id}`, { method: 'GET' }),

  pmCreateProject: (input: Record<string, unknown>) =>
    request<{ project: PmProject; seeded: PmSeedResult }>('/api/pm/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  pmUpdateProject: (id: string, patch: Record<string, unknown>) =>
    request<{ project: PmProject }>(`/api/pm/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  pmRun: (projectId?: string) =>
    request<{ result: PmEngineResult }>('/api/pm/run', {
      method: 'POST',
      body: JSON.stringify(projectId ? { projectId } : {}),
    }),

  pmAlertAction: (id: string, status: string, snoozeHours?: number) =>
    request<{ alert: PmAlert }>(`/api/pm/alerts/${id}`, {
      method: 'POST',
      body: JSON.stringify(snoozeHours ? { status, snoozeHours } : { status }),
    }),

  pmCreateTask: (projectId: string, input: Record<string, unknown>) =>
    request<{ task: PmTask }>(`/api/pm/projects/${projectId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  pmUpdateTask: (id: string, patch: Record<string, unknown>) =>
    request<{ task: PmTask }>(`/api/pm/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  pmCreateArea: (projectId: string, input: Record<string, unknown>) =>
    request<{ area: PmDryingArea }>(`/api/pm/projects/${projectId}/areas`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  pmCreateReadings: (projectId: string, readings: Record<string, unknown>[]) =>
    request<{ readings: PmReading[] }>(`/api/pm/projects/${projectId}/readings`, {
      method: 'POST',
      body: JSON.stringify({ readings }),
    }),

  pmUpdateDocument: (id: string, patch: Record<string, unknown>) =>
    request<{ document: PmDocument }>(`/api/pm/documents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  pmEquipment: () =>
    request<{ equipment: PmEquipment[]; placements: PmPlacement[] }>('/api/pm/equipment', {
      method: 'GET',
    }),

  pmPlaceEquipment: (projectId: string, input: Record<string, unknown>) =>
    request<{ placement: PmPlacement }>(`/api/pm/projects/${projectId}/equipment`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  pmRemovePlacement: (id: string) =>
    request<{ placement: PmPlacement }>(`/api/pm/placements/${id}/remove`, { method: 'POST' }),

  pmAssignCrew: (projectId: string, input: Record<string, unknown>) =>
    request<{ assignment: PmAssignment }>(`/api/pm/projects/${projectId}/crew`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  pmBrief: (refresh = false) =>
    request<{ brief: PmBrief; writingEnabled: boolean }>(
      `/api/pm/brief${refresh ? '?refresh=true' : ''}`,
      { method: 'GET' },
    ),

  pmDraftUpdate: (projectId: string, audience: string, instruction?: string) =>
    request<{ update: PmUpdate }>(`/api/pm/projects/${projectId}/updates`, {
      method: 'POST',
      body: JSON.stringify(instruction ? { audience, instruction } : { audience }),
    }),

  pmUpdateDraft: (id: string, status: string) =>
    request<{ update: PmUpdate }>(`/api/pm/updates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  pmSettings: () => request<PmSettingsResponse>('/api/pm/settings', { method: 'GET' }),

  pmUpdateSettings: (patch: Record<string, unknown>) =>
    request<{ settings: PmSettings }>('/api/pm/settings', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  // ---- Web Access ----
  webAccessStatus: () =>
    request<{ enabled: boolean; capacityAvailable: boolean; maxSteps: number }>(
      '/api/web-access/status',
      { method: 'GET' },
    ),

  getWebConnections: () =>
    request<{ connections: WebConnection[] }>('/api/web-access/connections', { method: 'GET' }),

  createWebConnection: (input: WebConnectionInput) =>
    request<{ connection: WebConnection }>('/api/web-access/connections', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateWebConnection: (id: string, input: Partial<WebConnectionInput>) =>
    request<{ connection: WebConnection }>(`/api/web-access/connections/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  deleteWebConnection: (id: string) =>
    request<{ ok: boolean }>(`/api/web-access/connections/${id}`, { method: 'DELETE' }),

  verifyWebConnection: (id: string) =>
    request<{ ok: boolean; reason?: string }>(`/api/web-access/connections/${id}/verify`, {
      method: 'POST',
    }),

  startWebRun: (input: {
    connectionId: string;
    kind: WebRunKind;
    instruction: string;
    data?: unknown;
  }) =>
    request<{ run: WebRun }>('/api/web-access/runs', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  getWebRuns: () => request<{ runs: WebRun[] }>('/api/web-access/runs', { method: 'GET' }),

  getWebRun: (id: string) => request<{ run: WebRun }>(`/api/web-access/runs/${id}`, { method: 'GET' }),

  // ---- Verifier ----
  verifierStatus: () =>
    request<{
      enabled: boolean;
      autoVerify: boolean;
      verifyPulls: boolean;
      maxRepairAttempts: number;
      pending: number;
      capacityAvailable: boolean;
    }>('/api/verifier/status', { method: 'GET' }),

  getVerifications: (runId?: string) =>
    request<{ verifications: Verification[] }>(
      `/api/verifier/verifications${runId ? `?runId=${encodeURIComponent(runId)}` : ''}`,
      { method: 'GET' },
    ),

  getVerification: (id: string) =>
    request<{ verification: Verification }>(`/api/verifier/verifications/${id}`, { method: 'GET' }),

  verifyRun: (runId: string) =>
    request<{ verificationId: string }>(`/api/verifier/runs/${runId}/verify`, { method: 'POST' }),

  getEscalations: (includeResolved = false) =>
    request<{ escalations: Escalation[] }>(
      `/api/verifier/escalations${includeResolved ? '?status=all' : ''}`,
      { method: 'GET' },
    ),

  resolveEscalation: (id: string, optionId: string, note?: string) =>
    request<{ status: string; verificationId: string }>(
      `/api/verifier/escalations/${id}/resolve`,
      { method: 'POST', body: JSON.stringify({ optionId, note }) },
    ),
  // ---- Mitigation estimator ----
  buildEstimate: (input: BuildEstimateInput) =>
    request<{ estimate: MitigationEstimate; priceListConnected: boolean }>(
      '/api/mitigation/build',
      { method: 'POST', body: JSON.stringify(input) },
    ),

  saveEstimate: (input: BuildEstimateInput) =>
    request<{ estimateId: string; jobId: string; estimate: MitigationEstimate }>(
      '/api/mitigation/estimates',
      { method: 'POST', body: JSON.stringify(input) },
    ),

  getEstimatorJobs: () =>
    request<{ jobs: EstimatorJob[] }>('/api/mitigation/jobs', { method: 'GET' }),

  getDemoSources: () =>
    request<{ sources: BuildEstimateInput }>('/api/mitigation/demo-sources', { method: 'GET' }),

  getCarriers: () =>
    request<{ carriers: Array<{ id: string; name: string }>; programs: Array<{ id: string; name: string }> }>(
      '/api/mitigation/carriers',
      { method: 'GET' },
    ),

  getAgreements: () =>
    request<{ agreements: ProgramAgreementSummary[]; source: string }>('/api/mitigation/agreements', {
      method: 'GET',
    }),

  getDeviations: (jobId: string) =>
    request<{ deviations: SlaDeviation[] }>(
      `/api/mitigation/jobs/${encodeURIComponent(jobId)}/deviations`,
      { method: 'GET' },
    ),

  acceptDeviation: (jobId: string, deviation: Omit<SlaDeviation, 'proposed'>) =>
    request<{ deviations: SlaDeviation[] }>(
      `/api/mitigation/jobs/${encodeURIComponent(jobId)}/deviations`,
      { method: 'POST', body: JSON.stringify(deviation) },
    ),

  removeDeviation: (jobId: string, ruleId: string) =>
    request<{ ok: boolean }>(
      `/api/mitigation/jobs/${encodeURIComponent(jobId)}/deviations/${encodeURIComponent(ruleId)}`,
      { method: 'DELETE' },
    ),

  getStandards: () =>
    request<{
      editions: { s500: string; s520: string };
      note: string;
      references: Array<StandardReference & { formatted: string }>;
    }>('/api/mitigation/standards', { method: 'GET' }),

  getEstimatorSettings: () =>
    request<{ settings: EstimatorSettings }>('/api/mitigation/settings', { method: 'GET' }),

  saveEstimatorSettings: (settings: EstimatorSettings) =>
    request<{ settings: EstimatorSettings }>('/api/mitigation/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),

  /** Export URL for an estimate. The browser downloads it directly (cookies ride along). */
  estimateExportUrl: (estimateId: string, format: 'csv' | 'xml' | 'scope') =>
    `${API_BASE}/api/mitigation/estimates/${estimateId}/export?format=${format}`,

  // ---- Xactimate connection ----
  xactimateStatus: () => request<XactimateStatus>('/api/xactimate/status', { method: 'GET' }),

  xactimateConnect: (input: XactimateConnectInput) =>
    request<XactimateConnectResponse>('/api/xactimate/connect', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  xactimateDisconnect: () =>
    request<{ ok: boolean }>('/api/xactimate/disconnect', { method: 'POST' }),

  xactimatePriceLists: () =>
    request<{ priceLists: PriceListSummary[]; selected: string | null }>(
      '/api/xactimate/price-lists',
      { method: 'GET' },
    ),

  xactimateSyncPriceList: (priceListId: string) =>
    request<{ priceListId: string; name: string; entryCount: number }>(
      '/api/xactimate/price-lists/sync',
      { method: 'POST', body: JSON.stringify({ priceListId }) },
    ),

  xactimateActivity: () =>
    request<{ activity: XactimateActivity[] }>('/api/xactimate/activity', { method: 'GET' }),

  xactimatePush: (estimate: MitigationEstimate, confirmedFindings: boolean) =>
    request<{ estimateId: string; url?: string; lineItemsWritten: number; warnings: string[] }>(
      '/api/xactimate/push',
      { method: 'POST', body: JSON.stringify({ estimate, confirmedFindings }) },
    ),



  // ---- Construction Estimator ----
  estimatorStatus: () => request<EstimatorStatus>('/api/estimator/status', { method: 'GET' }),

  saveEstimatorCredential: (provider: EstimatorProvider, input: EstimatorCredentialInput) =>
    request<{ credential: EstimatorCredential }>(`/api/estimator/credentials/${provider}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  deleteEstimatorCredential: (provider: EstimatorProvider) =>
    request<{ ok: boolean }>(`/api/estimator/credentials/${provider}`, { method: 'DELETE' }),

  testEstimatorCredential: (provider: EstimatorProvider) =>
    request<{ ok: boolean; connector: string }>(`/api/estimator/credentials/${provider}/test`, {
      method: 'POST',
    }),

  listScanProjects: (search?: string) =>
    request<{ projects: ScanProjectSummary[] }>(
      `/api/estimator/projects${search ? `?search=${encodeURIComponent(search)}` : ''}`,
      { method: 'GET' },
    ),

  startEstimatorRun: (scanProjectId: string, mitigationText?: string) =>
    request<{ run: EstimatorRun }>('/api/estimator/runs', {
      method: 'POST',
      body: JSON.stringify({ scanProjectId, mitigationText: mitigationText || undefined }),
    }),

  listEstimatorRuns: () =>
    request<{ runs: EstimatorRun[] }>('/api/estimator/runs', { method: 'GET' }),

  getEstimatorRun: (runId: string) =>
    request<{ run: EstimatorRun }>(`/api/estimator/runs/${runId}`, { method: 'GET' }),

  selectEstimatorJob: (runId: string, jobId: string) =>
    request<{ run: EstimatorRun }>(`/api/estimator/runs/${runId}/job`, {
      method: 'POST',
      body: JSON.stringify({ jobId }),
    }),

  approveEstimatorRun: (runId: string) =>
    request<{ run: EstimatorRun }>(`/api/estimator/runs/${runId}/approve`, { method: 'POST' }),

  /** Download URL — the browser fetches it directly so the file streams. */
  estimatorExportUrl: (runId: string, format: 'csv' | 'xml') =>
    `${API_BASE}/api/estimator/runs/${runId}/export?format=${format}`,
  // ---- Computer use ----
  computerStatus: () => request<ComputerStatus>('/api/computer/status', { method: 'GET' }),

  connectAnthropicKey: (apiKey: string) =>
    request<{ credential: CredentialStatus }>('/api/computer/credentials', {
      method: 'PUT',
      body: JSON.stringify({ apiKey }),
    }),

  disconnectAnthropicKey: () =>
    request<{ credential: CredentialStatus }>('/api/computer/credentials', { method: 'DELETE' }),

  createPairingCode: () =>
    request<{ code: string; expiresAt: string }>('/api/computer/agents/pair-code', {
      method: 'POST',
    }),

  getAgents: () => request<{ agents: ComputerAgent[] }>('/api/computer/agents', { method: 'GET' }),

  getAgentScreen: (agentId: string) =>
    request<{ image: string; width: number; height: number }>(
      `/api/computer/agents/${encodeURIComponent(agentId)}/screen`,
      { method: 'GET' },
    ),

  startRun: (input: {
    agentId: string;
    instruction: string;
    model?: string;
    quality?: CaptureQuality;
  }) =>
    request<{ run: ComputerRun }>('/api/computer/runs', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateTask: (jobId: string, taskId: string, patch: Partial<CreateTaskInput>) =>
    request<{ task: JobTask }>(`/api/jobs/${jobId}/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  // ---- Crew ----
  assignAgent: (jobId: string, userId: string, roleOnJob?: AssignmentRole) =>
    request<{ assignment: JobAssignment }>(`/api/jobs/${jobId}/crew`, {
      method: 'POST',
      body: JSON.stringify({ userId, roleOnJob }),
    }),

  releaseAgent: (jobId: string, assignmentId: string) =>
    request<{ assignment: JobAssignment }>(`/api/jobs/${jobId}/crew/${assignmentId}/release`, {
      method: 'POST',
    }),

  // ---- Work logs ----
  addWorkLog: (jobId: string, input: CreateWorkLogInput) =>
    request<{ workLog: WorkLog }>(`/api/jobs/${jobId}/logs`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // ---- Memory ----
  getMemory: (params: MemoryQuery = {}) => {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') qs.set(key, String(value));
    }
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<{ events: MemoryEvent[]; nextCursor: number | null }>(`/api/memory${suffix}`, {
      method: 'GET',
    });
  },

  getMemoryStats: () => request<MemoryStats>('/api/memory/stats', { method: 'GET' }),

  getMemoryAgents: () =>
    request<{ agents: AgentMemory[] }>('/api/memory/agents', { method: 'GET' }),

  getMemoryAgent: (userId: string, before?: number) =>
    request<{
      agent: AgentMemory;
      openTasks: unknown[];
      events: MemoryEvent[];
      nextCursor: number | null;
    }>(`/api/memory/agents/${userId}${before ? `?before=${before}` : ''}`, { method: 'GET' }),

  /** The export streams NDJSON, so it is a plain link rather than a fetch. */
  memoryExportUrl: () => `${API_BASE}/api/memory/export`,
  getUsageEvents: (limit = 50) =>
    request<{ events: UsageEvent[] }>(`/api/usage/events?limit=${limit}`, { method: 'GET' }),

  getUsageDaily: (days = 30) =>
    request<{ days: UsageDay[] }>(`/api/usage/daily?days=${days}`, { method: 'GET' }),

  // ---- Model calls (metered server-side) ----

  /** Exact pre-flight token count from the provider's tokenizer. */
  countTokens: (input: { model?: string; messages: ChatMessage[]; system?: string }) =>
    request<{ model: string; inputTokens: number; inputPriceNanos: number }>(
      '/api/model/count-tokens',
      { method: 'POST', body: JSON.stringify(input) },
    ),

  /**
   * Run a model call. Usage is metered from the provider's response, never from
   * anything this client reports, so the returned charge is authoritative.
   */
  sendMessages: (input: {
    model?: string;
    messages: ChatMessage[];
    system?: string;
    maxTokens?: number;
    thinking?: boolean;
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    feature?: string;
    requestId?: string;
  }) => request<CompletionResult>('/api/model/messages', { method: 'POST', body: JSON.stringify(input) }),
  getRuns: () => request<{ runs: ComputerRun[] }>('/api/computer/runs', { method: 'GET' }),

  stopRun: (runId: string) =>
    request<{ run: ComputerRun }>(`/api/computer/runs/${encodeURIComponent(runId)}/stop`, {
      method: 'POST',
    }),

  /** SSE URL for a run's transcript. `after` replays what the browser missed. */
  runEventsUrl: (runId: string, after = 0) =>
    `${API_BASE}/api/computer/runs/${encodeURIComponent(runId)}/events?after=${after}`,
};

/** Labels for the run states, kept next to the other shared UI copy. */
export const RUN_STATUS_LABELS: Record<AgentRunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export const STEP_TYPE_LABELS: Record<AgentStepType, string> = {
  status: 'Status',
  thought: 'Reasoning',
  message: 'Message',
  tool_call: 'Action',
  tool_result: 'Result',
  observation: 'Observation',
  navigation: 'Navigation',
  decision: 'Decision',
  artifact: 'Artifact',
  usage: 'Usage',
  error: 'Error',
  event: 'Event',
};

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | unknown[];
}

export interface MeasuredUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
}

export interface CompletionResult {
  id: string;
  model: string;
  stopReason: string | null;
  content: unknown[];
  usage: MeasuredUsage;
  billing: {
    /** Worst-case amount reserved before the call ran. */
    authorizedNanos: number;
    /** What was actually charged, from the provider's usage totals. */
    chargedNanos: number;
    duplicate: boolean;
    balance: CreditBalance;
  };
}

/* ------------------------------------------------------------ billing types */

export type PlanCode = 'free' | 'pro' | 'max_5x' | 'max_20x' | 'team' | 'enterprise';
export type BillingInterval = 'monthly' | 'annual';

export interface Plan {
  code: PlanCode;
  name: string;
  tagline: string | null;
  monthlyPriceCents: number;
  annualPriceCents: number | null;
  includedCreditsNanos: number;
  perSeat: boolean;
  minSeats: number;
  rateMultiplier: number;
  features: string[];
  isContactSales: boolean;
}

export interface CreditPack {
  code: string;
  name: string;
  priceCents: number;
  creditsNanos: number;
  bonusNanos: number;
}

/**
 * Sell prices only. The cost basis and markup live in a private schema the
 * browser can never read.
 */
export interface ModelRate {
  modelId: string;
  displayName: string;
  family: string;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWrite5mPerMTok: number;
  cacheWrite1hPerMTok: number;
  cacheReadPerMTok: number;
  batchDiscountPct: number;
  contextWindow: number | null;
  maxOutputTokens: number | null;
}

export interface Catalog {
  plans: Plan[];
  packs: CreditPack[];
  rateCard: ModelRate[];
  /** `stripe` whenever a Stripe key is configured server-side. */
  paymentProvider: 'stripe' | 'dev' | 'manual';
}

export interface CreditBalance {
  totalNanos: number;
  planNanos: number;
  purchasedNanos: number;
  promoNanos: number;
  nextExpiry: string | null;
}

export interface BillingSettings {
  autoReloadEnabled: boolean;
  autoReloadThresholdNanos: number;
  autoReloadAmountNanos: number;
  /** `null` means no cap. */
  monthlySpendLimitNanos: number | null;
}

export type BillingSettingsPatch = Partial<BillingSettings>;

export interface BillingOverview {
  subscription: {
    planCode: PlanCode;
    planName: string;
    billingInterval: BillingInterval;
    seats: number;
    status: string;
    periodStart: string;
    periodEnd: string;
    cancelAtPeriodEnd: boolean;
    monthlyPriceCents: number;
    includedCreditsNanos: number;
    rateMultiplier: number;
  };
  settings: BillingSettings;
  balance: CreditBalance;
  periodUsage: {
    events: number;
    priceNanos: number;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
  };
  usageByModel: {
    modelId: string;
    displayName: string;
    events: number;
    inputTokens: number;
    outputTokens: number;
    priceNanos: number;
  }[];
  /** False for roles that may view billing but not change it. */
  canManage: boolean;
}

export interface SetPlanResult {
  plan: string;
  changed: boolean;
  effectiveAt: string | null;
  cancelAtPeriodEnd: boolean;
  grantedNanos: number;
  balance: CreditBalance;
}

export interface LedgerEntry {
  id: string;
  entryType: 'plan_grant' | 'purchase' | 'usage' | 'refund' | 'expiration' | 'adjustment';
  bucket: 'plan' | 'purchased' | 'promotional' | null;
  /** Signed: positive adds credits, negative consumes them. */
  amountNanos: number;
  description: string | null;
  createdAt: string;
}

export interface Purchase {
  id: string;
  packCode: string | null;
  creditsNanos: number;
  bonusNanos: number;
  amountCents: number;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  provider: string;
  isAutoReload?: boolean;
  createdAt?: string;
  completedAt?: string | null;
}

/**
 * One row of the in-product payment history. `receiptUrl` and `invoicePdfUrl`
 * come from Stripe, so a customer can always retrieve proof of payment.
 */
export interface Payment {
  id: string;
  kind: 'subscription' | 'credits' | 'refund';
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  amountCents: number;
  currency: string;
  description: string | null;
  receiptUrl: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  receiptEmail: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  failureReason: string | null;
  createdAt: string;
}

export const PAYMENT_KIND_LABELS: Record<Payment['kind'], string> = {
  subscription: 'Subscription',
  credits: 'Usage credits',
  refund: 'Refund',
};

/* -------------------------------------------------------------- usage types */

export interface UsageTokens {
  modelId: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheWrite5mTokens?: number;
  cacheWrite1hTokens?: number;
  cacheReadTokens?: number;
  isBatch?: boolean;
}

export interface UsageBreakdown {
  input: { tokens: number; priceNanos: number };
  output: { tokens: number; priceNanos: number };
  cacheWrite5m: { tokens: number; priceNanos: number };
  cacheWrite1h: { tokens: number; priceNanos: number };
  cacheRead: { tokens: number; priceNanos: number };
}

export interface UsageQuote {
  modelId: string;
  isBatch: boolean;
  priceNanos: number;
  breakdown: UsageBreakdown;
}

export interface RecordUsageResult {
  eventId: string;
  priceNanos: number;
  /** True when this request id had already been billed. */
  duplicate: boolean;
  breakdown: UsageBreakdown;
  balance: CreditBalance;
}

export interface UsageEvent {
  id: string;
  modelId: string;
  feature: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  isBatch: boolean;
  priceNanos: number;
  createdAt: string;
}

export interface UsageDay {
  day: string;
  modelId: string;
  events: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  priceNanos: number;
}

export const PLAN_ORDER: PlanCode[] = ['free', 'pro', 'max_5x', 'max_20x', 'team', 'enterprise'];

export const LEDGER_LABELS: Record<LedgerEntry['entryType'], string> = {
  plan_grant: 'Plan credits',
  purchase: 'Credit purchase',
  usage: 'Usage',
  refund: 'Refund',
  expiration: 'Expired',
  adjustment: 'Adjustment',
};


/* ------------------------------------------------------------------ *
 * Project Manager Agent types
 * ------------------------------------------------------------------ */

export type PmPhase =
  | 'intake'
  | 'inspection'
  | 'approval'
  | 'scheduled'
  | 'mitigation'
  | 'drying'
  | 'drying_complete'
  | 'permitting'
  | 'production'
  | 'punch_list'
  | 'final_review'
  | 'invoicing'
  | 'paid';

export interface PmProject {
  id: string;
  orgId: string;
  projectNumber: string;
  name: string;
  description: string | null;
  workType: WorkType;
  lossType: string | null;
  status: 'active' | 'on_hold' | 'closed' | 'cancelled';
  phase: PmPhase;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  pmUserId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  addressLine1: string | null;
  city: string | null;
  region: string | null;
  carrier: string | null;
  claimNumber: string | null;
  adjusterName: string | null;
  scheduledStartAt: string | null;
  targetCompletionAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PmHealth {
  score: number;
  band: 'good' | 'watch' | 'at_risk' | 'critical';
  reasons: { weight: number; text: string }[];
}

export interface PmTask {
  id: string;
  projectId: string;
  title: string;
  details: string | null;
  status: 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  category: string;
  assignedTo: string | null;
  dueAt: string | null;
  source: 'manual' | 'playbook' | 'agent';
  originKey: string | null;
  blockedReason: string | null;
  completedAt: string | null;
}

export interface PmAlert {
  id: string;
  projectId: string | null;
  ruleKey: string;
  severity: 'info' | 'warn' | 'critical';
  category: string;
  title: string;
  detail: string | null;
  suggestedAction: string | null;
  status: 'open' | 'acknowledged' | 'snoozed' | 'resolved' | 'dismissed';
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  facts: Record<string, unknown>;
  project?: { id: string; projectNumber: string; name: string } | null;
}

export interface PmDryingArea {
  id: string;
  projectId: string;
  label: string;
  material: string;
  dryGoalPct: number;
  waterClass: number | null;
  affectedSqft: number | null;
  affectedCuft: number | null;
  driedAt: string | null;
  signedOffAt: string | null;
}

export interface PmReading {
  id: string;
  areaId: string | null;
  kind: string;
  moisturePct: number | null;
  temperatureF: number | null;
  humidityPct: number | null;
  gpp: number | null;
  note: string | null;
  takenAt: string;
}

export interface PmDocument {
  id: string;
  projectId: string;
  requirementKey: string;
  label: string;
  kind: string;
  status: 'missing' | 'provided' | 'waived' | 'rejected';
  isBlocking: boolean;
  requiredByPhase: string | null;
  note: string | null;
  externalRef: string | null;
}

export interface PmMilestone {
  id: string;
  label: string;
  kind: string;
  dueAt: string;
  completedAt: string | null;
  note: string | null;
}

export interface PmEquipment {
  id: string;
  assetTag: string;
  kind: string;
  makeModel: string | null;
  capacityPintsDay: number | null;
  capacityCfm: number | null;
  status: 'available' | 'deployed' | 'maintenance' | 'retired';
  dailyRateCents: number | null;
}

export interface PmPlacement {
  id: string;
  projectId: string;
  equipmentId: string;
  areaLabel: string | null;
  placedAt: string;
  removedAt: string | null;
  equipment?: {
    assetTag: string;
    kind: string;
    capacityPintsDay: number | null;
    capacityCfm: number | null;
  } | null;
}

export interface PmAssignment {
  id: string;
  projectId: string;
  userId: string;
  roleOnProject: string;
  allocationPct: number;
  releasedAt: string | null;
}

export interface PmUpdate {
  id: string;
  projectId: string;
  audience: 'customer' | 'adjuster' | 'team';
  channel: string;
  status: 'draft' | 'approved' | 'sent' | 'discarded';
  subject: string | null;
  body: string;
  origin: 'agent' | 'manual';
  modelId: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface PmBrief {
  id: string;
  forDate: string;
  kind: string;
  headline: string | null;
  body: string;
  modelId: string | null;
  facts: Record<string, unknown>;
  createdAt: string;
}

export interface PmSettings {
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
}

export interface PmRule {
  key: string;
  label: string;
  description: string;
  category: string;
  scope: string;
}

export interface PmSettingsResponse {
  settings: PmSettings;
  rules: PmRule[];
  canManage: boolean;
  writingEnabled: boolean;
}

export interface PmCrewLoad {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: string;
  projectCount: number;
  allocationPct: number;
  openTaskCount: number;
  overdueTaskCount: number;
  projectNumbers: string[];
}

export interface PmProjectSummary {
  project: PmProject;
  health: PmHealth;
  openTasks: number;
  overdueTasks: number;
  crewCount: number;
  daysSinceActivity: number;
  drying: {
    openAreas: number;
    areasAtGoal: number;
    areasOverdue: number;
    areasStalled: number;
    daysDrying: number;
    allAreasAtGoal: boolean;
  } | null;
  documentation: { completionPct: number; invoiceReady: boolean; blocking: number };
}

export interface PmOverview {
  settings: PmSettings;
  role: MemberRole;
  canManage: boolean;
  writingEnabled: boolean;
  counts: { projects: number; critical: number; warn: number; mine: number };
  alerts: PmAlert[];
  projects: PmProjectSummary[];
  crew: PmCrewLoad[];
  members: { userId: string; email: string | null; fullName: string | null; role: string }[];
}

export interface PmAreaAnalysis {
  areaId: string;
  label: string;
  material: string;
  dryGoalPct: number;
  state: 'drying' | 'stalled' | 'wetter' | 'goal_met' | 'signed_off' | 'no_readings';
  latestMoisturePct: number | null;
  latestReadingAt: string | null;
  hoursSinceReading: number | null;
  readingOverdue: boolean;
  remainingPct: number | null;
  projectedDaysToGoal: number | null;
  daysDrying: number;
  trend: {
    daily: { takenAt: string; moisturePct: number }[];
    totalDropPct: number | null;
    lastDropPct: number | null;
    flatDays: number;
  };
}

export interface PmProjectDetail {
  project: PmProject;
  tasks: PmTask[];
  assignments: PmAssignment[];
  areas: PmDryingArea[];
  readings: PmReading[];
  placements: PmPlacement[];
  documents: PmDocument[];
  milestones: PmMilestone[];
  alerts: PmAlert[];
  updates: PmUpdate[];
  analysis: {
    drying: {
      isDrying: boolean;
      areas: PmAreaAnalysis[];
      openAreas: number;
      areasAtGoal: number;
      areasOverdue: number;
      areasStalled: number;
      daysDrying: number;
      allAreasAtGoal: boolean;
      equipmentStillOnDriedProject: boolean;
      ambient: { temperatureF: number; humidityPct: number; gpp: number; dewPointF: number } | null;
      outside: { temperatureF: number; humidityPct: number; gpp: number } | null;
      equipment: {
        airMoversOnSite: number;
        airMoversRequired: number;
        dehuPintsOnSite: number;
        dehuPintsRequired: number;
        sufficient: boolean | null;
        shortfallNote: string | null;
      };
    };
    schedule: {
      overdueTasks: PmTask[];
      dueTodayTasks: PmTask[];
      blockedTasks: PmTask[];
      hasNoNextStep: boolean;
      daysSinceActivity: number;
      overrunDays: number | null;
      daysUntilTarget: number | null;
    };
    compliance: {
      missingBlocking: PmDocument[];
      overdueBlocking: PmDocument[];
      completionPct: number;
      invoiceReady: boolean;
      blockingInvoiceNow: boolean;
      milestones: {
        milestone: PmMilestone;
        state: 'done' | 'overdue' | 'due_soon' | 'upcoming';
        daysOverdue: number;
      }[];
    };
    health: PmHealth;
  };
  phases: PmPhase[];
  playbook: { phase: string; label: string; intent: string } | null;
  canManage: boolean;
}

export interface PmSeedResult {
  documents: number;
  milestones: number;
  tasks: number;
}

export interface PmEngineResult {
  ranAt: string;
  durationMs: number;
  projectsEvaluated: number;
  rulesEvaluated: number;
  findings: number;
  alertsOpened: number;
  alertsUpdated: number;
  alertsCleared: number;
  tasksCreated: number;
  rulesSkipped: string[];
  warnings: string[];
}

/** Human-readable phase labels, shared by the PM screens. */
export const PM_PHASE_LABELS: Record<PmPhase, string> = {
  intake: 'Intake',
  inspection: 'Inspection',
  approval: 'Approval',
  scheduled: 'Scheduled',
  mitigation: 'Mitigation',
  drying: 'Drying',
  drying_complete: 'Dry-out complete',
  permitting: 'Permitting',
  production: 'Production',
  punch_list: 'Punch list',
  final_review: 'Final review',
  invoicing: 'Invoicing',
  paid: 'Paid',
};

/** How each verification state reads in the UI. */
export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  queued: 'Check queued',
  running: 'Checking…',
  verified: 'Verified',
  repaired: 'Fixed and verified',
  escalated: 'Needs your answer',
  rejected: 'Confirmed not done',
  failed: "Couldn't be checked",
  cancelled: 'Check cancelled',
};

export const VERDICT_LABELS: Record<Verdict, string> = {
  satisfied: 'Found on the site',
  violated: 'Missing or wrong',
  indeterminate: 'Could not tell',
};

/** Friendly labels for the platform string the agent reports. */
export const PLATFORM_LABELS: Record<string, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
};

export const QUALITY_LABELS: Record<CaptureQuality, string> = {
  economical: 'Economical — smallest screenshots, lowest cost',
  balanced: 'Balanced — about 1080p (recommended)',
  detailed: 'Detailed — highest resolution the model allows',
};

/* ------------------------------------------------------------------ */
/* Construction Estimator types                                        */
/* ------------------------------------------------------------------ */

export type EstimatorProvider = 'docusketch' | 'dash' | 'xactimate';

export interface EstimatorCredential {
  provider: EstimatorProvider;
  label: string | null;
  fingerprint: string;
  baseUrl: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export interface EstimatorCredentialInput {
  label?: string;
  username?: string;
  password?: string;
  apiKey?: string;
  accountId?: string;
  baseUrl?: string;
}

export interface EstimatorStatus {
  /** True when the server is serving fixtures instead of talking to vendors. */
  sandbox: boolean;
  modelAvailable: boolean;
  credentialStorageAvailable: boolean;
  canManageCredentials: boolean;
  maxPhotosPerRun: number;
  credentials: EstimatorCredential[];
}

export interface ScanProjectSummary {
  id: string;
  name: string;
  address?: string;
  claimNumber?: string;
  capturedAt?: string;
}

export type EstimatorRunStatus = 'running' | 'awaiting_review' | 'complete' | 'failed' | 'cancelled';

export type EstimatorRunStage =
  | 'queued'
  | 'connecting'
  | 'fetching_scan'
  | 'matching_job'
  | 'analyzing_photos'
  | 'reading_mitigation'
  | 'building_scope'
  | 'pricing'
  | 'awaiting_review'
  | 'exporting'
  | 'complete';

export interface EstimatorRunEvent {
  at: string;
  stage: EstimatorRunStage;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface MatchSignal {
  field: string;
  weight: number;
  score: number;
  detail: string;
}

export interface MatchCandidate {
  jobId: string;
  jobNumber?: string;
  claimNumber?: string;
  insuredName?: string;
  address?: string;
  lossDate?: string;
  score: number;
  signals: MatchSignal[];
}

export interface EstimateLineItem {
  roomId: string;
  roomName: string;
  code: string;
  category: string;
  selector: string;
  description: string;
  unit: string;
  quantity: number;
  quantityWithWaste: number;
  trade: string;
  rationale: string;
  confidence: number;
  evidence: string[];
  needsReview?: boolean;
}

export interface ConstructionEstimate {
  jobId: string;
  jobNumber?: string;
  claimNumber?: string;
  insuredName?: string;
  address: { street?: string; city?: string; state?: string; postalCode?: string };
  basis: 'scan' | 'mitigation' | 'both';
  lineItems: EstimateLineItem[];
  summary: {
    lineItemCount: number;
    roomCount: number;
    quantityByUnit: Record<string, number>;
    itemsNeedingReview: number;
    emptyRooms: string[];
  };
  warnings: string[];
  generatedAt: string;
}

export interface EstimatorRun {
  id: string;
  status: EstimatorRunStatus;
  stage: EstimatorRunStage;
  scanProjectId: string;
  crmJobId: string | null;
  matchScore: number | null;
  matchNeedsReview: boolean;
  matchCandidates: MatchCandidate[];
  matchReason: string | null;
  job: { jobNumber?: string; claimNumber?: string; insuredName?: string } | null;
  estimate: ConstructionEstimate | null;
  exportRef: string | null;
  error: string | null;
  events: EstimatorRunEvent[];
  createdAt: string;
  updatedAt: string;
}

/** Stage labels, in the order the pipeline runs them. */
export const ESTIMATOR_STAGE_LABELS: Record<EstimatorRunStage, string> = {
  queued: 'Queued',
  connecting: 'Connecting',
  fetching_scan: 'Reading the scan',
  matching_job: 'Finding the job',
  analyzing_photos: 'Reading the photos',
  reading_mitigation: 'Reading the mitigation estimate',
  building_scope: 'Building scope',
  pricing: 'Assembling the estimate',
  awaiting_review: 'Ready for review',
  exporting: 'Writing to Xactimate',
  complete: 'Complete',
};

export const PROVIDER_LABELS: Record<EstimatorProvider, string> = {
  docusketch: 'DocuSketch',
  dash: 'Dash (CRM)',
  xactimate: 'Xactimate',
};

/** Human-readable labels for roles and work types (shared UI copy). */
export const ROLE_LABELS: Record<MemberRole, string> = {
  project_manager: 'Project Manager',
  field_technician: 'Field Technician',
  accountant: 'Accountant',
  office_manager: 'Office Manager',
  sales: 'Sales',
};

export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  mitigation: 'Mitigation',
  construction: 'Construction',
};

export const CONTRACTOR_TYPE_LABELS: Record<ContractorType, string> = {
  restoration: 'Restoration company',
  roofing: 'Roofing company',
  general_contractor: 'General contractor',
  other: 'Something else',
};

export const USAGE_INTENT_LABELS: Record<UsageIntent, string> = {
  mitigation_estimating: 'Mitigation estimating',
  construction_estimating: 'Construction estimating',
  project_management: 'Project management',
  crm: 'CRM / leads and jobs',
  web_access: 'AI access to other systems',
  field_work: 'Field / technician work',
  billing: 'Billing and credits',
  exploring: 'Still exploring',
};



/* ------------------------------------------------------------------ *
 * Estimator types
 *
 * Mirrors backend/src/estimator/types.ts. Only the fields the UI actually
 * renders are declared — the payload carries more (the full assessment, every
 * scope item) and it round-trips untouched when an estimate is pushed.
 * ------------------------------------------------------------------ */

export interface BuildEstimateInput {
  jobId?: string;
  /** A human's correction to who the estimate is for. Always beats inference. */
  carrier?: { carrierId?: string; programId?: string };
  docusketch?: unknown;
  mica?: unknown;
  photos?: PhotoManifestEntry[];
  notes?: string;
  overrides?: Record<string, unknown>;
  settings?: EstimatorSettings;
}

export interface PhotoManifestEntry {
  filename?: string;
  capturedAt?: string;
  caption?: string;
  roomName?: string;
  uri?: string;
}

export interface EstimatorSettings {
  targetMargin?: number;
  overheadAndProfitRate?: number;
  oAndPEligible?: boolean;
  taxRate?: number;
  costMultiplier?: number;
  lineMarginFloor?: number;
  hoursPerMonitoringVisit?: number;
  techniciansOnSite?: number;
  category3CutHeightIn?: number;
  costOverrides?: Record<string, number>;
}

export interface EstimatorJob {
  id: string;
  name: string;
  claimNumber: string | null;
  status: string;
  createdAt: string;
}

export interface MitigationLineItem {
  id: string;
  code: string;
  category: string;
  description: string;
  roomName?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  rcv: number;
  totalCost: number;
  justification: string;
  /** Registry ids of the IICRC requirements behind this line. */
  citations: string[];
  evidenceIds: string[];
  evidenceGap?: string;
  priceVerified: boolean;
}

/* ---- IICRC standards ---- */

/**
 * How firmly a citation is anchored. `convention` is the one that matters most
 * to render honestly — it marks a practice the industry attributes to the
 * standard that the standard itself leaves to judgement.
 */
export type CitationConfidence = 'clause' | 'chapter' | 'convention';

export interface StandardReference {
  id: string;
  standard: 'S500' | 'S520';
  edition: string;
  chapter: string;
  section?: string;
  title: string;
  requirement: string;
  application: string;
  confidence: CitationConfidence;
  caveat?: string;
}

export type ComplianceStatus = 'met' | 'unmet' | 'undetermined' | 'not_applicable';

/* ---- Carrier program terms ---- */

export type SlaStatus =
  | 'met'
  | 'violated'
  | 'deviation_documented'
  | 'approval_required'
  | 'not_applicable'
  | 'undetermined';

export interface SlaDeviation {
  ruleId: string;
  reason: string;
  evidenceIds: string[];
  authorizedBy?: string;
  authorizedAt?: string;
  proposed?: boolean;
}

export interface SlaCheck {
  ruleId: string;
  title: string;
  status: SlaStatus;
  severity: 'hard' | 'soft';
  detail: string;
  remedy?: string;
  revenueImpact?: number;
  deviation?: SlaDeviation;
  sourceRef?: string;
}

export interface CarrierIdentification {
  carrierId: string | null;
  carrierName: string | null;
  programId: string | null;
  programName: string | null;
  confidence: 'stated' | 'inferred' | 'unknown';
  basis: string[];
  alternatives: Array<{ carrierId: string; carrierName: string; basis: string }>;
}

export interface ProgramAgreementSummary {
  carrierId: string;
  carrierName: string;
  programId: string;
  programName: string;
  version: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  rules: Array<{ id: string; title: string; summary: string; severity: 'hard' | 'soft'; sourceRef?: string }>;
  source: { kind: string; reference?: string; retrievedAt: string; enteredBy?: string };
}

export interface SlaComplianceReport {
  identification: CarrierIdentification;
  agreement: ProgramAgreementSummary | null;
  checks: SlaCheck[];
  met: number;
  violated: number;
  deviations: number;
  proposedDeviations: SlaDeviation[];
  blocksSubmission: boolean;
  summary: string;
}

export interface ComplianceCheck {
  id: string;
  citation: string;
  title: string;
  status: ComplianceStatus;
  detail: string;
  remedy?: string;
  affectsEstimate?: boolean;
}

export interface ComplianceReport {
  checks: ComplianceCheck[];
  met: number;
  unmet: number;
  undetermined: number;
  citations: string[];
  summary: string;
}

export interface ProfitFinding {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  kind: string;
  title: string;
  detail: string;
  revenueImpact: number;
  marginImpact: number;
  actionRequired?: string;
  relatedCode?: string;
}

export interface ProfitabilitySummary {
  subtotal: number;
  overheadAndProfit: number;
  tax: number;
  total: number;
  totalCost: number;
  grossProfit: number;
  grossMargin: number;
  targetMargin: number;
  marginGap: number;
  findings: ProfitFinding[];
  recoverableRevenue: number;
}

export interface AssessedRoomSummary {
  id: string;
  name: string;
  level: string;
  geometry: { floorSF: number; wallSF: number; ceilingSF: number; perimeterLF: number; heightFt: number };
  affectedFloorFraction: number;
  ceilingAffected: boolean;
}

export interface LossAssessmentSummary {
  jobId: string;
  propertyAddress?: string;
  claimNumber?: string;
  carrier?: string;
  insuredName?: string;
  dateOfLoss?: string;
  cause: string;
  sourceCategory: 1 | 2 | 3;
  category: 1 | 2 | 3;
  class: 1 | 2 | 3 | 4;
  rooms: AssessedRoomSummary[];
  dryingDays: number;
  monitoringVisits: number;
  microbialGrowthPresent: boolean;
  sourcesUsed: string[];
  evidence: Array<{ id: string; kind: string; description: string; tags: string[] }>;
}

export interface MitigationEstimate {
  jobId: string;
  generatedAt: string;
  assessment: LossAssessmentSummary;
  lineItems: MitigationLineItem[];
  profitability: ProfitabilitySummary;
  /** The estimate read back against the IICRC standards. */
  compliance: ComplianceReport;
  /** The carrier program terms, and whether the estimate satisfies them. */
  sla: SlaComplianceReport;
  /** Every standard cited anywhere in this estimate, resolved. */
  references: StandardReference[];
  narrative: string;
  openQuestions: string[];
}

/* ---- Xactimate ---- */

export type ConsentScope =
  | 'read_profile'
  | 'read_price_list'
  | 'read_estimates'
  | 'write_estimate'
  | 'submit_estimate';

export interface XactimateStatus {
  connected: boolean;
  sessionActive: boolean;
  driver: 'mock' | 'api' | 'web';
  storageAvailable: boolean;
  webAutomationEnabled: boolean;
  username: string | null;
  scopes: ConsentScope[];
  storageMode: 'session' | 'stored';
  grantedAt: string | null;
  expiresAt: string | null;
  priceListId: string | null;
  availableScopes: Array<{ scope: ConsentScope; description: string; defaultGranted: boolean }>;
}

export interface XactimateConnectInput {
  username: string;
  password: string;
  mfaCode?: string;
  scopes: ConsentScope[];
  storageMode: 'session' | 'stored';
  consentDays: number;
  acknowledgedTerms: true;
}

export type XactimateConnectResponse =
  | { status: 'connected'; profile: { username: string; displayName?: string; companyName?: string }; scopes: ConsentScope[]; expiresAt: string }
  | { status: 'mfa_required'; challengeId: string; message: string };

export interface PriceListSummary {
  id: string;
  name: string;
  effectiveDate?: string;
}

export interface XactimateActivity {
  id: string;
  scope: string;
  action: string;
  detail: string;
  succeeded: boolean;
  at: string;
}

/** Shared currency formatting so every surface agrees to the cent. */
export const usd = (value: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  on_hold: 'On hold',
  completed: 'Completed',
  invoiced: 'Invoiced',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

export const JOB_PRIORITY_LABELS: Record<JobPriority, string> = {
  1: 'Urgent',
  2: 'High',
  3: 'Normal',
  4: 'Low',
  5: 'Lowest',
};

export const JOB_PRIORITY_STYLES: Record<JobPriority, string> = {
  1: 'text-rose-300',
  2: 'text-amber-300',
  3: 'text-gray-300',
  4: 'text-gray-400',
  5: 'text-gray-500',
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
  cancelled: 'Cancelled',
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

export const LOSS_TYPE_LABELS: Record<LossType, string> = {
  water: 'Water',
  fire: 'Fire',
  mold: 'Mold',
  storm: 'Storm',
  biohazard: 'Biohazard',
  contents: 'Contents',
  other: 'Other',
};

export const WORK_LOG_KIND_LABELS: Record<WorkLogKind, string> = {
  work: 'Work',
  note: 'Note',
  call: 'Call',
  site_visit: 'Site visit',
  photo: 'Photo',
  material: 'Material',
  issue: 'Issue',
};

export const ASSIGNMENT_ROLE_LABELS: Record<AssignmentRole, string> = {
  lead: 'Lead',
  crew: 'Crew',
  estimator: 'Estimator',
  supervisor: 'Supervisor',
  observer: 'Observer',
};

/** Tailwind classes per job status, so a board reads at a glance. */
export const JOB_STATUS_STYLES: Record<JobStatus, string> = {
  draft: 'border-sky-400/30 bg-sky-400/10 text-sky-200',
  scheduled: 'border-violet-400/30 bg-violet-400/10 text-violet-200',
  in_progress: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  on_hold: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  completed: 'border-teal-400/30 bg-teal-400/10 text-teal-200',
  invoiced: 'border-blue-400/30 bg-blue-400/10 text-blue-200',
  paid: 'border-white/15 bg-white/5 text-gray-300',
  cancelled: 'border-rose-400/30 bg-rose-400/10 text-rose-200',
};

export const PRIORITY_STYLES: Record<Priority, string> = {
  low: 'text-gray-400',
  normal: 'text-gray-300',
  high: 'text-amber-300',
  urgent: 'text-rose-300',
};

/**
 * How a person is shown throughout the memory. Falls back through name, then
 * email, then the raw id — an event must always name somebody, even if the
 * profile behind it has gone.
 */
export function displayName(person: Person | null | undefined, fallback = 'Someone'): string {
  if (!person) return fallback;
  return person.fullName || person.email || fallback;
}

/** '2h 15m' — minutes are how the work is logged, hours are how it is read. */
export function formatMinutes(minutes: number): string {
  if (!minutes) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  if (!m) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Relative time for the feed; absolute dates stay in tooltips. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const units: [number, string][] = [
    [60, 'min'],
    [3600, 'hr'],
    [86400, 'day'],
    [604800, 'week'],
    [2592000, 'month'],
  ];
  for (let i = 0; i < units.length; i += 1) {
    const [limit, label] = units[i];
    if (seconds < limit) {
      const divisor = i === 0 ? 1 : units[i - 1][0];
      const value = Math.round(seconds / divisor);
      return `${value} ${label}${value === 1 ? '' : 's'} ago`;
    }
  }
  return new Date(iso).toLocaleDateString();
}
