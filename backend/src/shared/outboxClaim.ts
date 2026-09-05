/**
 * Claim helpers for the sold-path outbox tables.
 *
 * Production prefers the SKIP LOCKED RPCs in
 * `20260905220000_durable_processing_claim.sql`. Older DBs and unit stubs
 * fall back to a PostgREST CAS update, then to an unguarded stamp so boot
 * reclaim still works when the lease columns are missing.
 */

import {
  expiredLeaseFilter,
  leaseOwnerId,
  leaseUntilIso,
  VERIFICATION_LEASE_MS,
} from '../verification/lease.js';
import { leaseIsClaimable } from './durableOutbox.js';

export type ProofWorkKind = 'narration' | 'transcript' | 'analysis';

export type ClaimOutcome = 'claimed' | 'held' | 'unknown';

const PROOF_LEASE: Record<
  ProofWorkKind,
  { owner: string; until: string; status: string }
> = {
  narration: {
    owner: 'narration_lease_owner',
    until: 'narration_lease_until',
    status: 'narration_status',
  },
  transcript: {
    owner: 'transcript_lease_owner',
    until: 'transcript_lease_until',
    status: 'transcript_status',
  },
  analysis: {
    owner: 'analysis_lease_owner',
    until: 'analysis_lease_until',
    status: 'analysis_status',
  },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

type RpcClient = {
  rpc?: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
  from: (table: string) => any;
};

async function tryRpc(
  supabase: RpcClient,
  name: string,
  args: Record<string, unknown>,
): Promise<{ row: unknown; missing: boolean }> {
  if (typeof supabase.rpc !== 'function') return { row: null, missing: true };
  try {
    const { data, error } = await supabase.rpc(name, args);
    if (error) {
      const msg = error.message ?? '';
      if (/could not find|does not exist|schema cache|PGRST202/i.test(msg)) {
        return { row: null, missing: true };
      }
      return { row: null, missing: false };
    }
    return { row: data ?? null, missing: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/could not find|does not exist|schema cache|PGRST202/i.test(msg)) {
      return { row: null, missing: true };
    }
    return { row: null, missing: false };
  }
}

export async function claimNextVideoProcessingJob(
  supabase: RpcClient,
  opts?: { owner?: string; leaseMs?: number; id?: string },
): Promise<Record<string, unknown> | null> {
  const owner = opts?.owner ?? leaseOwnerId();
  const leaseSeconds = Math.round((opts?.leaseMs ?? VERIFICATION_LEASE_MS) / 1000);
  const rpc = await tryRpc(supabase, 'claim_video_processing_job', {
    p_owner: owner,
    p_lease_seconds: leaseSeconds,
    p_id: opts?.id ?? null,
  });
  if (!rpc.missing) {
    const row = Array.isArray(rpc.row) ? rpc.row[0] ?? null : rpc.row;
    return asRecord(row);
  }
  return claimVideoProcessingJobFallback(supabase, { owner, id: opts?.id });
}

async function claimVideoProcessingJobFallback(
  supabase: { from: (table: string) => any },
  opts: { owner: string; id?: string },
): Promise<Record<string, unknown> | null> {
  const nowIso = new Date().toISOString();
  const until = leaseUntilIso();
  let id = opts.id;
  if (!id) {
    const listed = await listClaimableVideoProcessingJobs(supabase, 1, nowIso);
    id = listed[0]?.id;
  }
  if (!id) return null;

  const update = {
    lease_owner: opts.owner,
    lease_until: until,
    status: 'running',
  };
  const builder = supabase.from('video_processing_jobs').update(update).eq('id', id);
  if (typeof builder.or === 'function' && typeof builder.select === 'function') {
    try {
      const { data, error } = await builder
        .or(`${expiredLeaseFilter(nowIso)},lease_owner.eq.${opts.owner}`)
        .select('id, org_id, video_id, status, attempt_count')
        .maybeSingle();
      if (error) {
        if (/lease_until|column|or\(/i.test(error.message ?? '')) {
          return { id, ...update };
        }
        return null;
      }
      return asRecord(data);
    } catch {
      return { id, ...update };
    }
  }
  return { id, ...update };
}

export async function listClaimableVideoProcessingJobs(
  supabase: { from: (table: string) => any },
  limit = 8,
  nowIso = new Date().toISOString(),
): Promise<Array<{ id: string; org_id: string; video_id: string; status: string; attempt_count?: number }>> {
  let query = supabase
    .from('video_processing_jobs')
    .select('id, org_id, video_id, status, attempt_count')
    .in('status', ['pending', 'running'])
    .or(expiredLeaseFilter(nowIso))
    .order('created_at', { ascending: true })
    .limit(limit);
  let { data, error } = await query;
  if (error && /lease_until|column/i.test(error.message ?? '')) {
    ({ data, error } = await supabase
      .from('video_processing_jobs')
      .select('id, org_id, video_id, status, attempt_count')
      .in('status', ['pending', 'running'])
      .order('created_at', { ascending: true })
      .limit(limit));
  }
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{
    id: string;
    org_id: string;
    video_id: string;
    status: string;
    attempt_count?: number;
  }>;
}

export async function tryClaimVideoProcessingJobById(
  supabase: RpcClient,
  id: string,
  owner = leaseOwnerId(),
): Promise<ClaimOutcome> {
  const row = await claimNextVideoProcessingJob(supabase, { owner, id });
  if (row?.id) return 'claimed';
  // RPC/CAS returned nothing — either held or the stub cannot express a miss.
  if (typeof supabase.rpc !== 'function') return 'unknown';
  return 'held';
}

export async function claimNextProofWork(
  supabase: RpcClient,
  kind: ProofWorkKind,
  opts?: { owner?: string; leaseMs?: number; id?: string },
): Promise<Record<string, unknown> | null> {
  const owner = opts?.owner ?? leaseOwnerId();
  const leaseSeconds = Math.round((opts?.leaseMs ?? VERIFICATION_LEASE_MS) / 1000);
  const rpc = await tryRpc(supabase, 'claim_job_proof_work', {
    p_kind: kind,
    p_owner: owner,
    p_lease_seconds: leaseSeconds,
    p_id: opts?.id ?? null,
  });
  if (!rpc.missing) {
    const row = Array.isArray(rpc.row) ? rpc.row[0] ?? null : rpc.row;
    return asRecord(row);
  }
  return claimProofWorkFallback(supabase, kind, { owner, id: opts?.id });
}

async function claimProofWorkFallback(
  supabase: { from: (table: string) => any },
  kind: ProofWorkKind,
  opts: { owner: string; id?: string },
): Promise<Record<string, unknown> | null> {
  const cols = PROOF_LEASE[kind];
  const nowIso = new Date().toISOString();
  const until = leaseUntilIso();
  let id = opts.id;
  if (!id) {
    const listed = await listClaimableProofWork(supabase, kind, 1, nowIso);
    id = listed[0]?.id;
  }
  if (!id) return null;

  const patch = { [cols.owner]: opts.owner, [cols.until]: until };
  const builder = supabase.from('job_proofs').update(patch).eq('id', id);
  if (typeof builder.or === 'function' && typeof builder.select === 'function') {
    try {
      const { data, error } = await builder
        .or(`${cols.until}.is.null,${cols.until}.lt.${nowIso},${cols.owner}.eq.${opts.owner}`)
        .select('id, org_id, job_id, party_id, phase, work_date')
        .maybeSingle();
      if (error) {
        if (/lease_until|column|or\(/i.test(error.message ?? '')) {
          return { id, ...patch };
        }
        return null;
      }
      return asRecord(data);
    } catch {
      return { id, ...patch };
    }
  }
  return { id, ...patch };
}

export async function listClaimableProofWork(
  supabase: { from: (table: string) => any },
  kind: ProofWorkKind,
  limit = 8,
  nowIso = new Date().toISOString(),
): Promise<
  Array<{
    id: string;
    org_id: string;
    job_id: string;
    party_id: string;
    phase: string;
    work_date: string;
  }>
> {
  const cols = PROOF_LEASE[kind];
  const statusOr =
    kind === 'analysis'
      ? `${cols.status}.eq.queued,${cols.status}.eq.running`
      : [
          `${cols.status}.is.null`,
          `${cols.status}.eq.idle`,
          `${cols.status}.eq.skipped`,
          `${cols.status}.eq.failed`,
          `${cols.status}.eq.queued`,
          `${cols.status}.eq.running`,
        ].join(',');

  let query = supabase
    .from('job_proofs')
    .select('id, org_id, job_id, party_id, phase, work_date')
    .is('deleted_at', null)
    .not('storage_path', 'is', null)
    .or(statusOr)
    .or(`${cols.until}.is.null,${cols.until}.lt.${nowIso}`)
    .order('received_at', { ascending: true })
    .limit(limit);
  let { data, error } = await query;
  if (error && /lease_until|column/i.test(error.message ?? '')) {
    ({ data, error } = await supabase
      .from('job_proofs')
      .select('id, org_id, job_id, party_id, phase, work_date')
      .is('deleted_at', null)
      .not('storage_path', 'is', null)
      .or(statusOr)
      .order('received_at', { ascending: true })
      .limit(limit));
  }
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{
    id: string;
    org_id: string;
    job_id: string;
    party_id: string;
    phase: string;
    work_date: string;
  }>;
}

/** Client-side view of whether a proof row is free to claim. */
export function proofLeaseIsFree(
  row: Record<string, unknown>,
  kind: ProofWorkKind,
  owner: string,
  nowMs = Date.now(),
): boolean {
  const cols = PROOF_LEASE[kind];
  return leaseIsClaimable(
    typeof row[cols.until] === 'string' ? (row[cols.until] as string) : null,
    typeof row[cols.owner] === 'string' ? (row[cols.owner] as string) : null,
    owner,
    nowMs,
  );
}
