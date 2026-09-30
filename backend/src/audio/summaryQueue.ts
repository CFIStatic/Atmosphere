/**
 * Rebuild a clip's AI summary after its transcript changes.
 *
 * Every transcript write marks the row `summary_status = 'stale'` in the same
 * update and calls queueSummaryRefresh. The rebuild runs on a RetryQueue, the
 * same in-process retry queue the day analysis uses, so a model flake is
 * retried with backoff and a terminal failure lands on the row as `failed`
 * with the reason, instead of being swallowed. The analysis sweep also calls
 * sweepStaleSummaries so a row whose in-memory job was lost on a restart is
 * picked up again.
 *
 * What gets rebuilt is everything enrichProofConversation derives from the
 * transcript: ai_findings.conversation (the "AI summary"), the evidence log
 * and the people log. The rebuild stamps the sha256 of the transcript it read,
 * so a summary that no longer matches the live transcript is detectable.
 */

import { unscopedAdminOrNull, writerForJob } from '../lib/scopedAdmin.js';
import { RetryQueue } from '../shared/retryQueue.js';
import { shouldRunSoldPathWorkers } from '../bootFlags.js';
import { leaseUntilIso } from '../verification/lease.js';
import { enrichProofConversation } from './proofConversation.js';
import { transcriptSha256 } from './summaryFreshness.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface SummaryJob {
  key: string;
  proofId: string;
}

export type SummaryRefreshDeps = {
  enrich?: (admin: any, proofId: string) => Promise<unknown>;
  now?: () => Date;
};

export class TranscriptMovedError extends Error {
  constructor() {
    super('The transcript changed while the summary was being rebuilt.');
    this.name = 'TranscriptMovedError';
  }
}

/**
 * One rebuild. Throws when the transcript moved underneath it, so the queue
 * retries against the newer text rather than stamping a summary as fresh.
 */
export async function refreshProofSummary(admin: any, proofId: string, deps?: SummaryRefreshDeps): Promise<void> {
  const enrich = deps?.enrich ?? ((client: any, id: string) => enrichProofConversation(client, id));
  await admin
    .from('job_proofs')
    .update({ summary_status: 'running', summary_lease_until: leaseUntilIso() })
    .eq('id', proofId);

  await enrich(admin, proofId);

  const { data } = await admin
    .from('job_proofs')
    .select('transcript_text, summary_transcript_sha256')
    .eq('id', proofId)
    .maybeSingle();
  const live = transcriptSha256(data?.transcript_text ?? null);
  if (!data || data.summary_transcript_sha256 !== live) throw new TranscriptMovedError();

  // Compare-and-set on the status this rebuild set. A transcript write in the
  // window after the read above sets stale (then queued) in the same update as
  // the new text; the hash column is left behind, so matching it would not
  // notice. Stamping done over that row hides it from the sweep, which never
  // lists done. A miss throws so this in-flight job retries the newer text —
  // the enqueue for it was dropped while this key was still running.
  const { data: stamped, error: stampError } = await admin
    .from('job_proofs')
    .update({ summary_status: 'done', summary_error: null, summary_lease_until: null })
    .eq('id', proofId)
    .eq('summary_status', 'running')
    .select('id')
    .maybeSingle();
  if (stampError || !stamped?.id) throw new TranscriptMovedError();

  // Voice match is separate from the summary. A missing sample or table must
  // not send the summary back through the retry queue.
  try {
    const { matchProofSpeakers } = await import('./speakerClipApply.js');
    await matchProofSpeakers(admin, proofId);
  } catch (err) {
    console.warn('[speaker-identity] voice match failed:', err instanceof Error ? err.message : err);
  }
}

async function adminForProof(proofId: string) {
  const raw = unscopedAdminOrNull();
  if (!raw) return null;
  const { data } = await raw.from('job_proofs').select('org_id, job_id').eq('id', proofId).maybeSingle();
  if (!data?.org_id || !data?.job_id) return raw;
  return writerForJob({ orgId: data.org_id as string, jobId: data.job_id as string }, raw).raw;
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Summary rebuild failed.';
}

