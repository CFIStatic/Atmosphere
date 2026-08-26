/**
 * Timestamped speech from a day-film microphone track.
 *
 * Vision dictation describes stills. This module is the soundtrack: chunk the
 * recording, send each piece to an OpenAI-compatible /audio/transcriptions
 * endpoint, and land segments on the same timeline as dictation entries.
 *
 * Speech is a proposal. A crew saying the drywall is done does not verify it.
 */

export const DEFAULT_CHUNK_SECONDS = 600;
export const DEFAULT_MAX_CHUNKS = 150;
export const MAX_SEGMENT_CHARS = 4000;

export type AudioChunkPlan = {
  index: number;
  startSeconds: number;
  durationSeconds: number;
};

export type TranscriptSegment = {
  startSeconds: number;
  endSeconds: number;
  text: string;
  confidence: number | null;
  noSpeechProb: number | null;
  chunkIndex: number;
};

export type WhisperSegment = {
  start?: number;
  end?: number;
  text?: string;
  avg_logprob?: number;
  no_speech_prob?: number;
};

export type WhisperVerboseBody = {
  text?: string;
  segments?: WhisperSegment[];
};

export function planAudioChunks(
  durationSeconds: number,
  opts?: { chunkSeconds?: number; maxChunks?: number },
): AudioChunkPlan[] {
  const duration = Math.max(0, Number(durationSeconds) || 0);
  if (duration <= 0) return [];
  const chunkSeconds = Math.max(15, Math.floor(opts?.chunkSeconds ?? DEFAULT_CHUNK_SECONDS));
  const maxChunks = Math.max(1, Math.floor(opts?.maxChunks ?? DEFAULT_MAX_CHUNKS));
  const plans: AudioChunkPlan[] = [];
  let start = 0;
  let index = 0;
  while (start < duration && index < maxChunks) {
    const remaining = duration - start;
    const span = Math.min(chunkSeconds, remaining);
    if (span < 0.5) break;
    plans.push({
      index,
      startSeconds: Math.round(start * 1000) / 1000,
      durationSeconds: Math.round(span * 1000) / 1000,
    });
    start += span;
    index += 1;
  }
  return plans;
}

export function clipText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_SEGMENT_CHARS);
}

export function logprobToConfidence(logprob: number | undefined): number | null {
  if (typeof logprob !== 'number' || !Number.isFinite(logprob)) return null;
  // Whisper avg_logprob is typically in [-1, 0]. Map to (0, 1].
  const confidence = Math.exp(logprob);
  if (!Number.isFinite(confidence)) return null;
  return Math.min(1, Math.max(0, Math.round(confidence * 10_000) / 10_000));
}

/**
 * Turn a Whisper verbose_json body (or a plain { text }) into timeline
 * segments. Chunk offset is added so a 10-minute slice at 1:00:00 lands at
 * 1:00:12, not 0:12.
 */
export function segmentsFromWhisperBody(
  body: WhisperVerboseBody,
  chunk: Pick<AudioChunkPlan, 'index' | 'startSeconds' | 'durationSeconds'>,
): TranscriptSegment[] {
  const offset = chunk.startSeconds;
  const chunkEnd = offset + chunk.durationSeconds;
  const raw = Array.isArray(body.segments) ? body.segments : [];
  const out: TranscriptSegment[] = [];

  for (const piece of raw) {
    const text = clipText(String(piece.text ?? ''));
    if (!text) continue;
    const noSpeech = typeof piece.no_speech_prob === 'number' ? piece.no_speech_prob : null;
    if (noSpeech != null && noSpeech >= 0.85) continue;
    const start = offset + Math.max(0, Number(piece.start) || 0);
    const endRaw = Number(piece.end);
    const end = offset + (Number.isFinite(endRaw) && endRaw >= 0 ? endRaw : Number(piece.start) || 0);
    out.push({
      startSeconds: Math.round(Math.min(start, chunkEnd) * 1000) / 1000,
      endSeconds: Math.round(Math.min(Math.max(end, start), chunkEnd) * 1000) / 1000,
      text,
      confidence: logprobToConfidence(piece.avg_logprob),
      noSpeechProb: noSpeech,
      chunkIndex: chunk.index,
    });
  }

  if (out.length) return out;

  const fallback = clipText(String(body.text ?? ''));
  if (!fallback) return [];
  return [
    {
      startSeconds: offset,
      endSeconds: Math.round(chunkEnd * 1000) / 1000,
      text: fallback,
      confidence: null,
      noSpeechProb: null,
      chunkIndex: chunk.index,
    },
  ];
}

/** Short grounded list for the LLM verifier. Speech cannot upgrade a visual miss. */
export function speechEvidenceSummary(segments: TranscriptSegment[], limit = 20): string[] {
  return segments
    .filter((s) => s.text.trim())
    .slice(0, limit)
    .map((s) => {
      const at = Math.round(s.startSeconds);
      return `[speech @ ${at}s — proposal only, not proof of completion] ${s.text}`;
    });
}

export function isSpeechQuestion(question: string): boolean {
  return /what did (they|he|she|the crew|anyone) say|said about|hear|heard|on the mic|microphone|speech|transcript/.test(
    question.toLowerCase(),
  );
}

export function serializeSpeech(segments: TranscriptSegment[]): Array<{
  atSeconds: number;
  endSeconds: number;
  text: string;
  confidence: number | null;
}> {
  return segments.map((s) => ({
    atSeconds: s.startSeconds,
    endSeconds: s.endSeconds,
    text: s.text,
    confidence: s.confidence,
  }));
}
