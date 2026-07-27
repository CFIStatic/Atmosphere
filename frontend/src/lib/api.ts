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

export interface Org {
  id: string;
  name: string;
  joinCode: string;
  createdAt?: string;
}

export interface Membership {
  role: MemberRole;
  workType: WorkType;
  status: string;
  org: Org | null;
}

export interface OrgMember {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: MemberRole;
  workType: WorkType;
  status: string;
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

/* ==========================================================================
 * Agent Memory
 * ========================================================================== */

export type JobStatus =
  | 'lead'
  | 'scheduled'
  | 'in_progress'
  | 'on_hold'
  | 'complete'
  | 'invoiced'
  | 'closed'
  | 'cancelled';

export type Priority = 'low' | 'normal' | 'high' | 'urgent';
export type LossType = 'water' | 'fire' | 'mold' | 'storm' | 'biohazard' | 'other';
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
  jobNumber: string;
  seqNo: number;
  name: string;
  description: string | null;
  workType: WorkType;
  lossType: LossType | null;
  status: JobStatus;
  priority: Priority;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  claimNumber: string | null;
  leadId: string | null;
  scheduledFor: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** A job as it appears in the list — the row plus its memory rolled up. */
export interface JobSummary {
  jobId: string;
  jobNumber: string;
  name: string;
  status: JobStatus;
  priority: Priority;
  workType: WorkType;
  leadId: string | null;
  taskCount: number;
  tasksDone: number;
  crewSize: number;
  minutesLogged: number;
  eventCount: number;
  lastEvent: string | null;
  lastEventAt: string | null;
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
  job?: { id: string; jobNumber: string; name: string } | null;
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
  name: string;
  workType: WorkType;
  description?: string;
  lossType?: LossType;
  priority?: Priority;
  status?: JobStatus;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  claimNumber?: string;
  leadId?: string | null;
  scheduledFor?: string | null;
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

  createOrg: (name: string, role: MemberRole, workType: WorkType) =>
    request<{ org: Org }>('/api/org', {
      method: 'POST',
      body: JSON.stringify({ name, role, workType }),
    }),

  joinOrg: (joinCode: string, role: MemberRole, workType: WorkType) =>
    request<{ org: Org }>('/api/org/join', {
      method: 'POST',
      body: JSON.stringify({ joinCode, role, workType }),
    }),

  getMembers: () => request<{ members: OrgMember[] }>('/api/org/members', { method: 'GET' }),

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

  getAgents: () => request<{ agents: AgentMemory[] }>('/api/memory/agents', { method: 'GET' }),

  getAgent: (userId: string, before?: number) =>
    request<{
      agent: AgentMemory;
      openTasks: unknown[];
      events: MemoryEvent[];
      nextCursor: number | null;
    }>(`/api/memory/agents/${userId}${before ? `?before=${before}` : ''}`, { method: 'GET' }),

  /** The export streams NDJSON, so it is a plain link rather than a fetch. */
  memoryExportUrl: () => `${API_BASE}/api/memory/export`,
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

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  lead: 'Lead',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  on_hold: 'On hold',
  complete: 'Complete',
  invoiced: 'Invoiced',
  closed: 'Closed',
  cancelled: 'Cancelled',
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
  lead: 'border-sky-400/30 bg-sky-400/10 text-sky-200',
  scheduled: 'border-violet-400/30 bg-violet-400/10 text-violet-200',
  in_progress: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  on_hold: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  complete: 'border-teal-400/30 bg-teal-400/10 text-teal-200',
  invoiced: 'border-blue-400/30 bg-blue-400/10 text-blue-200',
  closed: 'border-white/15 bg-white/5 text-gray-300',
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
