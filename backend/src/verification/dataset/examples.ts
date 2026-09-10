/**
 * Canonical dataset example builder (provider-neutral).
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { RightsManifestInput } from './eligibility.js';

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
  _supabase: any,
  _opts: { orgId: string; name?: string; version?: string },
): Promise<{ datasetId: string; versionId: string }> {
  // dataset_registry / dataset_versions dropped
  return { datasetId: 'gone', versionId: 'gone' };
}

export async function createDatasetExampleFromResult(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _supabase: any,
  _opts: {
    orgId: string;
    resultId: string;
    rights: RightsManifestInput;
    datasetName?: string;
    datasetVersion?: string;
    purpose?: 'evaluation' | 'training' | 'internal_improvement';
  },
): Promise<{ exampleId: string; eligible: boolean; reasons: string[]; canonical?: CanonicalDatasetExample }> {
  // dataset_* dropped
  return { exampleId: '', eligible: false, reasons: ['dataset_tables_gone'] };
}

export function checksumOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
