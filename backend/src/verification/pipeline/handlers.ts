/**
 * Generate verification results from change events + rules + confidence.
 */

import { randomUUID } from 'node:crypto';
import type { PipelineContext } from '../pipeline/orchestrator.js';
import {
  BUILTIN_RULES,
  evaluateAllRules,
  type VerificationRule,
} from '../rules/engine.js';
import { scoreConfidence, statusFromConfidence } from '../confidence/score.js';
import { createReviewTask } from '../review/queue.js';
import { appendAuditEvent } from '../audit/auditLog.js';

async function loadRules(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  orgId: string,
): Promise<VerificationRule[]> {
  const { data } = await supabase
    .from('verification_rules')
    .select('*')
    .eq('is_active', true)
    .or(`org_id.is.null,org_id.eq.${orgId}`);
  if (!data?.length) return BUILTIN_RULES;
  // Prefer org-specific over global for same activity.
  const byActivity = new Map<string, VerificationRule>();
  for (const row of data) {
    const rule: VerificationRule = {
      id: row.id,
      activityType: row.activity_type,
      version: row.version,
      name: row.name,
      requiredObservations: row.required_observations ?? [],
      requiredBeforeStates: row.required_before_states ?? [],
      requiredAfterStates: row.required_after_states ?? [],
      minSupportingFrames: row.min_supporting_frames,
      minConfidence: Number(row.min_confidence),
      contradictoryObservations: row.contradictory_observations ?? [],
      allowedRoomTypes: row.allowed_room_types ?? [],
      humanReviewTriggers: row.human_review_triggers ?? [],
      projectRequirements: row.project_requirements ?? {},
    };
    const existing = byActivity.get(rule.activityType);
    if (!existing || row.org_id === orgId) byActivity.set(rule.activityType, rule);
  }
  return [...byActivity.values()];
}

export function createGenerateVerificationsHandler(): (
  ctx: PipelineContext,
) => Promise<{ output: Record<string, unknown> }> {
  return async (ctx) => {
    // Prefer LLM verifier results. This stage only backfills when the LLM stage
    // was skipped (older pipeline) and no results exist yet.
    const { count: llmCount } = await ctx.supabase
      .from('llm_verification_runs')
      .select('id', { count: 'exact', head: true })
      .eq('video_id', ctx.videoId);
    if ((llmCount ?? 0) > 0) {
      return { output: { skipped: true, reason: 'llm_verifier_already_ran' } };
    }

    const { count: resultCount } = await ctx.supabase
      .from('verification_results')
      .select('id', { count: 'exact', head: true })
      .eq('video_id', ctx.videoId);
    if ((resultCount ?? 0) > 0) {
      return { output: { skipped: true, reason: 'results_exist' } };
    }

    const rules = await loadRules(ctx.supabase, ctx.orgId);
    const { data: events, error } = await ctx.supabase
      .from('temporal_change_events')
      .select('*')
      .eq('job_id', ctx.jobId)
      .eq('org_id', ctx.orgId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);

    let created = 0;
    for (const event of events ?? []) {
      const supportingFrameCount =
        (event.before_frame_ids?.length ?? 0) + (event.after_frame_ids?.length ?? 0);
      const evidenceTokens = [
        event.before_state,
        event.after_state,
        event.inferred_activity,
      ];
      const rulesResult = evaluateAllRules(rules, {
        activityType: event.inferred_activity,
        roomType: event.room_or_area,
        observations: evidenceTokens,
        beforeStates: [event.before_state],
        afterStates: [event.after_state],
        supportingFrameCount,
        confidence: Number(event.confidence ?? 0),
        contradictory: event.conflicting_evidence ?? [],
      });
      if (!rulesResult) continue;

      const breakdown = scoreConfidence({
        modelConfidence: Number(event.confidence ?? 0),
        supportingFrameCount,
        visualQuality: 0.7,
        temporalConsistency: (event.conflicting_evidence ?? []).length ? 0.3 : 0.85,
        sceneMatchConfidence: 0.7,
        modelAgreement: 0.8,
        rulesResult,
        hasContradictoryEvidence: (event.conflicting_evidence ?? []).length > 0,
        metadataQuality: 0.6,
        humanConfirmation: 0,
      });

      const status = statusFromConfidence(breakdown, rulesResult.status);
      const resultId = randomUUID();

      await ctx.supabase.from('verification_results').insert({
        id: resultId,
        org_id: ctx.orgId,
        job_id: ctx.jobId,
        video_id: ctx.videoId,
        change_event_id: event.id,
        rule_id: rulesResult.ruleId,
        rule_version: rulesResult.ruleVersion,
        activity_type: event.inferred_activity,
        room_or_area: event.room_or_area,
        title: titleFor(event.inferred_activity, event.room_or_area),
        summary: `${event.before_state} → ${event.after_state}`,
        status,
        model_confidence: Number(event.confidence ?? 0),
        system_confidence: breakdown.final,
        confidence_breakdown: breakdown,
        observed_at: event.last_observed_at ?? event.first_observed_at,
        first_evidence_at: event.first_observed_at,
        last_evidence_at: event.last_observed_at,
        ai_observation: {
          before: event.before_state,
          after: event.after_state,
          evidence: event.evidence,
        },
        rules_result: rulesResult,
      });

      const evidenceRows = [
        ...(event.before_frame_ids ?? []).map((frameId: string) => ({
          org_id: ctx.orgId,
          result_id: resultId,
          frame_id: frameId,
          video_id: event.before_video_id,
          role: 'before',
        })),
        ...(event.after_frame_ids ?? []).map((frameId: string) => ({
          org_id: ctx.orgId,
          result_id: resultId,
          frame_id: frameId,
          video_id: event.after_video_id,
          role: 'after',
        })),
      ];
      if (evidenceRows.length) {
        await ctx.supabase.from('verification_evidence').insert(evidenceRows);
      }

      if (rulesResult.triggersReview || status === 'needs_review' || status === 'uncertain') {
        await createReviewTask(ctx.supabase, {
          orgId: ctx.orgId,
          jobId: ctx.jobId,
          resultId,
          videoId: ctx.videoId,
          changeEventId: event.id,
          reason: rulesResult.reviewReasons.join(',') || status,
          priority:
            status === 'contradicted' || rulesResult.reviewReasons.includes('safety_issue')
              ? 'high'
              : 'normal',
          context: { rulesResult, breakdown },
        });
        await ctx.supabase
          .from('verification_videos')
          .update({ status: 'needs_review' })
          .eq('id', ctx.videoId);
      }

      created += 1;
    }

    await appendAuditEvent(ctx.supabase, {
      orgId: ctx.orgId,
      jobId: ctx.jobId,
      videoId: ctx.videoId,
      eventType: 'verification.results_generated',
      entityType: 'verification_video',
      entityId: ctx.videoId,
      payload: { created, legacy: true },
    });

    return { output: { results: created } };
  };
}

