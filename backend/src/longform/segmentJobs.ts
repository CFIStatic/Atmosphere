/**
 * Saved, resumable segment jobs (public.video_segment_jobs). A recording is
 * split into ~10-min rows; the worker claims one at a time with a lease, so a
 * crash or deploy only loses the in-flight segment, which another worker
 * resumes once the lease expires. Failed attempts back off; after
 * maxAttempts the row is 'failed' and its minutes show as visible gaps.
 */

import { planSegments } from './segmentPlan.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type SegmentJobRow = {
  id: string;
  proof_id: string;
  org_id: string;
  seg_index: number;
  start_seconds: number;
  end_seconds: number;
  status: 'queued' | 'running' | 'done' | 'failed';
  attempts: number;
  output: any;
  cost_nanos: number;
};

/** Idempotent: existing (proof, seg_index) rows are left alone so finished work is never redone. */
export async function enqueueSegments(
  admin: any,
  input: { proofId: string; orgId: string; durationSeconds: number; segmentSeconds: number },
): Promise<number> {
  const rows = planSegments(input.durationSeconds, input.segmentSeconds).map((s) => ({
    proof_id: input.proofId,
    org_id: input.orgId,
    seg_index: s.index,
    start_seconds: s.startSeconds,
    end_seconds: s.endSeconds,
  }));
  if (!rows.length) return 0;
  const { error } = await admin
    .from('video_segment_jobs')
    .upsert(rows, { onConflict: 'proof_id,seg_index', ignoreDuplicates: true });
  if (error) throw new Error(`enqueue segments: ${error.message}`);
  return rows.length;
}

export async function claimSegment(admin: any, owner: string, leaseSeconds = 300): Promise<SegmentJobRow | null> {
  const { data, error } = await admin.rpc('claim_video_segment_job', { p_owner: owner, p_lease_seconds: leaseSeconds });
  if (error) throw new Error(`claim segment: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return row?.id ? (row as SegmentJobRow) : null;
}

export async function completeSegment(admin: any, id: string, owner: string, output: unknown, costNanos: number): Promise<void> {
  const { error } = await admin
    .from('video_segment_jobs')
    .update({ status: 'done', output, cost_nanos: costNanos, error: null, lease_owner: null, lease_until: null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('lease_owner', owner);
  if (error) throw new Error(`complete segment: ${error.message}`);
}

/** Backoff: 1, 4, 16, 64 minutes. */
export function segmentBackoffMs(attempts: number): number {
  return Math.min(64, 4 ** Math.max(0, attempts - 1)) * 60_000;
}

export async function failSegment(
  admin: any,
  row: Pick<SegmentJobRow, 'id' | 'attempts'>,
  owner: string,
  message: string,
  maxAttempts: number,
  now = Date.now(),
): Promise<'retry' | 'failed'> {
  const final = row.attempts >= maxAttempts;
  const { error } = await admin
    .from('video_segment_jobs')
    .update({
      status: final ? 'failed' : 'queued',
      error: message.slice(0, 500),
      lease_owner: null,
      lease_until: null,
      next_attempt_at: new Date(now + segmentBackoffMs(row.attempts)).toISOString(),
      updated_at: new Date(now).toISOString(),
    })
    .eq('id', row.id)
    .eq('lease_owner', owner);
  if (error) throw new Error(`fail segment: ${error.message}`);
  return final ? 'failed' : 'retry';
}

/** All segments of a proof; the timeline is assembled once none are queued/running. */
export async function loadSegments(admin: any, proofId: string): Promise<SegmentJobRow[]> {
  const { data, error } = await admin
    .from('video_segment_jobs')
    .select('id, proof_id, org_id, seg_index, start_seconds, end_seconds, status, attempts, output, cost_nanos')
    .eq('proof_id', proofId)
    .order('seg_index');
  if (error) throw new Error(`load segments: ${error.message}`);
  return (data ?? []) as SegmentJobRow[];
}
