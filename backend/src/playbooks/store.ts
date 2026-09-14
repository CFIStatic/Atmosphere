/**
 * Persist trade playbooks via service-role client (or in-memory for unit tests).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'node:crypto';
import type {
  DraftPlaybookStep,
  GeneratedPlaybookDraft,
  PlaybookSource,
  PlaybookSourceKind,
  PlaybookStatus,
  PlaybookStep,
  TradePlaybook,
} from './types.js';

type MemoryPlaybook = TradePlaybook & { steps: PlaybookStep[]; sources: PlaybookSource[] };

const memory = new Map<string, MemoryPlaybook>();

export function resetPlaybooksForTests(): void {
  memory.clear();
}

function useMemory(): boolean {
  return process.env.PLAYBOOK_STORE === 'memory';
}

function rowFromDb(r: any): TradePlaybook {
  return {
    id: r.id,
    orgId: r.org_id,
    title: r.title,
    trade: r.trade ?? null,
    summary: r.summary ?? null,
    status: r.status,
    sourceKind: r.source_kind,
    sourceJobId: r.source_job_id ?? null,
    skillTags: Array.isArray(r.skill_tags) ? r.skill_tags : [],
    stepCount: Number(r.step_count ?? 0),
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function stepFromDb(r: any): PlaybookStep {
  return {
    id: r.id,
    playbookId: r.playbook_id,
    position: Number(r.position),
    title: r.title,
    instruction: r.instruction ?? null,
    skillKey: r.skill_key ?? null,
    evidenceHint: r.evidence_hint ?? null,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
  };
}

function sourceFromDb(r: any): PlaybookSource {
  return {
    id: r.id,
    playbookId: r.playbook_id,
    jobId: r.job_id ?? null,
    proofId: r.proof_id ?? null,
    episodeId: r.episode_id ?? null,
    analysisSnapshot: (r.analysis_snapshot as Record<string, unknown>) ?? {},
    createdAt: r.created_at,
  };
}

export type ListPlaybooksQuery = {
  orgId: string;
  trade?: string;
  status?: PlaybookStatus | 'all';
  q?: string;
  limit?: number;
};

export async function listPlaybooks(admin: any, query: ListPlaybooksQuery): Promise<TradePlaybook[]> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  if (useMemory()) {
    let rows = [...memory.values()].filter((p) => p.orgId === query.orgId);
    if (query.status && query.status !== 'all') rows = rows.filter((p) => p.status === query.status);
    if (query.trade) rows = rows.filter((p) => (p.trade ?? '') === query.trade);
    if (query.q?.trim()) {
      const needle = query.q.trim().toLowerCase();
      rows = rows.filter(
        (p) =>
          p.title.toLowerCase().includes(needle) ||
          (p.summary ?? '').toLowerCase().includes(needle) ||
          (p.trade ?? '').toLowerCase().includes(needle),
      );
    }
    return rows
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map(({ steps: _s, sources: _src, ...rest }) => rest);
  }

  let q = admin
    .from('trade_playbooks')
    .select(
      'id, org_id, title, trade, summary, status, source_kind, source_job_id, skill_tags, step_count, created_by, created_at, updated_at',
    )
    .eq('org_id', query.orgId)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (query.status && query.status !== 'all') q = q.eq('status', query.status);
  if (query.trade) q = q.eq('trade', query.trade);
  if (query.q?.trim()) {
    const safe = query.q.trim().replace(/[%_,]/g, ' ');
    q = q.or(`title.ilike.%${safe}%,summary.ilike.%${safe}%,trade.ilike.%${safe}%`);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowFromDb);
}

export async function getPlaybook(
  admin: any,
  id: string,
): Promise<(TradePlaybook & { steps: PlaybookStep[]; sources: PlaybookSource[] }) | null> {
  if (useMemory()) {
    const row = memory.get(id);
    if (!row) return null;
    return {
      ...row,
      steps: [...row.steps].sort((a, b) => a.position - b.position),
      sources: [...row.sources],
    };
  }

  const { data, error } = await admin
    .from('trade_playbooks')
    .select(
      'id, org_id, title, trade, summary, status, source_kind, source_job_id, skill_tags, step_count, created_by, created_at, updated_at',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const [stepsRes, sourcesRes] = await Promise.all([
    admin
      .from('trade_playbook_steps')
      .select('id, playbook_id, position, title, instruction, skill_key, evidence_hint, metadata')
      .eq('playbook_id', id)
      .order('position', { ascending: true }),
    admin
      .from('trade_playbook_sources')
      .select('id, playbook_id, job_id, proof_id, episode_id, analysis_snapshot, created_at')
      .eq('playbook_id', id)
      .order('created_at', { ascending: false }),
  ]);
  if (stepsRes.error) throw new Error(stepsRes.error.message);
  if (sourcesRes.error) throw new Error(sourcesRes.error.message);

  return {
    ...rowFromDb(data),
    steps: (stepsRes.data ?? []).map(stepFromDb),
    sources: (sourcesRes.data ?? []).map(sourceFromDb),
  };
}

async function insertSteps(admin: any, playbookId: string, steps: DraftPlaybookStep[]): Promise<void> {
  if (!steps.length) return;
  const rows = steps.map((step, position) => ({
    playbook_id: playbookId,
    position,
    title: step.title.slice(0, 200),
    instruction: step.instruction ?? null,
    skill_key: step.skillKey ?? null,
    evidence_hint: step.evidenceHint ?? null,
    metadata: step.metadata ?? {},
  }));
  if (useMemory()) {
    const pb = memory.get(playbookId);
    if (!pb) return;
    pb.steps = rows.map((r, i) => ({
      id: randomUUID(),
      playbookId,
      position: i,
      title: r.title,
      instruction: r.instruction,
      skillKey: r.skill_key,
      evidenceHint: r.evidence_hint,
      metadata: r.metadata as Record<string, unknown>,
    }));
    pb.stepCount = pb.steps.length;
    return;
  }
  const { error } = await admin.from('trade_playbook_steps').insert(rows);
  if (error) throw new Error(error.message);
}

export async function createPlaybook(
  admin: any,
  input: {
    orgId: string;
    userId: string | null;
    title: string;
    trade?: string | null;
    summary?: string | null;
    status?: PlaybookStatus;
    sourceKind?: PlaybookSourceKind;
    sourceJobId?: string | null;
    skillTags?: string[];
    steps: DraftPlaybookStep[];
  },
): Promise<TradePlaybook & { steps: PlaybookStep[]; sources: PlaybookSource[] }> {
  const now = new Date().toISOString();
  const id = randomUUID();
  const stepCount = input.steps.length;
  const row = {
    id,
    org_id: input.orgId,
    title: input.title.slice(0, 200),
    trade: input.trade ?? null,
    summary: input.summary ?? null,
    status: input.status ?? 'draft',
    source_kind: input.sourceKind ?? 'manual',
    source_job_id: input.sourceJobId ?? null,
    skill_tags: input.skillTags ?? [],
    step_count: stepCount,
    created_by: input.userId,
    created_at: now,
    updated_at: now,
  };

  if (useMemory()) {
    const playbook: MemoryPlaybook = {
      ...rowFromDb(row),
      steps: [],
      sources: [],
    };
    memory.set(id, playbook);
    await insertSteps(admin, id, input.steps);
    return (await getPlaybook(admin, id))!;
  }

  const { error } = await admin.from('trade_playbooks').insert(row);
  if (error) throw new Error(error.message);
  await insertSteps(admin, id, input.steps);
  return (await getPlaybook(admin, id))!;
}

export async function createPlaybookFromDraft(
  admin: any,
  input: {
    orgId: string;
    userId: string | null;
    draft: GeneratedPlaybookDraft;
  },
): Promise<TradePlaybook & { steps: PlaybookStep[]; sources: PlaybookSource[] }> {
  const playbook = await createPlaybook(admin, {
    orgId: input.orgId,
    userId: input.userId,
    title: input.draft.title,
    trade: input.draft.trade,
    summary: input.draft.summary,
    status: 'draft',
    sourceKind: 'job_analysis',
    sourceJobId: input.draft.sourceJobId,
    skillTags: input.draft.skillTags,
    steps: input.draft.steps,
  });

  const sourceRows = (input.draft.proofIds.length ? input.draft.proofIds : [null]).map((proofId) => ({
    id: randomUUID(),
    playbook_id: playbook.id,
    job_id: input.draft.sourceJobId,
    proof_id: proofId,
    episode_id: null,
    analysis_snapshot: input.draft.analysisSnapshot,
    created_at: new Date().toISOString(),
  }));

  if (useMemory()) {
    const pb = memory.get(playbook.id)!;
    pb.sources = sourceRows.map(sourceFromDb);
    return (await getPlaybook(admin, playbook.id))!;
  }

  const { error } = await admin.from('trade_playbook_sources').insert(sourceRows);
  if (error) throw new Error(error.message);
  return (await getPlaybook(admin, playbook.id))!;
}

export async function updatePlaybook(
  admin: any,
  id: string,
  patch: {
    title?: string;
    trade?: string | null;
    summary?: string | null;
    status?: PlaybookStatus;
    steps?: DraftPlaybookStep[];
  },
): Promise<TradePlaybook & { steps: PlaybookStep[]; sources: PlaybookSource[] }> {
  const existing = await getPlaybook(admin, id);
  if (!existing) throw new Error('playbook_not_found');

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { updated_at: now };
  if (patch.title !== undefined) updates.title = patch.title.slice(0, 200);
  if (patch.trade !== undefined) updates.trade = patch.trade;
  if (patch.summary !== undefined) updates.summary = patch.summary;
  if (patch.status !== undefined) updates.status = patch.status;

  if (patch.steps) {
    updates.step_count = patch.steps.length;
    updates.skill_tags = [
      ...new Set(patch.steps.map((s) => s.skillKey).filter((k): k is string => Boolean(k))),
    ].slice(0, 12);
  }

  if (useMemory()) {
    const pb = memory.get(id)!;
    Object.assign(pb, {
      title: (updates.title as string) ?? pb.title,
      trade: updates.trade !== undefined ? (updates.trade as string | null) : pb.trade,
      summary: updates.summary !== undefined ? (updates.summary as string | null) : pb.summary,
      status: (updates.status as PlaybookStatus) ?? pb.status,
      updatedAt: now,
      skillTags: (updates.skill_tags as string[]) ?? pb.skillTags,
      stepCount: (updates.step_count as number) ?? pb.stepCount,
    });
    if (patch.steps) {
      pb.steps = [];
      await insertSteps(admin, id, patch.steps);
    }
    return (await getPlaybook(admin, id))!;
  }

  const { error } = await admin.from('trade_playbooks').update(updates).eq('id', id);
  if (error) throw new Error(error.message);

  if (patch.steps) {
    const { error: delErr } = await admin.from('trade_playbook_steps').delete().eq('playbook_id', id);
    if (delErr) throw new Error(delErr.message);
    await insertSteps(admin, id, patch.steps);
  }

  return (await getPlaybook(admin, id))!;
}

export async function deletePlaybook(admin: any, id: string): Promise<void> {
  if (useMemory()) {
    memory.delete(id);
    return;
  }
  const { error } = await admin.from('trade_playbooks').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
