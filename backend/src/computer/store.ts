/**
 * Data access for Computer. The four computer_* tables are service-role
 * only, so this always runs on the admin client. Every read a member can
 * trigger is filtered by org_id; the worker reads by id alone.
 *
 * MemoryComputerStore implements the same contract for tests, including the
 * one-active-task-per-org rule and single-use approvals.
 */
import { randomUUID } from 'node:crypto';
import type { ApprovedOrderSelection } from './supplyOrder.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApprovalField, ComputerTaskStatus, ConsequentialKind, NeedsYouReason, ProjectedJobField } from './types.js';

export interface ComputerTaskRow {
  id: string;
  org_id: string;
  job_id: string | null;
  created_by: string | null;
  instructions: string;
  start_url: string | null;
  job_projection: ProjectedJobField[];
  status: ComputerTaskStatus;
  status_detail: string | null;
  needs_you: {
    reason: NeedsYouReason;
    message: string;
    since: string;
    /** JPEG of the page when Computer got stuck (shown with the handoff message). */
    screenshot_jpeg_b64?: string | null;
  } | null;
  human_control_by: string | null;
  human_control_since: string | null;
  resume_requested_at: string | null;
  cancel_requested_at: string | null;
  session_id: string | null;
  model_id: string;
  step_count: number;
  max_steps: number;
  budget_nanos: number;
  cost_nanos: number;
  last_action: string | null;
  current_url: string | null;
  result_summary: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  heartbeat_at: string | null;
  updated_at: string;
  /** Practice run metadata (null for customer tasks). */
  practice?: PracticeTaskMeta | null;
}

/** A practice task never asks a person, never submits, and records a practice run. */
export interface PracticeTaskMeta {
  runId: string;
  taskKey: string;
  taskType: string;
  mode: 'read_only' | 'stop_before_submit';
  /** Named inputs for the task's playbook slots (for example a search phrase). */
  params?: Record<string, string>;
  /** What must be on the page when the task is done (downloaded: a file must have arrived). */
  success?: { urlIncludes?: string; textIncludes?: string; downloaded?: boolean };
}

export type ApprovalStatus = 'pending' | 'approved' | 'canceled' | 'expired' | 'consumed';

export interface ComputerApprovalRow {
  id: string;
  org_id: string;
  task_id: string;
  status: ApprovalStatus;
  action_kind: ConsequentialKind;
  button_label: string;
  summary: string;
  page_url: string | null;
  page_origin: string | null;
  fields: ApprovalField[];
  screenshot_jpeg_b64: string | null;
  token_hash: string | null;
  requested_at: string;
  expires_at: string;
  decided_by: string | null;
  decided_at: string | null;
  consumed_at: string | null;
  /** Supply orders: the cart lines the person checked (and any quantities they typed). */
  approved_order?: ApprovedOrderSelection | null;
}

export interface ComputerSessionRow {
  id: string;
  org_id: string;
  provider: 'browserbase' | 'mock';
  provider_session_id: string | null;
  provider_context_id: string | null;
  status: 'starting' | 'active' | 'ended' | 'failed';
  started_at: string;
  ended_at: string | null;
  browser_seconds: number | null;
  metered_at: string | null;
  created_at: string;
  /** 'task' = an agent task; 'login' = a person signing in on the Logins page; 'logout' = clearing a removed site. */
  purpose: SessionPurpose;
  login_id: string | null;
  target_url: string | null;
  target_label: string | null;
  started_by: string | null;
}

export type SessionPurpose = 'task' | 'login' | 'logout';

export interface ComputerLoginRow {
  id: string;
  org_id: string;
  label: string;
  url: string;
  host: string;
  cookie_domains: string[];
  created_by: string | null;
  created_at: string;
  last_signed_in_at: string | null;
  last_signed_in_by: string | null;
  updated_at: string;
}

export type NewSession = Pick<ComputerSessionRow, 'org_id' | 'provider' | 'provider_context_id'> &
  Partial<Pick<ComputerSessionRow, 'purpose' | 'login_id' | 'target_url' | 'target_label' | 'started_by'>>;

export interface SavedLogin {
  org_id: string;
  label: string;
  url: string;
  host: string;
  cookie_domains: string[];
  user_id: string | null;
  at: string;
  /** false: list the site (e.g. a password was saved first) without marking it signed in. */
  signed_in?: boolean;
}

