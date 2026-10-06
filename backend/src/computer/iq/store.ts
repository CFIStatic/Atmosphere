/**
 * Storage for Computer IQ: practice runs and their screens, replayable
 * playbook steps and versions, playbook drafts, and per-step model routing.
 * All writes use the service role; staff read through the internal API.
 */
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { assertNoPii } from '../sitePlaybooks.js';
import { parseSteps, sameSteps, type PlaybookStep } from './playbookSteps.js';

export type PracticeMode = 'read_only' | 'stop_before_submit';
export type PracticeStatus = 'running' | 'succeeded' | 'failed' | 'needs_login' | 'skipped';
export type PlaybookSource = 'success' | 'demonstration' | 'handoff';
export type RouteKind = 'fast' | 'strong' | 'verify' | 'fallback' | 'replay';

export interface PracticeStepLog {
  index: number;
  label: string;
  ok: boolean;
  via: 'playbook' | 'model' | 'system';
  note?: string;
}

export interface PracticeRunRow {
  id: string;
  org_id: string;
  run_date: string;
  site: string;
  task_key: string;
  task_type: string;
  mode: PracticeMode;
  status: PracticeStatus;
  failed_step: number | null;
  failure_reason: string | null;
  steps: PracticeStepLog[];
  task_id: string | null;
  playbook_id: string | null;
  playbook_version: number | null;
  used_playbook: boolean;
  model_calls: number;
  cost_nanos: number;
  duration_ms: number | null;
  started_at: string;
  finished_at: string | null;
  created_at: string;
}

export interface PracticeScreenRow {
  id: number;
  run_id: string;
  step_index: number;
  label: string;
  jpeg_b64: string;
  created_at: string;
}

export interface PlaybookRecord {
  id: string;
  site: string;
  task_type: string;
  version: number;
  steps: PlaybookStep[];
  status: 'active' | 'retired';
  source: PlaybookSource;
  success_count: number;
  replay_success_count: number;
  failure_count: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  updated_at: string;
}

export interface PlaybookDraftRow {
  id: string;
  org_id: string;
  task_id: string | null;
  site: string;
  task_type: string;
  source: 'demonstration' | 'handoff';
  steps: PlaybookStep[];
  step_count: number;
  status: 'pending' | 'approved' | 'rejected';
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  playbook_id: string | null;
  created_at: string;
}

export interface RouteDecisionRow {
  org_id: string | null;
  task_id: string | null;
  step: number;
  route: RouteKind;
  model: string;
  reason: string;
}

export interface IqStore {
  loadPlaybook(site: string, taskType: string): Promise<PlaybookRecord | null>;
  listPlaybooks(site?: string): Promise<PlaybookRecord[]>;
  /** Same steps → success_count+1. Changed steps → version+1 with the new steps. */
  savePlaybookSteps(input: { site: string; taskType: string; steps: PlaybookStep[]; source: PlaybookSource }): Promise<{ id: string; version: number; changed: boolean }>;
  recordPlaybookReplay(id: string, ok: boolean): Promise<void>;
  insertDraft(row: Omit<PlaybookDraftRow, 'id' | 'status' | 'review_note' | 'reviewed_by' | 'reviewed_at' | 'playbook_id' | 'created_at' | 'step_count'>): Promise<PlaybookDraftRow>;
  listDrafts(status?: PlaybookDraftRow['status'], limit?: number): Promise<PlaybookDraftRow[]>;
  getDraft(id: string): Promise<PlaybookDraftRow | null>;
  /** Conditional on status = pending; false when someone already decided it. */
  decideDraft(id: string, patch: { status: 'approved' | 'rejected'; reviewed_by: string | null; review_note: string | null; playbook_id: string | null }): Promise<boolean>;
  /** Null when today's run for this task already exists (another replica claimed it). */
  claimPracticeRun(row: Pick<PracticeRunRow, 'org_id' | 'run_date' | 'site' | 'task_key' | 'task_type' | 'mode'>): Promise<PracticeRunRow | null>;
  updatePracticeRun(id: string, patch: Partial<PracticeRunRow>): Promise<void>;
  deletePracticeRun(id: string): Promise<void>;
  getPracticeRun(id: string): Promise<PracticeRunRow | null>;
  listPracticeRuns(sinceDate: string, limit?: number): Promise<PracticeRunRow[]>;
  insertPracticeScreen(row: Pick<PracticeScreenRow, 'run_id' | 'step_index' | 'label' | 'jpeg_b64'>): Promise<void>;
  listPracticeScreens(runId: string): Promise<PracticeScreenRow[]>;
  logRoute(row: RouteDecisionRow): Promise<void>;
  listRoutes(taskId: string): Promise<RouteDecisionRow[]>;
}

