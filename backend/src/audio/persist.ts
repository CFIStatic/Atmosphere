/**
 * Replace transcript segments for a proof / verification video.
 * Re-runs wipe the previous reading so the office never sees two generations.
 */

import type { TranscriptSegment } from './transcript.js';

export type TranscriptParent = {
  orgId: string;
  jobId?: string | null;
  proofId?: string | null;
  videoId?: string | null;
  model?: string | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function replaceTranscriptSegments(
  admin: any,
  parent: TranscriptParent,
  segments: TranscriptSegment[],
): Promise<number> {
  if (parent.proofId) {
    await admin.from('audio_transcript_segments').delete().eq('proof_id', parent.proofId);
  }
  if (parent.videoId) {
    await admin.from('audio_transcript_segments').delete().eq('video_id', parent.videoId);
  }

  const rows = segments
    .map((s) => ({
      org_id: parent.orgId,
      job_id: parent.jobId ?? null,
      proof_id: parent.proofId ?? null,
      video_id: parent.videoId ?? null,
      start_seconds: s.startSeconds,
      end_seconds: s.endSeconds,
      text: s.text,
      confidence: s.confidence,
      no_speech_prob: s.noSpeechProb,
      model: parent.model ?? null,
      chunk_index: s.chunkIndex,
    }))
    .filter((row) => row.text);

  if (rows.length) {
    const { error } = await admin.from('audio_transcript_segments').insert(rows);
    if (error) throw new Error(error.message);
  }

  if (parent.proofId) {
    await admin
      .from('job_proofs')
      .update({
        transcript_status: 'done',
        transcript_error: null,
        transcript_model: parent.model ?? null,
        transcribed_at: new Date().toISOString(),
      })
      .eq('id', parent.proofId);
  }

  return rows.length;
}

export async function loadTranscriptSegments(
  admin: any,
  opts: { proofIds?: string[]; videoId?: string },
): Promise<
  Array<{
    proof_id: string | null;
    video_id: string | null;
    start_seconds: number;
    end_seconds: number;
    text: string;
    confidence: number | null;
  }>
> {
  if (opts.videoId) {
    const { data, error } = await admin
      .from('audio_transcript_segments')
      .select('proof_id, video_id, start_seconds, end_seconds, text, confidence')
      .eq('video_id', opts.videoId)
      .order('start_seconds');
    if (error) throw new Error(error.message);
    return data ?? [];
  }
  const ids = (opts.proofIds ?? []).filter(Boolean);
  if (!ids.length) return [];
  const { data, error } = await admin
    .from('audio_transcript_segments')
    .select('proof_id, video_id, start_seconds, end_seconds, text, confidence')
    .in('proof_id', ids)
    .order('start_seconds');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export function rowsToSpeech(
  rows: Array<{
    start_seconds: number;
    end_seconds: number;
    text: string;
    confidence: number | null;
  }>,
) {
  return rows.map((row) => ({
    atSeconds: Number(row.start_seconds),
    endSeconds: Number(row.end_seconds),
    text: String(row.text),
    confidence: row.confidence == null ? null : Number(row.confidence),
  }));
}