export function createCalculateConfidenceHandler(): (
  ctx: PipelineContext,
) => Promise<{ output: Record<string, unknown> }> {
  return async (ctx) => {
    // Confidence already written during generate_verifications; recompute for any
    // results missing system_confidence (safe reprocessing).
    const { data: results } = await ctx.supabase
      .from('verification_results')
      .select('id, model_confidence, rules_result, confidence_breakdown, status')
      .eq('video_id', ctx.videoId)
      .eq('org_id', ctx.orgId);

    let updated = 0;
    for (const row of results ?? []) {
      if (row.system_confidence != null && row.confidence_breakdown?.final != null) continue;
      const rulesResult = row.rules_result;
      const breakdown = scoreConfidence({
        modelConfidence: Number(row.model_confidence ?? 0),
        supportingFrameCount: 2,
        visualQuality: 0.7,
        temporalConsistency: 0.7,
        sceneMatchConfidence: 0.7,
        modelAgreement: 0.8,
        rulesResult,
        hasContradictoryEvidence: false,
        metadataQuality: 0.6,
        humanConfirmation: 0,
      });
      await ctx.supabase
        .from('verification_results')
        .update({
          system_confidence: breakdown.final,
          confidence_breakdown: breakdown,
          status: statusFromConfidence(breakdown, row.status),
        })
        .eq('id', row.id);
      updated += 1;
    }
    return { output: { updated } };
  };
}

export function createFinalizeReportHandler(): (
  ctx: PipelineContext,
) => Promise<{ output: Record<string, unknown> }> {
  return async (ctx) => {
    const { data: results } = await ctx.supabase
      .from('verification_results')
      .select('id, status')
      .eq('video_id', ctx.videoId);

    const summary = {
      total: (results ?? []).length,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      verified: (results ?? []).filter((r: any) =>
        ['verified', 'likely_verified', 'human_verified'].includes(r.status),
      ).length,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      needsReview: (results ?? []).filter((r: any) =>
        ['needs_review', 'uncertain', 'contradicted'].includes(r.status),
      ).length,
      finalizedAt: new Date().toISOString(),
    };

    await ctx.supabase
      .from('video_processing_jobs')
      .update({ result_summary: summary })
      .eq('id', ctx.processingJobId);

    await appendAuditEvent(ctx.supabase, {
      orgId: ctx.orgId,
      jobId: ctx.jobId,
      videoId: ctx.videoId,
      eventType: 'verification.report_finalized',
      entityType: 'video_processing_job',
      entityId: ctx.processingJobId,
      payload: summary,
    });

    return { output: summary };
  };
}

function titleFor(activity: string, room: string): string {
  const label = activity.replace(/_/g, ' ');
  return room && room !== 'unidentified'
    ? `${room.replace(/_/g, ' ')} — ${label}`
    : label;
}
