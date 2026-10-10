/**
 * Worker for the full-coverage base timeline (VIDEO_BASE_TIMELINE, off by
 * default). Per segment: keyframes every N s + dead-time signals (ffmpeg),
 * Flash-Lite captions with a Flash re-read for unsure frames. When every
 * segment of a recording is settled, the minute timeline is assembled from
 * captions + the clip's timed Whisper transcript and saved to video_timelines.
 */

import { leaseOwnerId } from '../verification/lease.js';
import { withVideoUsageScope } from '../metering/backgroundUsage.js';
import { modelPriceTable, tokenCostNanos } from '../metering/modelPriceTable.js';
import { baseTimelineFlags as F } from './flags.js';
import { captionFrames, type FrameCaption, type GeminiCall } from './captions.js';
import { readSegmentMedia, type SegmentMedia } from './media.js';
import { buildMinuteTimeline, timelineCoverage, type TimedLine } from './timeline.js';
import { claimSegment, completeSegment, enqueueSegments, failSegment, loadSegments, type SegmentJobRow } from './segmentJobs.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PROOF_BUCKET = 'job-proofs';

export type SegmentWorkerDeps = {
  readMedia?: (input: Parameters<typeof readSegmentMedia>[0]) => Promise<SegmentMedia>;
  call?: GeminiCall;
  signUrl?: (admin: any, storagePath: string) => Promise<string>;
};

async function defaultSignUrl(admin: any, storagePath: string): Promise<string> {
  const { data, error } = await admin.storage.from(PROOF_BUCKET).createSignedUrl(storagePath, 3600);
  if (error || !data?.signedUrl) throw new Error(`sign url: ${error?.message ?? 'no url'}`);
  return data.signedUrl as string;
}

/** Hook for the upload pipeline. No-op unless the switch is on. */
export async function maybeEnqueueBaseTimeline(admin: any, proof: { id: string; org_id: string; duration_seconds: number | null }): Promise<number> {
  if (!F.enabled()) return 0;
  const d = Number(proof.duration_seconds);
  if (!(d > 0)) return 0;
  return enqueueSegments(admin, { proofId: proof.id, orgId: proof.org_id, durationSeconds: d, segmentSeconds: F.segmentSeconds() });
}

export async function processSegment(admin: any, row: SegmentJobRow, deps: SegmentWorkerDeps = {}): Promise<{ captions: FrameCaption[]; signals: SegmentMedia['signals']; costNanos: number }> {
  const { data: proof, error } = await admin.from('job_proofs').select('storage_path').eq('id', row.proof_id).maybeSingle();
  if (error || !proof?.storage_path) throw new Error('proof media not found');
  const url = await (deps.signUrl ?? defaultSignUrl)(admin, proof.storage_path);
  const media = await (deps.readMedia ?? readSegmentMedia)({
    url,
    startSeconds: Number(row.start_seconds),
    endSeconds: Number(row.end_seconds),
    intervalSeconds: F.captionIntervalSeconds(),
    width: F.frameWidth(),
  });
  const table = modelPriceTable();
  let costNanos = 0;
  const captions = await captionFrames(media.frames, {
    model: F.captionModel(),
    rereadModel: F.rereadModel(),
    rereadBelow: F.rereadBelow(),
    batch: F.captionBatch(),
    call: deps.call,
    onUsage: ({ model, usage }) => {
      if (usage) costNanos += tokenCostNanos(table, { modelId: model, tokens: usage as any });
    },
  });
  return { captions, signals: media.signals, costNanos };
}

