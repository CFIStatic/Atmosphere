/**
 * Pipeline stages: probe the soundtrack, then transcribe it.
 *
 * extract_audio never stores a sidecar — it records whether a mic track
 * exists and how the file will be chunked. transcribe_audio does the work
 * against a signed URL so the BFF never streams the day film.
 */

import { transcriptionEnabled } from '../../lib/transcription.js';
import { probeAudioTrack } from '../../audio/extract.js';
import { chunkPlanForDuration, transcribeVideoFromSource } from '../../audio/run.js';
import { loadTranscriptSegments, replaceTranscriptSegments } from '../../audio/persist.js';
import { speechEvidenceSummary } from '../../audio/transcript.js';
import { verificationConfig } from '../config.js';
import type { PipelineContext } from '../pipeline/orchestrator.js';

async function signedVideoUrl(ctx: PipelineContext): Promise<{
  url: string;
  proofId: string | null;
  durationSeconds: number | null;
  storagePath: string;
}> {
  const { data: video, error } = await ctx.supabase
    .from('verification_videos')
    .select('storage_path, proof_id, duration_seconds')
    .eq('id', ctx.videoId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!video?.storage_path) throw new Error('Verification video has no storage path.');

  const { data: signed, error: signErr } = await ctx.supabase.storage
    .from(verificationConfig.bucket)
    .createSignedUrl(video.storage_path, 60 * 60);
  if (signErr || !signed?.signedUrl) {
    throw new Error(signErr?.message ?? 'Could not mint a signed URL for audio extract.');
  }
  return {
    url: signed.signedUrl,
    proofId: video.proof_id ?? null,
    durationSeconds: video.duration_seconds == null ? null : Number(video.duration_seconds),
    storagePath: video.storage_path,
  };
}

export function createExtractAudioHandler(): (
  ctx: PipelineContext,
) => Promise<{ output: Record<string, unknown>; skip?: boolean }> {
  return async (ctx) => {
    const localPath = ctx.config._localVideoPath as string | undefined;
    const source = localPath ?? (await signedVideoUrl(ctx)).url;
    const probe = await probeAudioTrack(source);
    const duration = probe.durationSeconds ?? 0;
    const chunks = chunkPlanForDuration(duration);
    return {
      output: {
        hasAudio: probe.hasAudio,
        codec: probe.codec,
        durationSeconds: probe.durationSeconds,
        chunks: chunks.length,
      },
      skip: !probe.hasAudio,
    };
  };
}

export function createTranscribeAudioHandler(): (
  ctx: PipelineContext,
) => Promise<{ output: Record<string, unknown>; skip?: boolean }> {
  return async (ctx) => {
    if (!transcriptionEnabled()) {
      return { output: { skipped: true, reason: 'transcription_unconfigured' }, skip: true };
    }

    const existing = await loadTranscriptSegments(ctx.supabase, { videoId: ctx.videoId });
    if (existing.length) {
      return { output: { reused: true, segments: existing.length }, skip: true };
    }

    const video = await signedVideoUrl(ctx);
    if (video.proofId) {
      const proofExisting = await loadTranscriptSegments(ctx.supabase, { proofIds: [video.proofId] });
      if (proofExisting.length) {
        return { output: { reused: true, fromProof: true, segments: proofExisting.length }, skip: true };
      }
    }

    const result = await transcribeVideoFromSource({
      source: video.url,
      durationSeconds: video.durationSeconds,
    });

    if (!result.hasAudio) {
      return { output: { skipped: true, reason: 'no_audio_track' }, skip: true };
    }

    const written = await replaceTranscriptSegments(
      ctx.supabase,
      {
        orgId: ctx.orgId,
        jobId: ctx.jobId,
        proofId: video.proofId,
        videoId: ctx.videoId,
        model: result.model,
      },
      result.segments,
    );

    return {
      output: {
        segments: written,
        chunks: result.chunks,
        model: result.model,
      },
    };
  };
}

/** Speech proposals for the LLM verifier — never treated as completion. */
export async function speechProposalsForVideo(
  ctx: PipelineContext,
): Promise<string[]> {
  const rows = await loadTranscriptSegments(ctx.supabase, { videoId: ctx.videoId });
  return speechEvidenceSummary(
    rows.map((row) => ({
      startSeconds: Number(row.start_seconds),
      endSeconds: Number(row.end_seconds),
      text: String(row.text),
      confidence: row.confidence == null ? null : Number(row.confidence),
      noSpeechProb: null,
      chunkIndex: 0,
    })),
  );
}