/** A saved sign-in. The username and password are sealed (credentialCrypto.ts); never plaintext. */
export interface ComputerCredentialRow {
  login_id: string;
  org_id: string;
  username_sealed: string;
  password_sealed: string;
  key_fingerprint: string;
  login_url: string | null;
  status: 'ok' | 'needs_attention';
  attention_reason: string | null;
  last_used_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export type NewCredential = Pick<
  ComputerCredentialRow,
  'login_id' | 'org_id' | 'username_sealed' | 'password_sealed' | 'key_fingerprint' | 'login_url'
> & { user_id: string | null; at: string };

export type CredentialPatch = Partial<Pick<ComputerCredentialRow, 'status' | 'attention_reason' | 'last_used_at'>>;

export interface ComputerAuditRow {
  id: number;
  org_id: string;
  task_id: string | null;
  session_id: string | null;
  job_id: string | null;
  actor_kind: 'agent' | 'user' | 'system';
  actor_user_id: string | null;
  event: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export type NewTask = Pick<
  ComputerTaskRow,
  'org_id' | 'job_id' | 'created_by' | 'instructions' | 'start_url' | 'job_projection' | 'model_id' | 'max_steps' | 'budget_nanos'
> &
  Partial<Pick<ComputerTaskRow, 'practice'>>;

export type NewApproval = Pick<
  ComputerApprovalRow,
  | 'org_id'
  | 'task_id'
  | 'action_kind'
  | 'button_label'
  | 'summary'
  | 'page_url'
  | 'page_origin'
  | 'fields'
  | 'screenshot_jpeg_b64'
  | 'token_hash'
  | 'expires_at'
>;

export type NewAudit = Omit<ComputerAuditRow, 'id' | 'created_at' | 'session_id' | 'job_id' | 'actor_user_id' | 'detail'> & {
  session_id?: string | null;
  job_id?: string | null;
  actor_user_id?: string | null;
  detail?: Record<string, unknown>;
};

export interface ComputerStore {
  insertTask(row: NewTask): Promise<ComputerTaskRow>;
  /** orgId null = worker read by id. */
  getTask(orgId: string | null, id: string): Promise<ComputerTaskRow | null>;
  updateTask(id: string, patch: Partial<ComputerTaskRow>): Promise<void>;
  /** Conditional update; false when the row was not in one of `from` (or a unique rule blocked it). */
  transitionTask(id: string, from: readonly ComputerTaskStatus[], patch: Partial<ComputerTaskRow>): Promise<boolean>;
  listQueuedTasks(limit: number): Promise<ComputerTaskRow[]>;
  listStaleActiveTasks(olderThanIso: string): Promise<ComputerTaskRow[]>;
  latestContextId(orgId: string, provider: string): Promise<string | null>;
  insertSession(row: NewSession): Promise<ComputerSessionRow>;
  updateSession(id: string, patch: Partial<ComputerSessionRow>): Promise<void>;
  /** Close out sessions an earlier crash left open; returns their provider ids. */
  closeLiveSessions(orgId: string): Promise<string[]>;
  getSession(id: string): Promise<ComputerSessionRow | null>;
  /** The org's live (starting/active) session, if any. */
  liveSession(orgId: string): Promise<ComputerSessionRow | null>;
  /** The org's task in running / awaiting_approval / needs_you, if any. */
  activeTask(orgId: string): Promise<ComputerTaskRow | null>;
  listLogins(orgId: string): Promise<ComputerLoginRow[]>;
  getLogin(orgId: string, id: string): Promise<ComputerLoginRow | null>;
  /** Insert or update the org's entry for this host (cookie domains are merged). */
  saveLogin(row: SavedLogin): Promise<ComputerLoginRow>;
  deleteLogin(orgId: string, id: string): Promise<boolean>;
  listCredentials(orgId: string): Promise<ComputerCredentialRow[]>;
  getCredential(orgId: string, loginId: string): Promise<ComputerCredentialRow | null>;
  /** Save or replace the site's sign-in; status goes back to ok. */
  putCredential(row: NewCredential): Promise<ComputerCredentialRow>;
  updateCredential(orgId: string, loginId: string, patch: CredentialPatch): Promise<void>;
  deleteCredential(orgId: string, loginId: string): Promise<boolean>;
  insertApproval(row: NewApproval): Promise<ComputerApprovalRow>;
  getApproval(orgId: string | null, id: string): Promise<ComputerApprovalRow | null>;
  latestApproval(taskId: string): Promise<ComputerApprovalRow | null>;
  /** Approvals for one task, newest first (idempotency / Sent Items gate). */
  listApprovalsForTask(taskId: string, limit?: number): Promise<ComputerApprovalRow[]>;
  /** pending → approved / canceled by a person. */
  decideApproval(
    id: string,
    to: 'approved' | 'canceled',
    userId: string | null,
    extra?: { approved_order?: ApprovedOrderSelection | null },
  ): Promise<boolean>;
  /** approved → consumed, only with the matching token hash and before expiry. */
  consumeApproval(id: string, tokenHash: string, nowIso: string): Promise<boolean>;
  expireApproval(id: string): Promise<void>;
  appendAudit(row: NewAudit): Promise<void>;
  listAudit(taskId: string, limit: number): Promise<ComputerAuditRow[]>;
}

const nowIso = () => new Date().toISOString();

const ACTIVE: readonly ComputerTaskStatus[] = ['running', 'awaiting_approval', 'needs_you'];

/** The org already has a live browser session (the one-per-org rule). */
export class SessionBusyError extends Error {
  constructor() {
    super('Computer is already using the browser for this account.');
    this.name = 'SessionBusyError';
  }
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === '23505');
}

export class SupabaseComputerStore implements ComputerStore {
  constructor(private readonly db: SupabaseClient) {}