/** Assemble and save the timeline when no segment is still queued or running. Returns null while work remains. */
export async function assembleTimelineIfSettled(admin: any, proofId: string): Promise<{ coveragePct: number } | null> {
  const segs = await loadSegments(admin, proofId);
  if (!segs.length || segs.some((s) => s.status === 'queued' || s.status === 'running')) return null;
  const { data: proof } = await admin
    .from('job_proofs')
    .select('org_id, duration_seconds, transcript_segments')
    .eq('id', proofId)
    .maybeSingle();
  const duration = Number(proof?.duration_seconds) || Math.max(...segs.map((s) => Number(s.end_seconds)));
  const transcript: TimedLine[] = Array.isArray(proof?.transcript_segments)
    ? proof.transcript_segments
        .filter((s: any) => s && Number.isFinite(Number(s.start)) && typeof s.text === 'string')
        .map((s: any) => ({ start: Number(s.start), end: Number(s.end ?? s.start), text: s.text, speaker: s.speaker ?? null }))
    : [];
  const captions = segs.flatMap((s) => (s.output?.captions ?? []) as FrameCaption[]);
  const signals = segs.flatMap((s) => (s.output?.signals ?? []) as SegmentMedia['signals']);
  const minutes = buildMinuteTimeline({ durationSeconds: duration, captions, transcript, signals });
  const coverage = timelineCoverage(minutes, duration);
  const { error } = await admin.from('video_timelines').upsert({
    proof_id: proofId,
    org_id: proof?.org_id ?? segs[0]!.org_id,
    minutes,
    coverage_pct: Math.round(coverage.pct * 100) / 100,
    segment_count: segs.length,
    cost_nanos: segs.reduce((a, s) => a + Number(s.cost_nanos || 0), 0),
    caption_model: F.captionModel(),
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`save timeline: ${error.message}`);
  return { coveragePct: coverage.pct };
}

/** Claim and run one segment. Returns false when there was nothing to do. */
export async function runSegmentWorkerOnce(admin: any, deps: SegmentWorkerDeps = {}, owner = leaseOwnerId()): Promise<boolean> {
  if (!F.enabled()) return false;
  const row = await claimSegment(admin, owner);
  if (!row) return false;
  try {
    const out = await withVideoUsageScope(admin, { proofId: row.proof_id, orgId: row.org_id }, () => processSegment(admin, row, deps));
    await completeSegment(admin, row.id, owner, { captions: out.captions, signals: out.signals }, out.costNanos);
  } catch (err) {
    await failSegment(admin, row, owner, err instanceof Error ? err.message : String(err), F.maxAttempts());
  }
  await assembleTimelineIfSettled(admin, row.proof_id);
  return true;
}

let timer: NodeJS.Timeout | null = null;

/** Start a polling loop. No-op unless VIDEO_BASE_TIMELINE=true. */
export function startSegmentWorker(getAdmin: () => any, intervalMs = 5000): boolean {
  if (!F.enabled() || timer) return false;
  let busy = false;
  timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const admin = getAdmin();
      if (admin) while (await runSegmentWorkerOnce(admin)) { /* drain */ }
    } catch (err) {
      console.warn('[base-timeline] worker error', err instanceof Error ? err.message : err);
    } finally {
      busy = false;
    }
  }, intervalMs);
  timer.unref?.();
  return true;
}

/**
 * Called from the proof-analysis sweep. Off unless VIDEO_BASE_TIMELINE=true.
 * Enqueues recordings whose transcript is done and that have no segments yet,
 * then runs up to `maxSegments` segment jobs (resuming any left by a restart).
 */
export async function sweepBaseTimeline(admin: any, opts: { maxSegments?: number; deps?: SegmentWorkerDeps } = {}): Promise<{ enqueued: number; ran: number }> {
  if (!F.enabled()) return { enqueued: 0, ran: 0 };
  let enqueued = 0;
  const { data: proofs } = await admin
    .from('job_proofs')
    .select('id, org_id, duration_seconds')
    .eq('transcript_status', 'done')
    .is('deleted_at', null)
    .gt('duration_seconds', 0)
    .order('created_at', { ascending: false })
    .limit(20);
  for (const p of (proofs ?? []) as Array<{ id: string; org_id: string; duration_seconds: number | null }>) {
    const { count } = await admin.from('video_segment_jobs').select('id', { count: 'exact', head: true }).eq('proof_id', p.id);
    if (!count) enqueued += await maybeEnqueueBaseTimeline(admin, p);
  }
  let ran = 0;
  const max = opts.maxSegments ?? 6;
  while (ran < max && (await runSegmentWorkerOnce(admin, opts.deps))) ran += 1;
  return { enqueued, ran };
}
