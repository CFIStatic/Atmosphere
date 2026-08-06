/**
 * Human review queue for low-confidence / conflicting verification results.
 *
 * Decisions are append-only. Original AI results are never overwritten.
 */

import { randomUUID } from 'node:crypto';
import { humanReviewDecisionSchema } from '../schemas.js';
import { appendAuditEvent } from '../audit/auditLog.js';
import type { VerificationStatus } from '../types.js';

export async function createReviewTask(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opts: {
    orgId: string;
    jobId: string;
    resultId?: string | null;
    videoId?: string | null;
    changeEventId?: string | null;
    reason: string;
    priority?: 'low' | 'normal' | 'high' | 'critical';
    context?: Record<string, unknown>;
  },
): Promise<string> {
  const id = randomUUID();
  const { error } = await supabase.from('human_review_tasks').insert({
    id,
    org_id: opts.orgId,
    job_id: opts.jobId,
    result_id: opts.resultId ?? null,
    video_id: opts.videoId ?? null,
    change_event_id: opts.changeEventId ?? null,
    reason: opts.reason,
    priority: opts.priority ?? 'normal',
    status: 'open',
    context: opts.context ?? {},
  });
  if (error) throw new Error(error.message);
  return id;
}

export async function listOpenReviewTasks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  orgId: string,
  opts?: { jobId?: string; limit?: number },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  let q = supabase
    .from('human_review_tasks')
    .select(
      'id, job_id, result_id, video_id, reason, priority, status, assigned_to, context, created_at, verification_results(title, status, activity_type, room_or_area, system_confidence, ai_observation, rules_result)',
    )
    .eq('org_id', orgId)
    .in('status', ['open', 'in_progress'])
    .order('created_at', { ascending: true })
    .limit(opts?.limit ?? 50);
  if (opts?.jobId) q = q.eq('job_id', opts.jobId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function recordReviewDecision(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opts: {
    orgId: string;
    taskId: string;
    reviewerId: string;
    body: unknown;
  },
): Promise<{ decisionId: string; taskStatus: string }> {
  const input = humanReviewDecisionSchema.parse(opts.body);

  const { data: task, error: taskError } = await supabase
    .from('human_review_tasks')
    .select('*')
    .eq('id', opts.taskId)
    .eq('org_id', opts.orgId)
    .maybeSingle();
  if (taskError) throw new Error(taskError.message);
  if (!task) throw new Error('Review task not found');

  let finalStatus: VerificationStatus | null = input.finalStatus ?? null;
  let taskStatus = 'in_progress';

  if (input.decision === 'approve') {
    finalStatus = finalStatus ?? 'human_verified';
    taskStatus = 'approved';
  } else if (input.decision === 'reject') {
    finalStatus = finalStatus ?? 'rejected';
    taskStatus = 'rejected';
  } else if (input.decision === 'edit_activity' || input.decision === 'adjust_room') {
    taskStatus = 'edited';
    finalStatus = finalStatus ?? 'human_verified';
  } else if (input.decision === 'request_reanalysis') {
    taskStatus = 'cancelled';
  } else if (input.decision === 'comment' || input.decision === 'add_evidence') {
    taskStatus = task.status === 'open' ? 'in_progress' : task.status;
  }

  const decisionId = randomUUID();
  const { error: decError } = await supabase.from('human_review_decisions').insert({
    id: decisionId,
    org_id: opts.orgId,
    task_id: opts.taskId,
    result_id: task.result_id,
    reviewer_id: opts.reviewerId,
    decision: input.decision,
    edited_activity: input.editedActivity ?? null,
    adjusted_room: input.adjustedRoom ?? null,
    additional_frame_ids: input.additionalFrameIds,
    comment: input.comment ?? null,
    reason: input.reason ?? null,
    final_status: finalStatus,
  });
  if (decError) throw new Error(decError.message);

  await supabase
    .from('human_review_tasks')
    .update({
      status: taskStatus,
      assigned_to: opts.reviewerId,
    })
    .eq('id', opts.taskId);

  // Never overwrite AI fields — only status / human-facing title adjustments.
  if (task.result_id && finalStatus) {
    const patch: Record<string, unknown> = {
      status: finalStatus,
      system_confidence: finalStatus === 'human_verified' ? 1 : undefined,
    };
    if (input.editedActivity) {
      patch.activity_type = input.editedActivity;
      patch.title = input.editedActivity.replace(/_/g, ' ');
    }
    if (input.adjustedRoom) {
      patch.room_or_area = input.adjustedRoom;
    }
    // Strip undefined
    for (const k of Object.keys(patch)) {
      if (patch[k] === undefined) delete patch[k];
    }
    await supabase.from('verification_results').update(patch).eq('id', task.result_id);

    if (input.additionalFrameIds.length) {
      await supabase.from('verification_evidence').insert(
        input.additionalFrameIds.map((frameId) => ({
          org_id: opts.orgId,
          result_id: task.result_id,
          frame_id: frameId,
          role: 'supporting',
          note: 'Added by human reviewer',
        })),
      );
    }
  }

  await appendAuditEvent(supabase, {
    orgId: opts.orgId,
    jobId: task.job_id,
    videoId: task.video_id,
    resultId: task.result_id,
    actorId: opts.reviewerId,
    eventType: 'review.decision',
    entityType: 'human_review_decision',
    entityId: decisionId,
    payload: {
      decision: input.decision,
      finalStatus,
      reason: input.reason ?? null,
    },
  });

  return { decisionId, taskStatus };
}
