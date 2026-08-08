/**
 * Project timeline events and workflow graph relationships.
 */

import { randomUUID } from 'node:crypto';
import type { PipelineContext } from '../pipeline/orchestrator.js';
import { appendAuditEvent } from '../audit/auditLog.js';

export function createGenerateVerifiedEventsHandler(): (
  ctx: PipelineContext,
) => Promise<{ output: Record<string, unknown> }> {
  return async (ctx) => {
    const { data: results, error } = await ctx.supabase
      .from('verification_results')
      .select('*')
      .eq('org_id', ctx.orgId)
      .eq('job_id', ctx.jobId)
      .eq('video_id', ctx.videoId)
      .order('observed_at', { ascending: true });
    if (error) throw new Error(error.message);

    let created = 0;
    for (const row of results ?? []) {
      const { data: existing } = await ctx.supabase
        .from('project_timeline_events')
        .select('id')
        .eq('result_id', row.id)
        .maybeSingle();
      if (existing) continue;

      const { data: evidence } = await ctx.supabase
        .from('verification_evidence')
        .select('frame_id, role')
        .eq('result_id', row.id);

      const id = randomUUID();
      await ctx.supabase.from('project_timeline_events').insert({
        id,
        org_id: ctx.orgId,
        job_id: ctx.jobId,
        room_or_area: row.room_or_area,
        activity_id: row.activity_ontology_id ?? row.activity_type,
        result_id: row.id,
        llm_run_id: row.llm_run_id,
        change_event_id: row.change_event_id,
        occurred_at: row.observed_at ?? row.last_evidence_at ?? row.first_evidence_at,
        title: row.title,
        summary: row.summary,
        status: row.status,
        completion_state: row.completion_state ?? null,
        system_confidence: row.system_confidence,
        confidence_breakdown: row.confidence_breakdown ?? {},
        evidence_frame_ids: (evidence ?? [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((e: any) => e.frame_id)
          .filter(Boolean),
        provenance: {
          videoId: ctx.videoId,
          processingJobId: ctx.processingJobId,
          source: 'llm_verifier',
        },
      });
      created += 1;
    }

    await appendAuditEvent(ctx.supabase, {
      orgId: ctx.orgId,
      jobId: ctx.jobId,
      videoId: ctx.videoId,
      eventType: 'timeline.events_generated',
      entityType: 'verification_video',
      entityId: ctx.videoId,
      payload: { created },
    });

    return { output: { timelineEvents: created } };
  };
}

export function createUpdateProjectGraphHandler(): (
  ctx: PipelineContext,
) => Promise<{ output: Record<string, unknown> }> {
  return async (ctx) => {
    const { data: events, error } = await ctx.supabase
      .from('project_timeline_events')
      .select('id, room_or_area, activity_id, occurred_at, status')
      .eq('org_id', ctx.orgId)
      .eq('job_id', ctx.jobId)
      .order('occurred_at', { ascending: true, nullsFirst: false });
    if (error) throw new Error(error.message);

    let edges = 0;
    const list = events ?? [];
    for (let i = 1; i < list.length; i += 1) {
      const prev = list[i - 1]!;
      const curr = list[i]!;

      edges += await upsertRelation(ctx, prev.id, curr.id, 'followed_by');
      edges += await upsertRelation(ctx, curr.id, prev.id, 'preceded_by');

      if (prev.room_or_area && prev.room_or_area === curr.room_or_area) {
        edges += await upsertRelation(ctx, prev.id, curr.id, 'performed_in_same_area');
      }
    }

    // verified_by: link each accepted timeline event to itself provenance-wise via audit only;
    // contradiction edges when statuses conflict in same room later.
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i]!;
        const b = list[j]!;
        if (a.room_or_area && a.room_or_area === b.room_or_area) {
          if (
            ['contradicted', 'rejected'].includes(b.status) &&
            ['verified', 'likely_verified', 'human_verified'].includes(a.status)
          ) {
            edges += await upsertRelation(ctx, b.id, a.id, 'contradicted_by');
          }
        }
      }
    }

    await appendAuditEvent(ctx.supabase, {
      orgId: ctx.orgId,
      jobId: ctx.jobId,
      videoId: ctx.videoId,
      eventType: 'workflow.graph_updated',
      entityType: 'crm_job',
      entityId: ctx.jobId,
      payload: { edges },
    });

    return { output: { edges } };
  };
}

async function upsertRelation(
  ctx: PipelineContext,
  fromId: string,
  toId: string,
  relation: string,
): Promise<number> {
  const { data: existing } = await ctx.supabase
    .from('workflow_relationships')
    .select('id')
    .eq('from_event_id', fromId)
    .eq('to_event_id', toId)
    .eq('relation', relation)
    .maybeSingle();
  if (existing) return 0;
  const { error } = await ctx.supabase.from('workflow_relationships').insert({
    id: randomUUID(),
    org_id: ctx.orgId,
    job_id: ctx.jobId,
    from_event_id: fromId,
    to_event_id: toId,
    relation,
    confidence: 0.8,
    provenance: { source: 'auto_sequence' },
  });
  if (error) {
    // Unique race — treat as already present
    if (/duplicate|unique/i.test(error.message)) return 0;
    throw new Error(error.message);
  }
  return 1;
}

export async function linkOutcome(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opts: {
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
  const id = randomUUID();
  const { error } = await supabase.from('outcome_records').insert({
    id,
    org_id: opts.orgId,
    job_id: opts.jobId,
    timeline_event_id: opts.timelineEventId ?? null,
    result_id: opts.resultId ?? null,
    outcome_type: opts.outcomeType,
    external_ref: opts.externalRef ?? null,
    amount_cents: opts.amountCents ?? null,
    occurred_at: opts.occurredAt ?? null,
    payload: opts.payload ?? {},
  });
  if (error) throw new Error(error.message);

  if (opts.timelineEventId) {
    // Outcome link is recorded on the outcome row + audit; do not invent
    // self-referential workflow edges.
  }

  await appendAuditEvent(supabase, {
    orgId: opts.orgId,
    jobId: opts.jobId,
    resultId: opts.resultId ?? null,
    eventType: 'outcome.linked',
    entityType: 'outcome_record',
    entityId: id,
    payload: { outcomeType: opts.outcomeType, timelineEventId: opts.timelineEventId ?? null },
  });

  return id;
}
