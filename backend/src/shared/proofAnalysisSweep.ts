/**
 * Catch every filed video that never got a reading.
 *
 * New uploads already enqueue vision + speech. Older rows — filed before
 * those queues existed, or lost on a process restart — sit at idle. This
 * pass claims them (CAS / SKIP LOCKED) and puts them on the same queues,
 * so Ask has a record for every clip on file, however long it is.
 */

import { unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import { queueProofTranscript } from '../audio/proofTranscript.js';
import { queueNarration, queueProofAnalysis } from '../routes/proofOfWork.js';
import { leaseIsHeld, leaseOwnerId } from '../verification/lease.js';
import { claimNextProofWork, type ProofWorkKind } from './outboxClaim.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SWEEP_LIMIT = 20;
const FIRST_DELAY_MS = 3_000;
const INTERVAL_MS = 30_000;

let timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval> | null = null;
let running = false;

export function needsNarration(
  status: string | null | undefined,
  _error?: string | null,
): boolean {
  if (!status || status === 'idle') return true;
  // Skipped (no model, no after pair, no frames) and failed rows still need a
  // reading of this file. Queued/running is the in-memory queue — a restart
  // loses it and the row sits forever unless we claim it again.
  if (status === 'skipped' || status === 'failed' || status === 'queued' || status === 'running') {
    return true;
  }
  return false;
}

export function needsTranscript(status: string | null | undefined): boolean {
  return (
    !status ||
    status === 'idle' ||
    status === 'failed' ||
    status === 'skipped' ||
    status === 'queued' ||
    status === 'running'
  );
}

/** Only work that was already asked for — do not invent day-analysis. */
export function needsAnalysisReclaim(status: string | null | undefined): boolean {
  return status === 'queued' || status === 'running';
}

export async function sweepUnanalyzedProofs(
  admin: any,
  opts?: {
    limit?: number;
    queueNarrationFn?: typeof queueNarration;
    queueTranscriptFn?: typeof queueProofTranscript;
    queueAnalysisFn?: typeof queueProofAnalysis;
  },
): Promise<{ narration: number; transcript: number; analysis: number }> {
  const limit = Math.max(1, Math.min(opts?.limit ?? SWEEP_LIMIT, 50));
  const enqueueNarration = opts?.queueNarrationFn ?? queueNarration;
  const enqueueTranscript = opts?.queueTranscriptFn ?? queueProofTranscript;
  const enqueueAnalysis = opts?.queueAnalysisFn ?? queueProofAnalysis;

  const { data, error } = await admin
    .from('job_proofs')
    .select(
      'id, org_id, job_id, party_id, phase, work_date, narration_status, narration_error, narration_lease_until, transcript_status, transcript_lease_until, analysis_status, analysis_lease_until, storage_path',
    )
    .is('deleted_at', null)
    .not('storage_path', 'is', null)
    .or(
      [
        'narration_status.is.null',
        'narration_status.eq.idle',
        'narration_status.eq.skipped',
        'narration_status.eq.failed',
        'narration_status.eq.queued',
        'narration_status.eq.running',
        'transcript_status.is.null',
        'transcript_status.eq.idle',
        'transcript_status.eq.failed',
        'transcript_status.eq.skipped',
        'transcript_status.eq.queued',
        'transcript_status.eq.running',
        'analysis_status.eq.queued',
        'analysis_status.eq.running',
      ].join(','),
    )
    .order('received_at', { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message);
  const rows = (data ?? []) as any[];

  let narration = 0;
  let transcript = 0;
  let analysis = 0;
  const owner = leaseOwnerId();
  for (const row of rows) {
    const party = { org_id: row.org_id, job_id: row.job_id, id: row.party_id };
    if (needsNarration(row.narration_status, row.narration_error) && !leaseIsHeld(row.narration_lease_until)) {
      if (await claimProofKind(admin, 'narration', row.id, owner)) {
        await enqueueNarration(admin, party, row.id, row.phase, row.work_date);
        narration += 1;
      }
    }
    if (needsTranscript(row.transcript_status) && !leaseIsHeld(row.transcript_lease_until)) {
      if (await claimProofKind(admin, 'transcript', row.id, owner)) {
        await enqueueTranscript(admin, row.id);
        transcript += 1;
      }
    }
    if (needsAnalysisReclaim(row.analysis_status) && !leaseIsHeld(row.analysis_lease_until)) {
      if (await claimProofKind(admin, 'analysis', row.id, owner)) {
        await enqueueAnalysis(admin, party, row.work_date, row.id);
        analysis += 1;
      }
    }
  }
  return { narration, transcript, analysis };
}

async function claimProofKind(
  admin: any,
  kind: ProofWorkKind,
  proofId: string,
  owner: string,
): Promise<boolean> {
  const claimed = await claimNextProofWork(admin, kind, { owner, id: proofId });
  return Boolean(claimed?.id);
}

async function tick(): Promise<void> {
  if (running) return;
  const admin = unscopedAdminOrNull();
  if (!admin) return;
  running = true;
  try {
    const result = await sweepUnanalyzedProofs(admin);
    if (result.narration || result.transcript || result.analysis) {
      console.log(
        `[proof-analysis] queued ${result.narration} unread clips, ${result.transcript} unheard clips, ${result.analysis} day readings`,
      );
    }
  } catch (err) {
    console.warn('[proof-analysis] sweep failed:', err instanceof Error ? err.message : err);
  } finally {
    running = false;
  }
}

export function startProofAnalysisSweep(): void {
  if (timer) return;
  timer = setTimeout(() => {
    void tick();
    timer = setInterval(() => void tick(), INTERVAL_MS);
    timer.unref?.();
  }, FIRST_DELAY_MS);
  timer.unref?.();
}

export function stopProofAnalysisSweep(): void {
  if (!timer) return;
  clearTimeout(timer);
  clearInterval(timer);
  timer = null;
}
