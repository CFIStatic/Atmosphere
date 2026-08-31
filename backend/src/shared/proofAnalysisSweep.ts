/**
 * Catch every filed video that never got a reading.
 *
 * New uploads already enqueue vision + speech. Older rows — filed before
 * those queues existed, or lost on a process restart — sit at idle. This
 * pass finds them and puts them on the same queues, so Ask has a record
 * for every clip on file, however long it is.
 */

import { createAdminClient } from '../lib/supabase.js';
import { queueProofTranscript } from '../audio/proofTranscript.js';
import { queueNarration } from '../routes/proofOfWork.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SWEEP_LIMIT = 20;
const FIRST_DELAY_MS = 3_000;
const INTERVAL_MS = 5 * 60_000;

let timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval> | null = null;
let running = false;

export function needsNarration(
  status: string | null | undefined,
  _error?: string | null,
): boolean {
  if (!status || status === 'idle') return true;
  // Skipped (no model, no after pair, no frames) and failed rows still need a
  // reading of this file. Queued is the in-memory queue — a restart loses it
  // and the row sits queued forever unless we put it back on.
  if (status === 'skipped' || status === 'failed' || status === 'queued' || status === 'running') {
    return true;
  }
  return false;
}

export function needsTranscript(status: string | null | undefined): boolean {
  return !status || status === 'idle' || status === 'failed' || status === 'skipped';
}

export async function sweepUnanalyzedProofs(
  admin: any,
  opts?: {
    limit?: number;
    queueNarrationFn?: typeof queueNarration;
    queueTranscriptFn?: typeof queueProofTranscript;
  },
): Promise<{ narration: number; transcript: number }> {
  const limit = Math.max(1, Math.min(opts?.limit ?? SWEEP_LIMIT, 50));
  const enqueueNarration = opts?.queueNarrationFn ?? queueNarration;
  const enqueueTranscript = opts?.queueTranscriptFn ?? queueProofTranscript;
  const { data, error } = await admin
    .from('job_proofs')
    .select(
      'id, org_id, job_id, party_id, phase, work_date, narration_status, narration_error, transcript_status, storage_path',
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
      ].join(','),
    )
    .order('received_at', { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message);
  const rows = (data ?? []) as any[];

  let narration = 0;
  let transcript = 0;
  for (const row of rows) {
    const party = { org_id: row.org_id, job_id: row.job_id, id: row.party_id };
    if (needsNarration(row.narration_status, row.narration_error)) {
      await enqueueNarration(admin, party, row.id, row.phase, row.work_date);
      narration += 1;
    }
    if (needsTranscript(row.transcript_status)) {
      await enqueueTranscript(admin, row.id);
      transcript += 1;
    }
  }
  return { narration, transcript };
}

async function tick(): Promise<void> {
  if (running) return;
  const admin = createAdminClient();
  if (!admin) return;
  running = true;
  try {
    const result = await sweepUnanalyzedProofs(admin);
    if (result.narration || result.transcript) {
      console.log(
        `[proof-analysis] queued ${result.narration} unread clips and ${result.transcript} unheard clips`,
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