  async insertTask(row: NewTask) {
    const { data, error } = await this.db.from('computer_tasks').insert(row).select('*').single();
    if (error) throw error;
    return data as ComputerTaskRow;
  }

  async getTask(orgId: string | null, id: string) {
    let q = this.db.from('computer_tasks').select('*').eq('id', id);
    if (orgId) q = q.eq('org_id', orgId);
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    return (data as ComputerTaskRow | null) ?? null;
  }

  async updateTask(id: string, patch: Partial<ComputerTaskRow>) {
    const { error } = await this.db.from('computer_tasks').update({ ...patch, updated_at: nowIso() }).eq('id', id);
    if (error) throw error;
  }

  async transitionTask(id: string, from: readonly ComputerTaskStatus[], patch: Partial<ComputerTaskRow>) {
    const { data, error } = await this.db
      .from('computer_tasks')
      .update({ ...patch, updated_at: nowIso() })
      .eq('id', id)
      .in('status', [...from])
      .select('id');
    if (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
    return Array.isArray(data) && data.length > 0;
  }

  async listQueuedTasks(limit: number) {
    const { data, error } = await this.db
      .from('computer_tasks')
      .select('*')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as ComputerTaskRow[];
  }

  async listStaleActiveTasks(olderThanIso: string) {
    const { data, error } = await this.db
      .from('computer_tasks')
      .select('*')
      .in('status', ['running', 'awaiting_approval', 'needs_you'])
      .lt('heartbeat_at', olderThanIso)
      .limit(50);
    if (error) throw error;
    return (data ?? []) as ComputerTaskRow[];
  }

  async latestContextId(orgId: string, provider: string) {
    const { data, error } = await this.db
      .from('computer_sessions')
      .select('provider_context_id')
      .eq('org_id', orgId)
      .eq('provider', provider)
      .not('provider_context_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    const row = (data ?? [])[0] as { provider_context_id?: string | null } | undefined;
    return row?.provider_context_id ?? null;
  }

  async insertSession(row: NewSession) {
    const { data, error } = await this.db.from('computer_sessions').insert(row).select('*').single();
    if (error) {
      if (isUniqueViolation(error)) throw new SessionBusyError();
      throw error;
    }
    return data as ComputerSessionRow;
  }

  async updateSession(id: string, patch: Partial<ComputerSessionRow>) {
    const { error } = await this.db.from('computer_sessions').update(patch).eq('id', id);
    if (error) throw error;
  }

  async closeLiveSessions(orgId: string) {
    const { data, error } = await this.db
      .from('computer_sessions')
      .update({ status: 'failed', ended_at: nowIso() })
      .eq('org_id', orgId)
      .in('status', ['starting', 'active'])
      .select('provider_session_id');
    if (error) throw error;
    return ((data ?? []) as Array<{ provider_session_id: string | null }>)
      .map((r) => r.provider_session_id)
      .filter((v): v is string => Boolean(v));
  }

  async getSession(id: string) {
    const { data, error } = await this.db.from('computer_sessions').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return (data as ComputerSessionRow | null) ?? null;
  }

  async liveSession(orgId: string) {
    const { data, error } = await this.db
      .from('computer_sessions')
      .select('*')
      .eq('org_id', orgId)
      .in('status', ['starting', 'active'])
      .limit(1);
    if (error) throw error;
    return ((data ?? [])[0] as ComputerSessionRow | undefined) ?? null;
  }

  async activeTask(orgId: string) {
    const { data, error } = await this.db
      .from('computer_tasks')
      .select('*')
      .eq('org_id', orgId)
      .in('status', [...ACTIVE])
      .limit(1);
    if (error) throw error;
    return ((data ?? [])[0] as ComputerTaskRow | undefined) ?? null;
  }

  async listLogins(orgId: string) {
    const { data, error } = await this.db
      .from('computer_logins')
      .select('*')
      .eq('org_id', orgId)
      .order('label', { ascending: true })
      .limit(200);
    if (error) throw error;
    return (data ?? []) as ComputerLoginRow[];
  }

  async getLogin(orgId: string, id: string) {
    const { data, error } = await this.db.from('computer_logins').select('*').eq('org_id', orgId).eq('id', id).maybeSingle();
    if (error) throw error;
    return (data as ComputerLoginRow | null) ?? null;
  }

  async saveLogin(row: SavedLogin) {
    const { data: existing, error: readError } = await this.db
      .from('computer_logins')
      .select('*')
      .eq('org_id', row.org_id)
      .eq('host', row.host)
      .limit(1);
    if (readError) throw readError;
    const prev = (existing ?? [])[0] as ComputerLoginRow | undefined;
    const patch = {
      label: row.label,
      url: row.url,
      cookie_domains: [...new Set([...(prev?.cookie_domains ?? []), ...row.cookie_domains])].sort(),
      ...(row.signed_in === false ? {} : { last_signed_in_at: row.at, last_signed_in_by: row.user_id }),
      updated_at: row.at,
    };
    if (prev) {
      const { data, error } = await this.db.from('computer_logins').update(patch).eq('id', prev.id).select('*').single();
      if (error) throw error;
      return data as ComputerLoginRow;
    }
    const { data, error } = await this.db
      .from('computer_logins')
      .insert({ ...patch, org_id: row.org_id, host: row.host, created_by: row.user_id })
      .select('*')
      .single();
    if (error) throw error;
    return data as ComputerLoginRow;
  }

  async deleteLogin(orgId: string, id: string) {
    const { data, error } = await this.db.from('computer_logins').delete().eq('org_id', orgId).eq('id', id).select('id');
    if (error) throw error;
    return Array.isArray(data) && data.length > 0;
  }

  async listCredentials(orgId: string) {
    const { data, error } = await this.db.from('computer_login_credentials').select('*').eq('org_id', orgId).limit(200);
    if (error) throw error;
    return (data ?? []) as ComputerCredentialRow[];
  }

  async getCredential(orgId: string, loginId: string) {
    const { data, error } = await this.db
      .from('computer_login_credentials')
      .select('*')
      .eq('org_id', orgId)
      .eq('login_id', loginId)
      .maybeSingle();
    if (error) throw error;
    return (data as ComputerCredentialRow | null) ?? null;
  }

  async putCredential(row: NewCredential) {
    const { user_id, at, ...rest } = row;
    const prev = await this.getCredential(row.org_id, row.login_id);
    const values = {
      ...rest,
      status: 'ok' as const,
      attention_reason: null,
      updated_by: user_id,
      updated_at: at,
      ...(prev ? {} : { created_by: user_id, created_at: at }),
    };
    const { data, error } = await this.db
      .from('computer_login_credentials')
      .upsert(values, { onConflict: 'login_id' })
      .select('*')
      .single();
    if (error) throw error;
    return data as ComputerCredentialRow;
  }

  async updateCredential(orgId: string, loginId: string, patch: CredentialPatch) {
    const { error } = await this.db
      .from('computer_login_credentials')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('org_id', orgId)
      .eq('login_id', loginId);
    if (error) throw error;
  }

  async deleteCredential(orgId: string, loginId: string) {
    const { data, error } = await this.db
      .from('computer_login_credentials')
      .delete()
      .eq('org_id', orgId)
      .eq('login_id', loginId)
      .select('login_id');
    if (error) throw error;
    return Array.isArray(data) && data.length > 0;
  }

  async insertApproval(row: NewApproval) {
    const { data, error } = await this.db.from('computer_approvals').insert(row).select('*').single();
    if (error) throw error;
    return data as ComputerApprovalRow;
  }

  async getApproval(orgId: string | null, id: string) {
    let q = this.db.from('computer_approvals').select('*').eq('id', id);
    if (orgId) q = q.eq('org_id', orgId);
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    return (data as ComputerApprovalRow | null) ?? null;
  }

  async latestApproval(taskId: string) {
    const { data, error } = await this.db
      .from('computer_approvals')
      .select('*')
      .eq('task_id', taskId)
      .order('requested_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    return ((data ?? [])[0] as ComputerApprovalRow | undefined) ?? null;
  }

  async listApprovalsForTask(taskId: string, limit = 40) {
    const { data, error } = await this.db
      .from('computer_approvals')
      .select('*')
      .eq('task_id', taskId)
      .order('requested_at', { ascending: false })
      .limit(Math.max(1, Math.min(limit, 100)));
    if (error) throw error;
    return (data as ComputerApprovalRow[]) ?? [];
  }

  async decideApproval(
    id: string,
    to: 'approved' | 'canceled',
    userId: string | null,
    extra?: { approved_order?: ApprovedOrderSelection | null },
  ) {
    const patch: Record<string, unknown> = { status: to, decided_by: userId, decided_at: nowIso() };
    if (extra?.approved_order) patch.approved_order = extra.approved_order;
    const { data, error } = await this.db
      .from('computer_approvals')
      .update(patch)
      .eq('id', id)
      .eq('status', 'pending')
      .gt('expires_at', nowIso())
      .select('id');
    if (error) throw error;
    return Array.isArray(data) && data.length > 0;
  }

  async consumeApproval(id: string, tokenHash: string, at: string) {
    const { data, error } = await this.db
      .from('computer_approvals')
      .update({ status: 'consumed', consumed_at: at })
      .eq('id', id)
      .eq('status', 'approved')
      .eq('token_hash', tokenHash)
      .is('consumed_at', null)
      .gt('expires_at', at)
      .select('id');
    if (error) throw error;
    return Array.isArray(data) && data.length > 0;
  }

  async expireApproval(id: string) {
    const { error } = await this.db
      .from('computer_approvals')
      .update({ status: 'expired' })
      .eq('id', id)
      .in('status', ['pending', 'approved']);
    if (error) throw error;
  }

  async appendAudit(row: NewAudit) {
    const { error } = await this.db.from('computer_audit_events').insert({ detail: {}, ...row });
    if (error) throw error;
  }

  async listAudit(taskId: string, limit: number) {
    const { data, error } = await this.db
      .from('computer_audit_events')
      .select('*')
      .eq('task_id', taskId)
      .order('id', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as ComputerAuditRow[]).reverse();
  }
}


export class MemoryComputerStore implements ComputerStore {
  tasks = new Map<string, ComputerTaskRow>();
  approvals = new Map<string, ComputerApprovalRow>();
  sessions = new Map<string, ComputerSessionRow>();
  logins = new Map<string, ComputerLoginRow>();
  credentials = new Map<string, ComputerCredentialRow>();
  audit: ComputerAuditRow[] = [];
  private seq = 0;

  async insertTask(row: NewTask) {
    const at = nowIso();
    const task: ComputerTaskRow = {
      id: randomUUID(),
      status: 'queued',
      status_detail: null,
      needs_you: null,
      human_control_by: null,
      human_control_since: null,
      resume_requested_at: null,
      cancel_requested_at: null,
      session_id: null,
      step_count: 0,
      cost_nanos: 0,
      last_action: null,
      current_url: null,
      result_summary: null,
      error: null,
      created_at: at,
      started_at: null,
      finished_at: null,
      heartbeat_at: null,
      updated_at: at,
      ...row,
    };
    this.tasks.set(task.id, task);
    return { ...task };
  }

  async getTask(orgId: string | null, id: string) {
    const t = this.tasks.get(id);
    if (!t || (orgId && t.org_id !== orgId)) return null;
    return { ...t };
  }

  async updateTask(id: string, patch: Partial<ComputerTaskRow>) {
    const t = this.tasks.get(id);
    if (t) this.tasks.set(id, { ...t, ...patch, updated_at: nowIso() });
  }

  async transitionTask(id: string, from: readonly ComputerTaskStatus[], patch: Partial<ComputerTaskRow>) {
    const t = this.tasks.get(id);
    if (!t || !from.includes(t.status)) return false;
    const next = { ...t, ...patch, updated_at: nowIso() };
    if (ACTIVE.includes(next.status)) {
      for (const other of this.tasks.values()) {
        if (other.id !== id && other.org_id === t.org_id && ACTIVE.includes(other.status)) return false;
      }
    }
    this.tasks.set(id, next);
    return true;
  }

  async listQueuedTasks(limit: number) {
    return [...this.tasks.values()]
      .filter((t) => t.status === 'queued')
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(0, limit)
      .map((t) => ({ ...t }));
  }

  async listStaleActiveTasks(olderThanIso: string) {
    return [...this.tasks.values()].filter(
      (t) => ACTIVE.includes(t.status) && t.heartbeat_at !== null && t.heartbeat_at < olderThanIso,
    );
  }

  async latestContextId(orgId: string, provider: string) {
    const rows = [...this.sessions.values()]
      .filter((s) => s.org_id === orgId && s.provider === provider && s.provider_context_id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return rows[0]?.provider_context_id ?? null;
  }

  async insertSession(row: NewSession) {
    for (const other of this.sessions.values()) {
      if (other.org_id === row.org_id && (other.status === 'starting' || other.status === 'active')) throw new SessionBusyError();
    }
    const at = nowIso();
    const s: ComputerSessionRow = {
      id: randomUUID(),
      provider_session_id: null,
      status: 'starting',
      started_at: at,
      ended_at: null,
      browser_seconds: null,
      metered_at: null,
      created_at: at,
      purpose: 'task',
      login_id: null,
      target_url: null,
      target_label: null,
      started_by: null,
      ...row,
    };
    this.sessions.set(s.id, s);
    return { ...s };
  }

  async updateSession(id: string, patch: Partial<ComputerSessionRow>) {
    const s = this.sessions.get(id);
    if (s) this.sessions.set(id, { ...s, ...patch });
  }

  async closeLiveSessions(orgId: string) {
    const ids: string[] = [];
    for (const s of this.sessions.values()) {
      if (s.org_id === orgId && (s.status === 'starting' || s.status === 'active')) {
        this.sessions.set(s.id, { ...s, status: 'failed', ended_at: nowIso() });
        if (s.provider_session_id) ids.push(s.provider_session_id);
      }
    }
    return ids;
  }

  async getSession(id: string) {
    const s = this.sessions.get(id);
    return s ? { ...s } : null;
  }
  async liveSession(orgId: string) {
    const s = [...this.sessions.values()].find((x) => x.org_id === orgId && (x.status === 'starting' || x.status === 'active'));
    return s ? { ...s } : null;
  }

  async activeTask(orgId: string) {
    const t = [...this.tasks.values()].find((x) => x.org_id === orgId && ACTIVE.includes(x.status));
    return t ? { ...t } : null;
  }

  async listLogins(orgId: string) {
    return [...this.logins.values()]
      .filter((l) => l.org_id === orgId)
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((l) => ({ ...l, cookie_domains: [...l.cookie_domains] }));
  }

  async getLogin(orgId: string, id: string) {
    const l = this.logins.get(id);
    return l && l.org_id === orgId ? { ...l, cookie_domains: [...l.cookie_domains] } : null;
  }

  async saveLogin(row: SavedLogin) {
    const prev = [...this.logins.values()].find((l) => l.org_id === row.org_id && l.host === row.host);
    const next: ComputerLoginRow = {
      id: prev?.id ?? randomUUID(),
      org_id: row.org_id,
      host: row.host,
      created_by: prev ? prev.created_by : row.user_id,
      created_at: prev?.created_at ?? row.at,
      label: row.label,
      url: row.url,
      cookie_domains: [...new Set([...(prev?.cookie_domains ?? []), ...row.cookie_domains])].sort(),
      last_signed_in_at: row.signed_in === false ? (prev?.last_signed_in_at ?? null) : row.at,
      last_signed_in_by: row.signed_in === false ? (prev?.last_signed_in_by ?? null) : row.user_id,
      updated_at: row.at,
    };
    this.logins.set(next.id, next);
    return { ...next };
  }

  async deleteLogin(orgId: string, id: string) {
    const l = this.logins.get(id);
    if (!l || l.org_id !== orgId) return false;
    this.logins.delete(id);
    this.credentials.delete(id); // on delete cascade
    return true;
  }

  async listCredentials(orgId: string) {
    return [...this.credentials.values()].filter((c) => c.org_id === orgId).map((c) => ({ ...c }));
  }

  async getCredential(orgId: string, loginId: string) {
    const c = this.credentials.get(loginId);
    return c && c.org_id === orgId ? { ...c } : null;
  }

  async putCredential(row: NewCredential) {
    const { user_id, at, ...rest } = row;
    const prev = this.credentials.get(row.login_id);
    const next: ComputerCredentialRow = {
      ...rest,
      status: 'ok',
      attention_reason: null,
      last_used_at: prev?.last_used_at ?? null,
      created_by: prev ? prev.created_by : user_id,
      created_at: prev?.created_at ?? at,
      updated_by: user_id,
      updated_at: at,
    };
    this.credentials.set(row.login_id, next);
    return { ...next };
  }

  async updateCredential(orgId: string, loginId: string, patch: CredentialPatch) {
    const c = this.credentials.get(loginId);
    if (c && c.org_id === orgId) this.credentials.set(loginId, { ...c, ...patch, updated_at: new Date().toISOString() });
  }

  async deleteCredential(orgId: string, loginId: string) {
    const c = this.credentials.get(loginId);
    if (!c || c.org_id !== orgId) return false;
    this.credentials.delete(loginId);
    return true;
  }


  async insertApproval(row: NewApproval) {
    const a: ComputerApprovalRow = {
      id: randomUUID(),
      status: 'pending',
      requested_at: nowIso(),
      decided_by: null,
      decided_at: null,
      consumed_at: null,
      ...row,
    };
    this.approvals.set(a.id, a);
    return { ...a };
  }

  async getApproval(orgId: string | null, id: string) {
    const a = this.approvals.get(id);
    if (!a || (orgId && a.org_id !== orgId)) return null;
    return { ...a };
  }

  async latestApproval(taskId: string) {
    const rows = [...this.approvals.values()]
      .filter((a) => a.task_id === taskId)
      .sort((a, b) => b.requested_at.localeCompare(a.requested_at));
    return rows[0] ? { ...rows[0] } : null;
  }

  async listApprovalsForTask(taskId: string, limit = 40) {
    return [...this.approvals.values()]
      .filter((a) => a.task_id === taskId)
      .sort((a, b) => b.requested_at.localeCompare(a.requested_at))
      .slice(0, Math.max(1, Math.min(limit, 100)))
      .map((a) => ({ ...a }));
  }

  async decideApproval(
    id: string,
    to: 'approved' | 'canceled',
    userId: string | null,
    extra?: { approved_order?: ApprovedOrderSelection | null },
  ) {
    const a = this.approvals.get(id);
    if (!a || a.status !== 'pending' || a.expires_at <= nowIso()) return false;
    this.approvals.set(id, {
      ...a,
      status: to,
      decided_by: userId,
      decided_at: nowIso(),
      ...(extra?.approved_order ? { approved_order: extra.approved_order } : {}),
    });
    return true;
  }

  async consumeApproval(id: string, tokenHash: string, at: string) {
    const a = this.approvals.get(id);
    if (!a || a.status !== 'approved' || a.token_hash !== tokenHash || a.consumed_at || a.expires_at <= at) return false;
    this.approvals.set(id, { ...a, status: 'consumed', consumed_at: at });
    return true;
  }

  async expireApproval(id: string) {
    const a = this.approvals.get(id);
    if (a && (a.status === 'pending' || a.status === 'approved')) this.approvals.set(id, { ...a, status: 'expired' });
  }

  async appendAudit(row: NewAudit) {
    this.seq += 1;
    this.audit.push({
      id: this.seq,
      created_at: nowIso(),
      session_id: null,
      job_id: null,
      actor_user_id: null,
      detail: {},
      ...row,
    });
  }

  async listAudit(taskId: string, limit: number) {
    return this.audit.filter((a) => a.task_id === taskId).slice(-limit);
  }
}
