/**
 * Suggested work: evaluate a job, list suggestions, and record what people
 * do with them. Service client only; every read and write filters on org_id
 * (and job_id where there is one). Callers resolve the org from the session.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { HttpError } from '../lib/errors.js';
import { judgeCandidates, type CompleteFn } from './judge.js';
import {
  candidateSuggestions,
  dedupeCandidates,
  staleOpenKinds,
  type PriorSuggestion,
  type SuggestionKind,
} from './rules.js';
import { loadJobState } from './state.js';

type Db = { from: (table: string) => any };

export interface SuggestionView {
  id: string;
  jobId: string;
  jobTitle: string | null;
  kind: SuggestionKind;
  status: 'open' | 'approved' | 'dismissed' | 'superseded';
  title: string;
  detail: string | null;
  reason: string | null;
  prompt: string;
  handoff: 'chat';
  createdAt: string;
}

const COLUMNS = 'id, job_id, kind, status, title, detail, reason, prompt, handoff, state_fingerprint, evidence, created_at';

function missingTable(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  return /job_suggestion|does not exist|schema cache|42P01/i.test(`${error.message ?? ''} ${error.code ?? ''}`);
}

function view(row: any, jobTitle: string | null = null): SuggestionView {
  return {
    id: row.id,
    jobId: row.job_id,
    jobTitle,
    kind: row.kind,
    status: row.status,
    title: row.title,
    detail: row.detail ?? null,
    reason: row.reason ?? null,
    prompt: row.prompt,
    handoff: 'chat',
    createdAt: row.created_at,
  };
}

async function logEvent(
  admin: Db,
  row: { org_id: string; job_id: string; suggestion_id: string; kind: string; action: string; user_id?: string | null; detail?: Record<string, unknown> },
): Promise<void> {
  const { error } = await admin.from('job_suggestion_events').insert({
    org_id: row.org_id,
    job_id: row.job_id,
    suggestion_id: row.suggestion_id,
    kind: row.kind,
    action: row.action,
    user_id: row.user_id ?? null,
    detail: row.detail ?? {},
  });
  if (error && !missingTable(error)) console.warn(`[suggested-work] event log failed action=${row.action}`);
}

export interface EvaluateResult {
  created: SuggestionKind[];
  superseded: SuggestionKind[];
  skipped?: string;
}

/**
 * Look at the job and add any suggestion its state now supports. Safe to
 * call after every analysis or job event: a state the rules already acted on
 * produces nothing.
 */
export async function evaluateJobSuggestions(
  admin: Db,
  input: { orgId: string; jobId: string; trigger: string; complete?: CompleteFn },
): Promise<EvaluateResult> {
  const state = await loadJobState(admin, input);
  if (!state) return { created: [], superseded: [], skipped: 'job_not_found' };

  const { data: priorRows, error } = await admin
    .from('job_suggestions')
    .select('kind, status, state_fingerprint, evidence, created_at')
    .eq('org_id', input.orgId)
    .eq('job_id', input.jobId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    if (missingTable(error)) return { created: [], superseded: [], skipped: 'not_migrated' };
    throw new HttpError(500, error.message, 'suggestions_failed');
  }
  const prior: PriorSuggestion[] = ((priorRows ?? []) as any[]).map((r) => ({
    kind: r.kind,
    status: r.status,
    stateFingerprint: r.state_fingerprint,
    evidence: r.evidence ?? {},
    createdAt: r.created_at,
  }));

  const candidates = candidateSuggestions(state, prior);
  const retire = staleOpenKinds(candidates, prior);
  const { create, supersede } = dedupeCandidates(candidates, prior);
  const judged = await judgeCandidates(state, create, input.complete);
  const keptKinds = new Set(judged.map((j) => j.kind));
  const toSupersede = [...new Set([...retire, ...supersede.filter((k) => keptKinds.has(k))])];

  for (const kind of toSupersede) {
    const { data: rows } = await admin
      .from('job_suggestions')
      .update({ status: 'superseded', decided_at: new Date().toISOString() })
      .eq('org_id', input.orgId)
      .eq('job_id', input.jobId)
      .eq('kind', kind)
      .eq('status', 'open')
      .select('id');
    for (const r of (rows ?? []) as any[]) {
      await logEvent(admin, { org_id: input.orgId, job_id: input.jobId, suggestion_id: r.id, kind, action: 'superseded', detail: { trigger: input.trigger } });
    }
  }

  const created: SuggestionKind[] = [];
  for (const c of judged) {
    const { data: row, error: insertError } = await admin
      .from('job_suggestions')
      .insert({
        org_id: input.orgId,
        job_id: input.jobId,
        kind: c.kind,
        title: c.title,
        detail: c.detail,
        reason: c.reason,
        prompt: c.prompt,
        handoff: c.handoff,
        state_fingerprint: c.stateFingerprint,
        evidence: { ...c.evidence, trigger: input.trigger, modelWhy: c.modelWhy },
        source: c.judgedBy,
        model: c.model,
      })
      .select('id')
      .maybeSingle();
    if (insertError) {
      // 23505: a concurrent evaluation already made this one.
      if (insertError.code === '23505') continue;
      if (missingTable(insertError)) return { created, superseded: toSupersede, skipped: 'not_migrated' };
      throw new HttpError(500, insertError.message, 'suggestions_failed');
    }
    if (row?.id) {
      created.push(c.kind);
      await logEvent(admin, { org_id: input.orgId, job_id: input.jobId, suggestion_id: row.id, kind: c.kind, action: 'created', detail: { trigger: input.trigger, source: c.judgedBy } });
    }
  }
  return { created, superseded: toSupersede };
}

