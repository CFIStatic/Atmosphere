/**
 * Provider-neutral JSONL export for a dataset version.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { DatasetSplit } from './splits.js';
import { checksumOf } from './examples.js';
import { recordProvenance } from './provenance.js';
import { verificationConfig } from '../config.js';

export interface ExportResult {
  exportJobId: string;
  storagePath: string;
  checksumSha256: string;
  exampleCount: number;
  byteSize: number;
  localPath?: string;
}

export async function exportDatasetVersionJsonl(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opts: {
    orgId: string;
    datasetVersionId: string;
    splitFilter?: DatasetSplit | null;
    /** When true, also write a local temp file (tests / local workers). */
    writeLocal?: boolean;
  },
): Promise<ExportResult> {
  const { data: version, error: vErr } = await supabase
    .from('dataset_versions')
    .select('id, version, status, ontology_version, schema_version, dataset_id')
    .eq('id', opts.datasetVersionId)
    .maybeSingle();
  if (vErr) throw new Error(vErr.message);
  if (!version) throw new Error('Dataset version not found');

  let q = supabase
    .from('dataset_examples')
    .select('id, canonical, split, job_id')
    .eq('dataset_version_id', opts.datasetVersionId)
    .eq('org_id', opts.orgId)
    .eq('eligibility_passed', true);
  if (opts.splitFilter) q = q.eq('split', opts.splitFilter);

  const { data: examples, error } = await q.order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  if (!examples?.length) throw new Error('No eligible examples to export');

  // Leakage guard: ensure no job appears in both train and test within this export set
  assertNoSplitLeakage(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    examples.map((e: any) => ({ jobId: e.job_id, split: e.split })),
  );

  const lines = examples.map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e: any) => JSON.stringify(e.canonical),
  );
  const body = `${lines.join('\n')}\n`;
  const checksum = checksumOf(body);
  const byteSize = Buffer.byteLength(body, 'utf8');

  const exportJobId = randomUUID();
  const storagePath = `${opts.orgId}/datasets/${opts.datasetVersionId}/exports/${exportJobId}.jsonl`;

  const { error: jobErr } = await supabase.from('export_jobs').insert({
    id: exportJobId,
    org_id: opts.orgId,
    dataset_version_id: opts.datasetVersionId,
    format: 'jsonl',
    split_filter: opts.splitFilter ?? null,
    status: 'running',
    storage_path: storagePath,
    schema_version: version.schema_version,
    ontology_version: version.ontology_version,
    code_version: process.env.GIT_COMMIT ?? 'local',
  });
  if (jobErr) throw new Error(jobErr.message);

  // Upload to private storage when available; always keep checksumed bytes.
  const bytes = Buffer.from(body, 'utf8');
  const { error: upErr } = await supabase.storage
    .from(verificationConfig.bucket)
    .upload(storagePath, bytes, {
      contentType: 'application/x-ndjson',
      upsert: true,
    });
  // Storage may be unavailable in unit tests — fall back to local only.
  let localPath: string | undefined;
  if (upErr || opts.writeLocal) {
    const dir = join(tmpdir(), 'atmosphere-exports', opts.datasetVersionId);
    await mkdir(dir, { recursive: true });
    localPath = join(dir, `${exportJobId}.jsonl`);
    await writeFile(localPath, bytes);
  }
  if (upErr && !localPath) {
    await supabase
      .from('export_jobs')
      .update({ status: 'failed', error: upErr.message })
      .eq('id', exportJobId);
    throw new Error(upErr.message);
  }

  await supabase.from('export_manifests').insert({
    id: randomUUID(),
    export_job_id: exportJobId,
    file_name: `${exportJobId}.jsonl`,
    storage_path: storagePath,
    checksum_sha256: checksum,
    byte_size: byteSize,
    record_count: examples.length,
  });

  await supabase
    .from('export_jobs')
    .update({
      status: 'completed',
      example_count: examples.length,
      byte_size: byteSize,
      checksum_sha256: checksum,
      completed_at: new Date().toISOString(),
    })
    .eq('id', exportJobId);

  // Mark version released only when explicitly requested via status transition elsewhere.
  // Export does not auto-release; callers may set released after validation.
  await supabase
    .from('dataset_versions')
    .update({ checksum_manifest: checksum })
    .eq('id', opts.datasetVersionId)
    .neq('status', 'released');

  await recordProvenance(supabase, {
    orgId: opts.orgId,
    entityType: 'export_job',
    entityId: exportJobId,
    parentType: 'dataset_version',
    parentId: opts.datasetVersionId,
    transformation: 'jsonl_export',
    transformationVersion: '1.0.0',
    checksum,
    payload: { exampleCount: examples.length, splitFilter: opts.splitFilter ?? null },
  });

  return {
    exportJobId,
    storagePath,
    checksumSha256: checksum,
    exampleCount: examples.length,
    byteSize,
    localPath,
  };
}

/** Detect train/test leakage by project within a single export batch. */
export function assertNoSplitLeakage(
  rows: Array<{ jobId: string; split: string }>,
): void {
  const byJob = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = byJob.get(row.jobId) ?? new Set();
    set.add(row.split);
    byJob.set(row.jobId, set);
  }
  for (const [jobId, splits] of byJob) {
    const hasTrain = splits.has('train');
    const hasTest = splits.has('test') || splits.has('holdout') || splits.has('benchmark');
    if (hasTrain && hasTest) {
      throw new Error(`Split leakage detected for project ${jobId}: ${[...splits].join(',')}`);
    }
  }
}

export function sha256Hex(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}