export function createSummaryQueue(opts?: {
  getAdmin?: (proofId: string) => Promise<any>;
  deps?: SummaryRefreshDeps;
  delaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
}): RetryQueue<SummaryJob> {
  const getAdmin = opts?.getAdmin ?? adminForProof;
  return new RetryQueue<SummaryJob>({
    run: async (job) => {
      const admin = await getAdmin(job.proofId);
      if (!admin) throw new Error('Storage is not configured.');
      await refreshProofSummary(admin, job.proofId, opts?.deps);
    },
    onGaveUp: async (job, error) => {
      const detail = errorText(error);
      console.warn(`[summary] rebuild gave up proof=${job.proofId} error=${detail.slice(0, 200)}`);
      const admin = await getAdmin(job.proofId);
      if (!admin) return;
      // Same race as the done write: only fail a row this rebuild still owns.
      // A newer transcript has already set stale or queued, and the sweep
      // reclaims those. Overwriting them with failed would strand the clip.
      await admin
        .from('job_proofs')
        .update({ summary_status: 'failed', summary_error: detail, summary_lease_until: null })
        .eq('id', job.proofId)
        .eq('summary_status', 'running');
    },
    delaysMs: opts?.delaysMs,
    sleep: opts?.sleep,
  });
}

let summaryQueue: RetryQueue<SummaryJob> | null = null;
function defaultQueue(): RetryQueue<SummaryJob> {
  summaryQueue ??= createSummaryQueue();
  return summaryQueue;
}

export type SummaryEnqueue = (job: SummaryJob) => boolean;

/**
 * Mark queued and hand to the retry queue. Never throws: a transcript write
 * must not fail because the summary could not be queued; the row stays
 * `stale` and the sweep picks it up.
 */
export async function queueSummaryRefresh(
  admin: any,
  proofId: string,
  opts?: { enqueue?: SummaryEnqueue; runWorkers?: boolean },
): Promise<boolean> {
  try {
    const runWorkers = opts?.runWorkers ?? shouldRunSoldPathWorkers();
    if (!runWorkers) return false;
    await admin.from('job_proofs').update({ summary_status: 'queued' }).eq('id', proofId);
    const enqueue = opts?.enqueue ?? ((job: SummaryJob) => defaultQueue().enqueue(job));
    enqueue({ key: `summary:${proofId}`, proofId });
    return true;
  } catch {
    return false;
  }
}

const SWEEP_LIMIT = 20;

/**
 * Re-queue summaries a lost process left behind: `stale` rows, `queued` rows
 * (the in-memory queue dedupes by key, so a row already waiting is not run
 * twice in this process), and `running` rows whose lease ran out.
 */
export async function sweepStaleSummaries(
  admin: any,
  opts?: { limit?: number; enqueue?: SummaryEnqueue; now?: Date },
): Promise<number> {
  const limit = Math.max(1, Math.min(opts?.limit ?? SWEEP_LIMIT, 100));
  const { data, error } = await admin
    .from('job_proofs')
    .select('id, summary_status, summary_lease_until')
    .is('deleted_at', null)
    .in('summary_status', ['stale', 'queued', 'running'])
    .order('received_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message || 'Could not list stale summaries.');
  const now = (opts?.now ?? new Date()).getTime();
  const enqueue = opts?.enqueue ?? ((job: SummaryJob) => defaultQueue().enqueue(job));
  let queued = 0;
  for (const row of (data ?? []) as Array<{ id: string; summary_status: string; summary_lease_until: string | null }>) {
    if (row.summary_status === 'running') {
      const lease = row.summary_lease_until ? Date.parse(row.summary_lease_until) : NaN;
      if (Number.isFinite(lease) && lease > now) continue;
    }
    // CAS on the status we read so two sweeps do not both claim a row.
    const { data: claimed, error: claimError } = await admin
      .from('job_proofs')
      .update({ summary_status: 'queued' })
      .eq('id', row.id)
      .eq('summary_status', row.summary_status)
      .select('id')
      .maybeSingle();
    if (claimError || !claimed?.id) continue;
    enqueue({ key: `summary:${row.id}`, proofId: String(row.id) });
    queued += 1;
  }
  return queued;
}