/** Fire and forget from a background path; never throws. */
export function queueJobSuggestionEvaluation(admin: Db, input: { orgId: string; jobId: string; trigger: string }): void {
  void evaluateJobSuggestions(admin, input).catch((err) => {
    console.warn(`[suggested-work] evaluate failed trigger=${input.trigger} error=${err instanceof Error ? err.message.slice(0, 160) : 'unknown'}`);
  });
}

export async function listOpenSuggestions(
  admin: Db,
  input: { orgId: string; jobId?: string | null; limit?: number },
): Promise<SuggestionView[]> {
  let query = admin.from('job_suggestions').select(COLUMNS).eq('org_id', input.orgId).eq('status', 'open');
  if (input.jobId) query = query.eq('job_id', input.jobId);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(input.limit ?? 100);
  if (error) {
    if (missingTable(error)) return [];
    throw new HttpError(500, error.message, 'suggestions_failed');
  }
  const rows = (data ?? []) as any[];
  const jobIds = [...new Set(rows.map((r) => r.job_id))];
  const titles = new Map<string, string>();
  if (jobIds.length) {
    const { data: jobs } = await admin
      .from('crm_jobs')
      .select('id, title, deleted_at')
      .eq('org_id', input.orgId)
      .in('id', jobIds);
    for (const j of (jobs ?? []) as any[]) if (!j.deleted_at) titles.set(j.id, j.title);
  }
  return rows.filter((r) => titles.has(r.job_id)).map((r) => view(r, titles.get(r.job_id) ?? null));
}

/**
 * Approve or dismiss. Approve returns the prompt to hand to Chat — the
 * person's edited version when they changed it (logged as 'edited' with both
 * texts). Nothing runs here: Chat starts Computer, and Computer still stops
 * at its own Approve before anything is submitted or saved.
 */
export async function decideSuggestion(
  admin: Db,
  input: {
    orgId: string;
    userId: string;
    suggestionId: string;
    decision: 'approve' | 'dismiss';
    editedPrompt?: string | null;
    reason?: string | null;
  },
): Promise<{ suggestion: SuggestionView; prompt: string | null }> {
  const { data: row, error } = await admin
    .from('job_suggestions')
    .select(COLUMNS)
    .eq('org_id', input.orgId)
    .eq('id', input.suggestionId)
    .maybeSingle();
  if (error && !missingTable(error)) throw new HttpError(500, error.message, 'suggestions_failed');
  if (!row) throw new HttpError(404, 'That suggestion is not on this workspace.', 'suggestion_not_found');
  if (row.status !== 'open') throw new HttpError(409, 'That suggestion was already handled.', 'suggestion_closed');

  const status = input.decision === 'approve' ? 'approved' : 'dismissed';
  const { data: updated, error: updateError } = await admin
    .from('job_suggestions')
    .update({ status, decided_at: new Date().toISOString(), decided_by: input.userId })
    .eq('org_id', input.orgId)
    .eq('id', row.id)
    .eq('status', 'open')
    .select(COLUMNS)
    .maybeSingle();
  if (updateError) throw new HttpError(500, updateError.message, 'suggestions_failed');
  if (!updated) throw new HttpError(409, 'That suggestion was already handled.', 'suggestion_closed');

  const base = { org_id: input.orgId, job_id: row.job_id, suggestion_id: row.id, kind: row.kind, user_id: input.userId };
  const edited = (input.editedPrompt ?? '').trim();
  let prompt: string | null = null;
  if (input.decision === 'approve') {
    prompt = row.prompt;
    if (edited && edited !== row.prompt) {
      prompt = edited.slice(0, 4000);
      await logEvent(admin, { ...base, action: 'edited', detail: { before: row.prompt, after: prompt } });
    }
    await logEvent(admin, { ...base, action: 'approved', detail: { edited: prompt !== row.prompt } });
  } else {
    await logEvent(admin, { ...base, action: 'dismissed', detail: { reason: (input.reason ?? '').trim().slice(0, 300) || null } });
  }
  return { suggestion: view(updated), prompt };
}
