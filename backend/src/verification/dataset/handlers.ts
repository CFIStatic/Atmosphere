/**
 * Pipeline handlers for privacy → eligibility → dataset examples.
 */

import type { PipelineContext } from '../pipeline/orchestrator.js';
import { createPrivacyScanHandler } from '../dataset/privacy.js';
import {
  evaluateDatasetEligibility,
  recordEligibilityDecision,
  type RightsManifestInput,
} from '../dataset/eligibility.js';
import { hasProvenanceChain, recordProvenance } from '../dataset/provenance.js';
import { createDatasetExampleFromResult } from '../dataset/examples.js';
import { appendAuditEvent } from '../audit/auditLog.js';

export { createPrivacyScanHandler };

/** Default rights for orgs that opt into internal improvement during processing. */
function defaultProcessingRights(): RightsManifestInput {
  const training =
    process.env.VERIFICATION_DEFAULT_TRAINING_ALLOWED === 'true';
  return {
    category: training ? 'training_allowed' : 'operational_only',
    operationalProcessing: true,
    internalImprovement: process.env.VERIFICATION_DEFAULT_INTERNAL_IMPROVEMENT === 'true',
    evaluationAllowed: process.env.VERIFICATION_DEFAULT_EVALUATION_ALLOWED === 'true',
    trainingAllowed: training,
    policyVersion: 'v1',
  };
}

export function createEvaluateDatasetEligibilityHandler(): (
  ctx: PipelineContext,
) => Promise<{ output: Record<string, unknown> }> {
  return async (ctx) => {
    const { data: results, error } = await ctx.supabase
      .from('verification_results')
      .select('id, status, system_confidence, model_confidence, privacy_status, video_id')
      .eq('org_id', ctx.orgId)
      .eq('video_id', ctx.videoId);
    if (error) throw new Error(error.message);

    const { data: video } = await ctx.supabase
      .from('verification_videos')
      .select('privacy_status, quarantine_reason')
      .eq('id', ctx.videoId)
      .maybeSingle();

    const rights = defaultProcessingRights();
    let eligible = 0;
    let rejected = 0;

    for (const row of results ?? []) {
      await recordProvenance(ctx.supabase, {
        orgId: ctx.orgId,
        entityType: 'verification_result',
        entityId: row.id,
        parentType: 'verification_video',
        parentId: ctx.videoId,
        transformation: 'llm_verification',
        ontologyVersion: 'v1',
      });

      const provenanceComplete = await hasProvenanceChain(ctx.supabase, {
        orgId: ctx.orgId,
        resultId: row.id,
      });

      const decision = evaluateDatasetEligibility({
        rights,
        privacyStatus: row.privacy_status ?? video?.privacy_status ?? 'unknown',
        provenanceComplete,
        qualityScore: Number(row.system_confidence ?? row.model_confidence ?? 0),
        quarantined: Boolean(video?.quarantine_reason),
        decisionStatus: row.status,
        purpose: rights.trainingAllowed
          ? 'training'
          : rights.evaluationAllowed
            ? 'evaluation'
            : 'internal_improvement',
      });

      await recordEligibilityDecision(ctx.supabase, {
        orgId: ctx.orgId,
        resultId: row.id,
        videoId: ctx.videoId,
        decision,
      });

      if (decision.eligible) eligible += 1;
      else rejected += 1;
    }

    return { output: { eligible, rejected, rightsCategory: rights.category } };
  };
}

export function createDatasetExamplesHandler(): (
  ctx: PipelineContext,
) => Promise<{ output: Record<string, unknown> }> {
  return async (ctx) => {
    const rights = defaultProcessingRights();
    if (!rights.trainingAllowed && !rights.evaluationAllowed && !rights.internalImprovement) {
      return {
        output: { created: 0, skipped: true, reason: 'rights_not_configured_for_dataset' },
        skip: true,
      };
    }

    const { data: results, error } = await ctx.supabase
      .from('verification_results')
      .select('id, dataset_eligible')
      .eq('org_id', ctx.orgId)
      .eq('video_id', ctx.videoId)
      .eq('dataset_eligible', true);
    if (error) throw new Error(error.message);

    let created = 0;
    const exampleIds: string[] = [];
    for (const row of results ?? []) {
      const out = await createDatasetExampleFromResult(ctx.supabase, {
        orgId: ctx.orgId,
        resultId: row.id,
        rights,
        purpose: rights.trainingAllowed ? 'training' : 'evaluation',
      });
      if (out.eligible && out.exampleId) {
        created += 1;
        exampleIds.push(out.exampleId);
      }
    }

    await appendAuditEvent(ctx.supabase, {
      orgId: ctx.orgId,
      jobId: ctx.jobId,
      videoId: ctx.videoId,
      eventType: 'dataset.examples_created',
      entityType: 'verification_video',
      entityId: ctx.videoId,
      payload: { created, exampleIds },
    });

    return { output: { created, exampleIds } };
  };
}
