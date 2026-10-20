/**
 * Project timeline events and workflow graph relationships.
 */

import { randomUUID } from 'node:crypto';
import type { PipelineContext } from '../pipeline/orchestrator.js';
import { appendAuditEvent } from '../audit/auditLog.js';

/**
 * public.project_timeline_events and workflow_relationships were dropped by
 * 20260910190000_drop_unused_non_sold_path_tables.sql. The project timeline is
 * now derived on read from verification_results (see timelineEventsForJob), so
 * these two stages only record what they would have produced. They never write
 * to or read from a dropped table.
 */
export interface TimelineEvent {
  id: string;
  occurred_at: string | null;
  title: string | null;
  summary: string | null;
  status: string | null;
  completion_state: string | null;
  room_or_area: string | null;
  activity_id: string | null;
  system_confidence: number | null;
  confidence_breakdown: Record<string, unknown>;
  evidence_frame_ids: string[];
  evidence_clip_ids: string[];
  result_id: string;
  llm_run_id: string | null;
  provenance: Record<string, unknown>;
}

interface ResultRow {
  id: string;
  video_id?: string | null;
  room_or_area?: string | null;
  activity_ontology_id?: string | null;
  activity_type?: string | null;
  llm_run_id?: string | null;
  observed_at?: string | null;
  last_evidence_at?: string | null;
  first_evidence_at?: string | null;
  title?: string | null;
  summary?: string | null;
  status?: string | null;
  completion_state?: string | null;
  system_confidence?: number | null;
  confidence_breakdown?: Record<string, unknown> | null;
}

export function timelineEventFromResult(row: ResultRow, frameIds: string[] = []): TimelineEvent {
  return {
    id: row.id,
    occurred_at: row.observed_at ?? row.last_evidence_at ?? row.first_evidence_at ?? null,
    title: row.title ?? null,
    summary: row.summary ?? null,
    status: row.status ?? null,
    completion_state: row.completion_state ?? null,
    room_or_area: row.room_or_area ?? null,
    activity_id: row.activity_ontology_id ?? row.activity_type ?? null,
    system_confidence: row.system_confidence ?? null,
    confidence_breakdown: row.confidence_breakdown ?? {},
    evidence_frame_ids: frameIds,
    evidence_clip_ids: [],
    result_id: row.id,
    llm_run_id: row.llm_run_id ?? null,
    provenance: { videoId: row.video_id ?? null, source: 'llm_verifier' },
  };
}

const RESULT_COLS =
  'id, video_id, room_or_area, activity_ontology_id, activity_type, llm_run_id, observed_at, last_evidence_at, first_evidence_at, title, summary, status, completion_state, system_confidence, confidence_breakdown';

/** The job's timeline, derived from verification_results (+ evidence frames). */
export async function timelineEventsForJob(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  orgId: string,
  jobId: string,
): Promise<TimelineEvent[]> {
  const { data, error } = await supabase
    .from('verification_results')
    .select(RESULT_COLS)
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .order('observed_at', { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ResultRow[];
  const framesByResult = new Map<string, string[]>();
  if (rows.length) {
    const { data: evidence } = await supabase
      .from('verification_evidence')
      .select('result_id, frame_id')
      .in(
        'result_id',
        rows.map((r) => r.id),
      );
    for (const e of (evidence ?? []) as Array<{ result_id: string; frame_id: string | null }>) {
      if (!e.frame_id) continue;
      const list = framesByResult.get(e.result_id) ?? [];
      list.push(e.frame_id);
      framesByResult.set(e.result_id, list);
    }
  }
  return rows.map((r) => timelineEventFromResult(r, framesByResult.get(r.id) ?? []));
}

export function createGenerateVerifiedEventsHandler(): (
  ctx: PipelineContext,
) => Promise<{ output: Record<string, unknown> }> {
  return async (ctx) => {
    const { count, error } = await ctx.supabase
      .from('verification_results')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', ctx.orgId)
      .eq('job_id', ctx.jobId)
      .eq('video_id', ctx.videoId);
    if (error) throw new Error(error.message);
    const created = count ?? 0;

    await appendAuditEvent(ctx.supabase, {
      orgId: ctx.orgId,
      jobId: ctx.jobId,
      videoId: ctx.videoId,
      eventType: 'timeline.events_generated',
      entityType: 'verification_video',
      entityId: ctx.videoId,
      payload: { created, derived: true },
    });

    return { output: { timelineEvents: created, derived: true } };
  };
}

export function createUpdateProjectGraphHandler(): (
  ctx: PipelineContext,
) => Promise<{ output: Record<string, unknown> }> {
  return async (ctx) => {
    const list = await timelineEventsForJob(ctx.supabase, ctx.orgId, ctx.jobId);

    let edges = 0;
    for (let i = 1; i < list.length; i += 1) {
      const prev = list[i - 1]!;
      const curr = list[i]!;
      edges += await upsertRelation(ctx, prev.id, curr.id, 'followed_by');
      edges += await upsertRelation(ctx, curr.id, prev.id, 'preceded_by');
      if (prev.room_or_area && prev.room_or_area === curr.room_or_area) {
        edges += await upsertRelation(ctx, prev.id, curr.id, 'performed_in_same_area');
      }
    }

    await appendAuditEvent(ctx.supabase, {
      orgId: ctx.orgId,
      jobId: ctx.jobId,
      videoId: ctx.videoId,
      eventType: 'workflow.graph_updated',
      entityType: 'crm_job',
      entityId: ctx.jobId,
      payload: { edges, events: list.length },
    });

    return { output: { edges, events: list.length } };
  };
}

async function upsertRelation(
  _ctx: PipelineContext,
  _fromId: string,
  _toId: string,
  _relation: string,
): Promise<number> {
  // workflow_relationships dropped
  return 0;
}

export async function linkOutcome(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _supabase: any,
  _opts: {
    orgId: string;
    jobId: string;
    timelineEventId?: string | null;
    resultId?: string | null;
    outcomeType: string;
    externalRef?: string | null;
    amountCents?: number | null;
    occurredAt?: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<string> {
  // outcome_records dropped
  return randomUUID();
}