const MAX_SCREEN_B64 = 600_000;
const nowIso = () => new Date().toISOString();
const normSite = (s: string) => s.trim().toLowerCase();
const normType = (s: string) => s.trim().toLowerCase() || 'general';

function toPlaybook(r: Record<string, unknown>): PlaybookRecord {
  return {
    id: String(r.id),
    site: String(r.site),
    task_type: String(r.task_type),
    version: Number(r.version) || 1,
    steps: parseSteps(r.steps),
    status: r.status === 'retired' ? 'retired' : 'active',
    source: (['success', 'demonstration', 'handoff'].includes(String(r.source)) ? r.source : 'success') as PlaybookSource,
    success_count: Number(r.success_count) || 0,
    replay_success_count: Number(r.replay_success_count) || 0,
    failure_count: Number(r.failure_count) || 0,
    last_success_at: (r.last_success_at as string | null) ?? null,
    last_failure_at: (r.last_failure_at as string | null) ?? null,
    updated_at: String(r.updated_at ?? nowIso()),
  };
}

function toDraft(r: Record<string, unknown>): PlaybookDraftRow {
  return { ...(r as unknown as PlaybookDraftRow), steps: parseSteps(r.steps) };
}

function clipScreen(b64: string): string | null {
  return b64 && b64.length <= MAX_SCREEN_B64 ? b64 : null;
}

const PLAYBOOK_COLUMNS =
  'id, site, task_type, version, steps, status, source, success_count, replay_success_count, failure_count, last_success_at, last_failure_at, updated_at';

export class SupabaseIqStore implements IqStore {
  constructor(private readonly db: SupabaseClient) {}

  async loadPlaybook(site: string, taskType: string) {
    const { data, error } = await this.db
      .from('computer_site_playbooks')
      .select(PLAYBOOK_COLUMNS)
      .eq('site', normSite(site))
      .eq('task_type', normType(taskType))
      .maybeSingle();
    if (error) throw error;
    return data ? toPlaybook(data) : null;
  }

  async listPlaybooks(site?: string) {
    let q = this.db.from('computer_site_playbooks').select(PLAYBOOK_COLUMNS).order('updated_at', { ascending: false }).limit(200);
    if (site) q = q.eq('site', normSite(site));
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(toPlaybook);
  }

  async savePlaybookSteps(input: { site: string; taskType: string; steps: PlaybookStep[]; source: PlaybookSource }) {
    assertNoPii(input.steps, 'steps');
    const existing = await this.loadPlaybook(input.site, input.taskType);
    const at = nowIso();
    if (existing) {
      const changed = !sameSteps(existing.steps, input.steps);
      const patch: Record<string, unknown> = changed
        ? { steps: input.steps, version: existing.version + (existing.steps.length ? 1 : 0), source: input.source, status: 'active', updated_at: at }
        : { success_count: existing.success_count + 1, last_success_at: at, updated_at: at };
      if (changed && input.source === 'success') {
        patch.success_count = existing.success_count + 1;
        patch.last_success_at = at;
      }
      const { error } = await this.db.from('computer_site_playbooks').update(patch).eq('id', existing.id);
      if (error) throw error;
      return { id: existing.id, version: Number(patch.version ?? existing.version), changed };
    }
    const { data, error } = await this.db
      .from('computer_site_playbooks')
      .insert({
        site: normSite(input.site),
        task_type: normType(input.taskType),
        steps: input.steps,
        source: input.source,
        version: 1,
        success_count: input.source === 'success' ? 1 : 0,
        last_success_at: input.source === 'success' ? at : null,
      })
      .select('id')
      .single();
    if (error) throw error;
    return { id: String(data.id), version: 1, changed: true };
  }

  async recordPlaybookReplay(id: string, ok: boolean) {
    const { data } = await this.db.from('computer_site_playbooks').select('replay_success_count, failure_count').eq('id', id).maybeSingle();
    if (!data) return;
    const patch = ok
      ? { replay_success_count: (Number(data.replay_success_count) || 0) + 1, last_success_at: nowIso() }
      : { failure_count: (Number(data.failure_count) || 0) + 1, last_failure_at: nowIso() };
    const { error } = await this.db.from('computer_site_playbooks').update(patch).eq('id', id);
    if (error) throw error;
  }

