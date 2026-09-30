/**
 * Compare each diarized speaker on a clip to consented voiceprints.
 * Time ranges come from the transcript lines. One unlabeled speaker uses the
 * whole clip. Several unlabeled lines stay one unidentified speaker.
 */

import { decodeWavPcm, embedSpeakerRanges } from './speakerEmbedding.js';
import { bestVoiceMatch, type MatchThresholds, type VoiceprintCandidate } from './speakerMatch.js';
import type { TranscriptLine } from './speakerNamePickup.js';
import type { VoiceMatch } from './speakerMatch.js';

export type TimedVoiceMatch = VoiceMatch & {
  speakerLabel: string;
  tSec: number | null;
  quote: string | null;
};

function rangesFor(lines: TranscriptLine[]): Array<{ startSec: number; endSec: number }> {
  const timed = lines.filter((line) => line.tSec != null);
  return timed.map((line, index) => {
    const start = line.tSec ?? 0;
    const next = timed[index + 1]?.tSec;
    const end = next != null && next > start ? next : start + 4;
    return { startSec: start, endSec: end };
  });
}

export function matchSpeakersInWav(
  wav: Uint8Array,
  lines: TranscriptLine[],
  prints: VoiceprintCandidate[],
  uploaderOrgId: string,
  thresholds?: MatchThresholds,
): TimedVoiceMatch[] {
  if (!prints.length || !wav.length) return [];
  let samples: Float32Array;
  let sampleRate: number;
  try {
    ({ samples, sampleRate } = decodeWavPcm(wav));
  } catch {
    return [];
  }
  const groups = new Map<string, TranscriptLine[]>();
  for (const line of lines) {
    const label = line.speakerLabel?.trim() || 'Unidentified speaker';
    const list = groups.get(label) ?? [];
    list.push(line);
    groups.set(label, list);
  }
  if (!groups.size) groups.set('Unidentified speaker', []);
  const matches: TimedVoiceMatch[] = [];
  for (const [speakerLabel, group] of groups) {
    const ranges = rangesFor(group);
    const embedding = ranges.length
      ? embedSpeakerRanges(samples, sampleRate, ranges)
      : embedSpeakerRanges(samples, sampleRate, [{ startSec: 0, endSec: samples.length / sampleRate }]);
    if (!embedding) continue;
    const best = bestVoiceMatch(embedding, prints, uploaderOrgId, thresholds);
    if (!best) continue;
    const first = group[0];
    matches.push({
      ...best,
      speakerLabel,
      tSec: first?.tSec ?? null,
      quote: first?.text ?? null,
    });
  }
  return matches;
}
