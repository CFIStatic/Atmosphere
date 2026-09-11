/**
 * Permanently remove videos whose Global Admin delete queue has elapsed.
 *
 * Fits the same sold-path worker pattern as proofAnalysisSweep: interval timer
 * started from index.ts when WORKER_ROLE runs workers. Skips legal-hold rows.
 */
import { unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import { purgeWindowElapsed } from '../lib/videoDeletePolicy.js';
import { jobHasOpenHold } from '../legal/holds.js';
import { recordUserAction } from '../legal/monitor.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PROOF_BUCKET = 'job-proofs';
const SWEEP_LIMIT = 25;
const FIRST_DELAY_MS = 8_000;
const INTERVAL_MS = 60_000;

let timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval> | null = null;
let running = false;

export type PurgeCandidate = {
  id: string;
  org_id: string;
  job_id: string | null;
  storage_path: string | null;
  legal_hold: boolean | null;
  scheduled_purge_at: string;
};

export async function permanentlyPurgeProof(
  admin: any,
  proof: PurgeCandidate,
  opts?: { now?: Date; recordAction?: boolean },
): Promise<'purged' | 'skipped_hold' | 'skipped_window'> {
  const now = opts?.now ?? new Date();
  if (!purgeWindowElapsed(proof.scheduled_purge_at, now)) return 'skipped_window';
  if (proof.legal_hold) return 'skipped_hold';
  if (proof.job_id && (await jobHasOpenHold(proof.job_id, proof.org_id))) {
    return 'skipped_hold';
  }

  const paths: string[] = [];
  if (proof.storage_path) paths.push(proof.storage_path);

  const { data: frames } = await admin
    .from('job_proof_frames')
    .select('storage_path')
    .eq('proof_id', proof.id);
  for (const row of (frames ?? []) as Array<{ storage_path?: string | null }>) {
    if (row.storage_path) paths.push(row.storage_path);
  }

  if (paths.length) {
    // Storage remove is best-effort; DB row delete is the source of truth that
    // the clip is gone. Retry on a later sweep if bytes linger.
    try {
      await admin.storage.from(PROOF_BUCKET).remove(paths);
    } catch (err) {
      console.warn('[purge] storage remove failed:', err instanceof Error ? err.message : err);
    }
  }

  const { error } = await admin.from('job_proofs').delete().eq('id', proof.id);
  if (error) throw new Error(error.message);

  if (opts?.recordAction !== false) {
    await recordUserAction({
      actorUserId: null,
      actorLabel: 'Atmosphere',
      orgId: proof.org_id,
      action: 'video.purged',
      resourceType: 'proof',
      resourceId: proof.id,
      detail: { jobId: proof.job_id, scheduledPurgeAt: proof.scheduled_purge_at },
    });
  }

  return 'purged';
}

export async function sweepExpiredProofPurges(
  admin: any,
  opts?: { limit?: number; now?: Date },
): Promise<{ purged: number; skippedHold: number; scanned: number }> {
  const limit = Math.max(1, Math.min(opts?.limit ?? SWEEP_LIMIT, 100));
  const now = opts?.now ?? new Date();
  const nowIso = now.toISOString();

  const { data, error } = await admin
    .from('job_proofs')
    .select('id, org_id, job_id, storage_path, legal_hold, scheduled_purge_at')
    .not('scheduled_purge_at', 'is', null)
    .lte('scheduled_purge_at', nowIso)
    .order('scheduled_purge_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as PurgeCandidate[];
  let purged = 0;
  let skippedHold = 0;
  for (const row of rows) {
    const result = await permanentlyPurgeProof(admin, row, { now });
    if (result === 'purged') purged += 1;
    else if (result === 'skipped_hold') skippedHold += 1;
  }
  return { purged, skippedHold, scanned: rows.length };
}

async function tick(): Promise<void> {
  if (running) return;
  const admin = unscopedAdminOrNull();
  if (!admin) return;
  running = true;
  try {
    const result = await sweepExpiredProofPurges(admin);
    if (result.purged || result.skippedHold) {
      console.info('[purge]', result);
    }
  } catch (err) {
    console.warn('[purge] sweep failed:', err instanceof Error ? err.message : err);
  } finally {
    running = false;
  }
}

export function startProofPurgeSweep(): void {
  if (timer) return;
  timer = setTimeout(() => {
    void tick();
    timer = setInterval(() => void tick(), INTERVAL_MS);
  }, FIRST_DELAY_MS);
}

export function stopProofPurgeSweep(): void {
  if (!timer) return;
  clearTimeout(timer as ReturnType<typeof setTimeout>);
  clearInterval(timer as ReturnType<typeof setInterval>);
  timer = null;
}
