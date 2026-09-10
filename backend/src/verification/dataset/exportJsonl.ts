/**
 * Provider-neutral JSONL export for a dataset version.
 */

import { createHash } from 'node:crypto';
import type { DatasetSplit } from './splits.js';

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
  _supabase: any,
  _opts: {
    orgId: string;
    datasetVersionId: string;
    splitFilter?: DatasetSplit | null;
    writeLocal?: boolean;
  },
): Promise<ExportResult> {
  // dataset_* dropped
  return {
    exportJobId: 'gone',
    storagePath: '',
    checksumSha256: '',
    exampleCount: 0,
    byteSize: 0,
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
