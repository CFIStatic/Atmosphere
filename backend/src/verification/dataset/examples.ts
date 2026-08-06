/**
 * Canonical dataset example builder (provider-neutral).
 */

import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assignSplit, type DatasetSplit } from './splits.js';
import { recordProvenance } from './provenance.js';
import {
  evaluateDatasetEligibility,
  recordEligibilityDecision,
  type RightsManifestInput,
  type PrivacyStatus,
} from './eligibility.js';
import { hasProvenanceChain } from './provenance.js';

export const canonicalDatasetExampleSchema = z.object({
  example_id: z.string().uuid(),
  task_type: z.literal('temporal_work_verification'),
  ontology_version: z.string(),
  schema_version: z.string(),
  project_context: z.object({
    industry_id: z.string(),
    trade_id: z.string().nullable(),
    room_type_id: z.string().nullable(),
    component_type_id: z.string().nullable(),
  }),
  task: z.object({
    task_id: z.string(),
  }),
  media: z.object({
    before_frames: z.array(z.string()),
    during_clips: z.array(z.string()),
    after_frames: z.array(z.string()),
  }),
  states: z.object({
    before_state_id: z.string(),
    after_state_id: z.string(),
  }),
  verifier: z.object({
    decision: z.string(),
    completion_state: z.string().nullable(),
    confidence: z.number().min(0).max(1),
  }),
  quality_score: z.number().min(0).max(1),
  rights_manifest_id: z.string().uuid().nullable(),
  privacy_status: z.string(),
  provenance_manifest_id: z.string().uuid().nullable(),
  split: z.string(),
  source: z.object({
    org_id: z.string().uuid(),
    job_id: z.string().uuid(),
    video_id: z.string().uuid().nullable(),
    result_id: z.string().uuid(),
  }),
});

export type CanonicalDatasetExample = z.output<typeof canonicalDatasetExampleSchema>;

export async function ensureDatasetVersion(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opts: { orgId: string; name?: string; version?: string },
): Promise<{ datasetId: string; versionId: string }> {
  const name = opts.name ?? 'temporal-work-verification';
  const version = opts.version ?? '0.1.0-draft';

  let { data: dataset } = await supabase
    .from('dataset_registry')
    .select('id')
    .eq('org_id', opts.orgId)
    .eq('name', name)
    .maybeSingle();

  if (!dataset) {
    const id = randomUUID();
    const { error } = await supabase.from('dataset_registry').insert({
      id,
      org_id: opts.orgId,
      name,
      purpose: 'temporal_work_verification',
      description: 'Verified temporal work events with evidence provenance',
    });
    if (error) throw new Error(error.message);
    dataset = { id };
  }

  let { data: ver } = await supabase
    .from('dataset_versions')
    .select('id, status')
    .eq('dataset_id', dataset.id)
    .eq('version', version)
    .maybeSingle();

  if (ver?.status === 'released') {
    throw new Error('Cannot add examples to a released dataset version. Create a new version.');
  }

  if (!ver) {
    const id = randomUUID();
    const { error } = await supabase.from('dataset_versions').insert({
      id,
      dataset_id: dataset.id,
      version,
      status: 'draft',
      ontology_version: 'v1',
      schema_version: '1.0.0',
    });
    if (error) throw new Error(error.message);
    ver = { id, status: 'draft' };
  }

  return { datasetId: dataset.id as string, versionId: ver.id as string };
}