  async insertDraft(row: Parameters<IqStore['insertDraft']>[0]) {
    assertNoPii(row.steps, 'steps');
    const { data, error } = await this.db
      .from('computer_playbook_drafts')
      .insert({ ...row, site: normSite(row.site), task_type: normType(row.task_type), step_count: row.steps.length })
      .select('*')
      .single();
    if (error) throw error;
    return toDraft(data);
  }

  async listDrafts(status?: PlaybookDraftRow['status'], limit = 50) {
    let q = this.db.from('computer_playbook_drafts').select('*').order('created_at', { ascending: false }).limit(limit);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(toDraft);
  }

  async getDraft(id: string) {
    const { data, error } = await this.db.from('computer_playbook_drafts').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? toDraft(data) : null;
  }

  async decideDraft(id: string, patch: Parameters<IqStore['decideDraft']>[1]) {
    const { data, error } = await this.db
      .from('computer_playbook_drafts')
      .update({ ...patch, reviewed_at: nowIso() })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id');
    if (error) throw error;
    return Boolean(data?.length);
  }

  async claimPracticeRun(row: Parameters<IqStore['claimPracticeRun']>[0]) {
    const { data, error } = await this.db.from('computer_practice_runs').insert({ ...row, status: 'running' }).select('*').single();
    if (error) {
      if ((error as { code?: string }).code === '23505') return null;
      throw error;
    }
    return data as PracticeRunRow;
  }

  async updatePracticeRun(id: string, patch: Partial<PracticeRunRow>) {
    const { error } = await this.db.from('computer_practice_runs').update(patch).eq('id', id);
    if (error) throw error;
  }

  async deletePracticeRun(id: string) {
    const { error } = await this.db.from('computer_practice_runs').delete().eq('id', id);
    if (error) throw error;
  }

  async getPracticeRun(id: string) {
    const { data, error } = await this.db.from('computer_practice_runs').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return (data as PracticeRunRow | null) ?? null;
  }

  async listPracticeRuns(sinceDate: string, limit = 2000) {
    const { data, error } = await this.db
      .from('computer_practice_runs')
      .select('*')
      .gte('run_date', sinceDate)
      .order('started_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as PracticeRunRow[];
  }

  async insertPracticeScreen(row: Parameters<IqStore['insertPracticeScreen']>[0]) {
    const jpeg = clipScreen(row.jpeg_b64);
    if (!jpeg) return;
    const { error } = await this.db.from('computer_practice_screens').insert({ ...row, label: row.label.slice(0, 200) || 'Screen', jpeg_b64: jpeg });
    if (error) throw error;
  }

  async listPracticeScreens(runId: string) {
    const { data, error } = await this.db
      .from('computer_practice_screens')
      .select('*')
      .eq('run_id', runId)
      .order('step_index', { ascending: true })
      .order('id', { ascending: true });
    if (error) throw error;
    return (data ?? []) as PracticeScreenRow[];
  }

  async logRoute(row: RouteDecisionRow) {
    const { error } = await this.db.from('computer_route_decisions').insert({ ...row, reason: row.reason.slice(0, 200), model: row.model.slice(0, 120) });
    if (error) throw error;
  }

  async listRoutes(taskId: string) {
    const { data, error } = await this.db
      .from('computer_route_decisions')
      .select('org_id, task_id, step, route, model, reason')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as RouteDecisionRow[];
  }
}

export class MemoryIqStore implements IqStore {
  playbooks = new Map<string, PlaybookRecord>();
  drafts = new Map<string, PlaybookDraftRow>();
  runs = new Map<string, PracticeRunRow>();
  screens: PracticeScreenRow[] = [];
  routes: RouteDecisionRow[] = [];

  async loadPlaybook(site: string, taskType: string) {
    return [...this.playbooks.values()].find((p) => p.site === normSite(site) && p.task_type === normType(taskType)) ?? null;
  }

  async listPlaybooks(site?: string) {
    return [...this.playbooks.values()].filter((p) => !site || p.site === normSite(site));
  }

