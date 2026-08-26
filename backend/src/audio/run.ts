/**
 * Transcribe a filed day film from a signed URL (or local path).
 *
 * Chunks stay on disk only long enough to POST. Node never holds the video.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { transcribeAudioTimed } from '../lib/transcription.js';
import { extractAudioChunk, probeAudioTrack, withAudioWorkDir, type CommandRunner } from './extract.js';
import {
  planAudioChunks,
  segmentsFromWhisperBody,
  type AudioChunkPlan,
  type TranscriptSegment,
} from './transcript.js';
import { config } from '../config.js';

export type TranscribeVideoResult = {
  hasAudio: boolean;
  skippedReason: string | null;
  durationSeconds: number;
  chunks: number;
  segments: TranscriptSegment[];
  model: string;
};

export async function transcribeVideoFromSource(opts: {
  source: string;
  durationSeconds?: number | null;
  chunkSeconds?: number;
  maxChunks?: number;
  runner?: CommandRunner;
  transcribe?: typeof transcribeAudioTimed;
}): Promise<TranscribeVideoResult> {
  const runner = opts.runner;
  const transcribe = opts.transcribe ?? transcribeAudioTimed;
  const probe = await probeAudioTrack(opts.source, runner);
  const duration = Number(opts.durationSeconds ?? probe.durationSeconds ?? 0);
  const model = config.technician.transcription.model;

  if (!probe.hasAudio) {
    return {
      hasAudio: false,
      skippedReason: 'no_audio_track',
      durationSeconds: duration,
      chunks: 0,
      segments: [],
      model,
    };
  }

  const plans = planAudioChunks(duration > 0 ? duration : probe.durationSeconds ?? 0, {
    chunkSeconds: opts.chunkSeconds ?? config.audioTranscript.chunkSeconds,
    maxChunks: opts.maxChunks ?? config.audioTranscript.maxChunks,
  });

  if (!plans.length) {
    return {
      hasAudio: true,
      skippedReason: 'no_duration',
      durationSeconds: duration,
      chunks: 0,
      segments: [],
      model,
    };
  }

  const segments = await withAudioWorkDir(async (dir) => {
    const collected: TranscriptSegment[] = [];
    for (const chunk of plans) {
      const outPath = join(dir, `chunk-${chunk.index}.wav`);
      await extractAudioChunk({
        source: opts.source,
        startSeconds: chunk.startSeconds,
        durationSeconds: chunk.durationSeconds,
        outPath,
        runner,
      });
      const bytes = await readFile(outPath);
      if (!bytes.length) continue;
      const timed = await transcribe(bytes, 'audio/wav');
      collected.push(...segmentsFromWhisperBody(timed, chunk));
    }
    return collected;
  });

  return {
    hasAudio: true,
    skippedReason: null,
    durationSeconds: duration,
    chunks: plans.length,
    segments,
    model,
  };
}

export function chunkPlanForDuration(durationSeconds: number): AudioChunkPlan[] {
  return planAudioChunks(durationSeconds, {
    chunkSeconds: config.audioTranscript.chunkSeconds,
    maxChunks: config.audioTranscript.maxChunks,
  });
}