export async function createDatasetExampleFromResult(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opts: {
    orgId: string;
    resultId: string;
    rights: RightsManifestInput;
    datasetName?: string;
    datasetVersion?: string;
    purpose?: 'evaluation' | 'training' | 'internal_improvement';
  },
): Promise<{ exampleId: string; eligible: boolean; reasons: string[]; canonical?: CanonicalDatasetExample }> {
  const { data: result, error } = await supabase
    .from('verification_results')
    .select(
      '*, verification_evidence(frame_id, role, video_timestamp_seconds), temporal_change_events(before_state, after_state, before_frame_ids, after_frame_ids)',
    )
    .eq('id', opts.resultId)
    .eq('org_id', opts.orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!result) throw new Error('Result not found');

  const { data: video } = await supabase
    .from('verification_videos')
    .select('id, privacy_status, quarantine_reason, job_id')
    .eq('id', result.video_id)
    .maybeSingle();

  const provenanceComplete = await hasProvenanceChain(supabase, {
    orgId: opts.orgId,
    resultId: opts.resultId,
  });

  const privacyStatus = (result.privacy_status ??
    video?.privacy_status ??
    'unknown') as PrivacyStatus;

  const qualityScore = Number(result.system_confidence ?? result.model_confidence ?? 0);

  const eligibility = evaluateDatasetEligibility({
    rights: opts.rights,
    privacyStatus,
    provenanceComplete,
    qualityScore,
    quarantined: Boolean(video?.quarantine_reason),
    decisionStatus: result.status,
    purpose: opts.purpose ?? 'training',
  });

  await recordEligibilityDecision(supabase, {
    orgId: opts.orgId,
    resultId: opts.resultId,
    videoId: result.video_id,
    decision: eligibility,
  });

  if (!eligibility.eligible) {
    return { exampleId: '', eligible: false, reasons: eligibility.reasons };
  }

  // Persist rights manifest
  const { data: rightsRow, error: rightsError } = await supabase
    .from('rights_manifests')
    .insert({
      org_id: opts.orgId,
      job_id: result.job_id,
      video_id: result.video_id,
      result_id: result.id,
      category: opts.rights.category,
      operational_processing: opts.rights.operationalProcessing ?? true,
      internal_improvement: opts.rights.internalImprovement ?? false,
      evaluation_allowed: opts.rights.evaluationAllowed ?? false,
      training_allowed: opts.rights.trainingAllowed ?? false,
      policy_version: opts.rights.policyVersion ?? 'v1',
    })
    .select('id')
    .single();
  if (rightsError) throw new Error(rightsError.message);

  const { versionId } = await ensureDatasetVersion(supabase, {
    orgId: opts.orgId,
    name: opts.datasetName,
    version: opts.datasetVersion,
  });

  const evidence = result.verification_evidence ?? [];
  const beforeFrames = evidence
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((e: any) => e.role === 'before')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((e: any) => e.frame_id)
    .filter(Boolean);
  const afterFrames = evidence
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((e: any) => e.role === 'after')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((e: any) => e.frame_id)
    .filter(Boolean);

  const change = result.temporal_change_events;
  const exampleId = randomUUID();
  const split: DatasetSplit = assignSplit({ projectId: result.job_id });

  const provenanceId = await recordProvenance(supabase, {
    orgId: opts.orgId,
    entityType: 'dataset_example',
    entityId: exampleId,
    parentType: 'verification_result',
    parentId: result.id,
    transformation: 'canonical_dataset_example',
    transformationVersion: '1.0.0',
    ontologyVersion: 'v1',
    promptVersion: null,
    payload: {
      llmRunId: result.llm_run_id,
      changeEventId: result.change_event_id,
      videoId: result.video_id,
    },
  });

  const canonical = canonicalDatasetExampleSchema.parse({
    example_id: exampleId,
    task_type: 'temporal_work_verification',
    ontology_version: 'v1',
    schema_version: '1.0.0',
    project_context: {
      industry_id: 'restoration',
      trade_id: 'water_mitigation',
      room_type_id: result.room_or_area ?? null,
      component_type_id: null,
    },
    task: {
      task_id: result.activity_ontology_id ?? result.activity_type,
    },
    media: {
      before_frames: beforeFrames.length
        ? beforeFrames
        : change?.before_frame_ids ?? [],
      during_clips: [],
      after_frames: afterFrames.length ? afterFrames : change?.after_frame_ids ?? [],
    },
    states: {
      before_state_id: change?.before_state ?? 'unknown',
      after_state_id: change?.after_state ?? 'unknown',
    },
    verifier: {
      decision: result.status,
      completion_state: result.completion_state ?? null,
      confidence: qualityScore,
    },
    quality_score: qualityScore,
    rights_manifest_id: rightsRow.id,
    privacy_status: privacyStatus,
    provenance_manifest_id: provenanceId,
    split,
    source: {
      org_id: opts.orgId,
      job_id: result.job_id,
      video_id: result.video_id,
      result_id: result.id,
    },
  });

  const { error: exError } = await supabase.from('dataset_examples').insert({
    id: exampleId,
    org_id: opts.orgId,
    dataset_version_id: versionId,
    job_id: result.job_id,
    result_id: result.id,
    video_id: result.video_id,
    rights_manifest_id: rightsRow.id,
    provenance_root_id: provenanceId,
    task_type: 'temporal_work_verification',
    split,
    ontology_version: 'v1',
    schema_version: '1.0.0',
    canonical,
    quality_score: qualityScore,
    quality_breakdown: result.confidence_breakdown ?? {},
    privacy_status: privacyStatus,
    eligibility_passed: true,
  });
  if (exError) throw new Error(exError.message);

  const mediaRows = [
    ...canonical.media.before_frames.map((frameId) => ({
      example_id: exampleId,
      role: 'before',
      frame_id: frameId,
    })),
    ...canonical.media.after_frames.map((frameId) => ({
      example_id: exampleId,
      role: 'after',
      frame_id: frameId,
    })),
  ];
  if (mediaRows.length) {
    await supabase.from('dataset_example_media').insert(mediaRows);
  }

  // Bump draft example count
  const { count } = await supabase
    .from('dataset_examples')
    .select('id', { count: 'exact', head: true })
    .eq('dataset_version_id', versionId);
  await supabase
    .from('dataset_versions')
    .update({ example_count: count ?? 0, status: 'ready' })
    .eq('id', versionId)
    .neq('status', 'released');

  return { exampleId, eligible: true, reasons: [], canonical };
}

export function checksumOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