  async savePlaybookSteps(input: { site: string; taskType: string; steps: PlaybookStep[]; source: PlaybookSource }) {
    assertNoPii(input.steps, 'steps');
    const at = nowIso();
    const existing = await this.loadPlaybook(input.site, input.taskType);
    if (existing) {
      const changed = !sameSteps(existing.steps, input.steps);
      if (changed) {
        if (existing.steps.length) existing.version += 1;
        existing.steps = input.steps;
        existing.source = input.source;
        existing.status = 'active';
      }
      if (!changed || input.source === 'success') {
        existing.success_count += 1;
        existing.last_success_at = at;
      }
      existing.updated_at = at;
      return { id: existing.id, version: existing.version, changed };
    }
    const rec: PlaybookRecord = {
      id: randomUUID(),
      site: normSite(input.site),
      task_type: normType(input.taskType),
      version: 1,
      steps: input.steps,
      status: 'active',
      source: input.source,
      success_count: input.source === 'success' ? 1 : 0,
      replay_success_count: 0,
      failure_count: 0,
      last_success_at: input.source === 'success' ? at : null,
      last_failure_at: null,
      updated_at: at,
    };
    this.playbooks.set(rec.id, rec);
    return { id: rec.id, version: 1, changed: true };
  }

  async recordPlaybookReplay(id: string, ok: boolean) {
    const p = this.playbooks.get(id);
    if (!p) return;
    if (ok) {
      p.replay_success_count += 1;
      p.last_success_at = nowIso();
    } else {
      p.failure_count += 1;
      p.last_failure_at = nowIso();
    }
  }

  async insertDraft(row: Parameters<IqStore['insertDraft']>[0]) {
    assertNoPii(row.steps, 'steps');
    const d: PlaybookDraftRow = {
      ...row,
      id: randomUUID(),
      site: normSite(row.site),
      task_type: normType(row.task_type),
      step_count: row.steps.length,
      status: 'pending',
      review_note: null,
      reviewed_by: null,
      reviewed_at: null,
      playbook_id: null,
      created_at: nowIso(),
    };
    this.drafts.set(d.id, d);
    return d;
  }

  async listDrafts(status?: PlaybookDraftRow['status'], limit = 50) {
    return [...this.drafts.values()].filter((d) => !status || d.status === status).reverse().slice(0, limit);
  }

  async getDraft(id: string) {
    return this.drafts.get(id) ?? null;
  }

  async decideDraft(id: string, patch: Parameters<IqStore['decideDraft']>[1]) {
    const d = this.drafts.get(id);
    if (!d || d.status !== 'pending') return false;
    Object.assign(d, patch, { reviewed_at: nowIso() });
    return true;
  }

  async claimPracticeRun(row: Parameters<IqStore['claimPracticeRun']>[0]) {
    const dup = [...this.runs.values()].some((r) => r.org_id === row.org_id && r.run_date === row.run_date && r.task_key === row.task_key);
    if (dup) return null;
    const at = nowIso();
    const r: PracticeRunRow = {
      ...row,
      id: randomUUID(),
      status: 'running',
      failed_step: null,
      failure_reason: null,
      steps: [],
      task_id: null,
      playbook_id: null,
      playbook_version: null,
      used_playbook: false,
      model_calls: 0,
      cost_nanos: 0,
      duration_ms: null,
      started_at: at,
      finished_at: null,
      created_at: at,
    };
    this.runs.set(r.id, r);
    return r;
  }

  async updatePracticeRun(id: string, patch: Partial<PracticeRunRow>) {
    const r = this.runs.get(id);
    if (r) Object.assign(r, patch);
  }

  async deletePracticeRun(id: string) {
    this.runs.delete(id);
    this.screens = this.screens.filter((s) => s.run_id !== id);
  }

  async getPracticeRun(id: string) {
    return this.runs.get(id) ?? null;
  }

  async listPracticeRuns(sinceDate: string, limit = 2000) {
    return [...this.runs.values()].filter((r) => r.run_date >= sinceDate).reverse().slice(0, limit);
  }

  async insertPracticeScreen(row: Parameters<IqStore['insertPracticeScreen']>[0]) {
    const jpeg = clipScreen(row.jpeg_b64);
    if (!jpeg) return;
    this.screens.push({ ...row, jpeg_b64: jpeg, id: this.screens.length + 1, created_at: nowIso() });
  }

  async listPracticeScreens(runId: string) {
    return this.screens.filter((s) => s.run_id === runId).sort((a, b) => a.step_index - b.step_index || a.id - b.id);
  }

  async logRoute(row: RouteDecisionRow) {
    this.routes.push({ ...row });
  }

  async listRoutes(taskId: string) {
    return this.routes.filter((r) => r.task_id === taskId);
  }
}
