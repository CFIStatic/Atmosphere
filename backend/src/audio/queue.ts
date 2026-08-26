/**
 * In-process queue for day-film transcription.
 *
 * Same shape as narration: upload returns immediately, this drains in the
 * background. Rows record queued/running/failed so a restart can pick them up.
 */

import { createAdminClient } from '../lib/supabase.js';
import { transcriptionEnabled } from '../lib/transcription.js';
import { RetryQueue } from '../shared/retryQueue.js';
import { config } from '../config.js';
import { transcribeVideoFromSource } from './run.js';
import { replaceTranscriptSegments } from './persist.js';

const PROOF_BUCKET = 'job-proofs';

interface TranscriptJob {
  key: string;
  proofId: string;
  orgId: string;
  jobId: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

async function performTranscript(admin: any, job: TranscriptJob): Promise<void> {
  await admin
    .from('job_proofs')
    .update({ transcript_status: 'running', transcript_error: null })
    .eq('id', job.proofId);

  if (!transcriptionEnabled()) {
    await admin
      .from('job_proofs')
      .update({
        transcript_status: 'skipped',
        transcript_error: 'Speech-to-text is not configured.',
      })
      .eq('id', job.proofId);
    return;
  }

  const { data: proof } = await admin
    .from('job_proofs')
    .select('id, storage_path, duration_seconds, org_id, job_id, transcript_status')
    .eq('id', job.proofId)
    .maybeSingle();
  if (!proof?.storage_path) {
    await admin
      .from('job_proofs')
      .update({
        transcript_status: 'skipped',
        transcript_error: 'No stored video to transcribe.',
      })
      .eq('id', job.proofId);
    return;
  }

  const { data: signed, error: signErr } = await admin.storage
    .from(PROOF_BUCKET)
    .createSignedUrl(proof.storage_path, 60 * 60);
  if (signErr || !signed?.signedUrl) {
    throw new Error(signErr?.message ?? 'Could not mint a signed URL for transcription.');
  }

  const result = await transcribeVideoFromSource({
    source: signed.signedUrl,
    durationSeconds: Number(proof.duration_seconds ?? 0) || null,
  });

  if (result.skippedReason === 'no_audio_track') {
    await admin
      .from('job_proofs')
      .update({
        transcript_status: 'skipped',
        transcript_error: 'No microphone track on the stored file.',
      })
      .eq('id', job.proofId);
    return;
  }

  await replaceTranscriptSegments(
    admin,
    {
      orgId: job.orgId,
      jobId: job.jobId,
      proofId: job.proofId,
      model: result.model,
    },
    result.segments,
  );
}

const transcriptQueue = new RetryQueue<TranscriptJob>({
  delaysMs: [2_000, 15_000, 60_000],
  run: async (job) => {
    const admin = createAdminClient();
    if (!admin) throw new Error('Storage is not configured.');
    await performTranscript(admin, job);
  },
  onGaveUp: async (job, error) => {
    const admin = createAdminClient();
    if (!admin) return;
    await admin
      .from('job_proofs')
      .update({
        transcript_status: 'failed',
        transcript_error: error instanceof Error ? error.message : 'Transcription failed.',
      })
      .eq('id', job.proofId);
  },
});

export async function queueTranscript(
  admin: any,
  input: { proofId: string; orgId: string; jobId: string },
): Promise<void> {
  if (!config.audioTranscript.fromProof) {
    await admin
      .from('job_proofs')
      .update({
        transcript_status: 'skipped',
        transcript_error: 'Day-film transcription is disabled.',
      })
      .eq('id', input.proofId);
    return;
  }
  await admin.from('job_proofs').update({ transcript_status: 'queued' }).eq('id', input.proofId);
  transcriptQueue.enqueue({
    key: `transcript:${input.proofId}`,
    proofId: input.proofId,
    orgId: input.orgId,
    jobId: input.jobId,
  });
}

export async function recoverQueuedTranscripts(): Promise<number> {
  const admin = createAdminClient();
  if (!admin || !config.audioTranscript.fromProof) return 0;
  const { data, error } = await admin
    .from('job_proofs')
    .select('id, org_id, job_id')
    .in('transcript_status', ['queued', 'running'])
    .limit(25);
  if (error || !data?.length) return 0;
  for (const row of data) {
    transcriptQueue.enqueue({
      key: `transcript:${row.id}`,
      proofId: row.id,
      orgId: row.org_id,
      jobId: row.job_id,
    });
  }
  return data.length;
}

let recoverTimer: ReturnType<typeof setInterval> | null = null;

export function startTranscriptWorker(): void {
  void recoverQueuedTranscripts().catch((err) => {
    console.warn('[transcript.recover]', err instanceof Error ? err.message : err);
  });
  if (recoverTimer) return;
  recoverTimer = setInterval(() => {
    void recoverQueuedTranscripts().catch((err) => {
      console.warn('[transcript.recover]', err instanceof Error ? err.message : err);
    });
  }, 60_000);
  recoverTimer.unref?.();
}

export function stopTranscriptWorker(): void {
  if (recoverTimer) {
    clearInterval(recoverTimer);
    recoverTimer = null;
  }
}
