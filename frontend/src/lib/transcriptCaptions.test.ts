import { describe, expect, it } from 'vitest';
import {
  activeCaptionAt,
  buildWebVtt,
  CAPTION_MAX_CHARS,
  captionCuesFromTranscript,
  captionLinesAt,
  parseTimestampedTranscript,
  rollingCaptionAt,
  webVttFromTranscript,
  type CaptionWord,
} from './transcriptCaptions';

describe('transcriptCaptions', () => {
  it('parses [m:ss] Whisper lines into segments', () => {
    const rows = parseTimestampedTranscript(
      '[0:18] Homeowner: Do not replace the cabinets.\n[1:36] Contractor: We will remount the mirror today.',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.tSec).toBe(18);
    expect(rows[0]?.text).toMatch(/cabinets/i);
    expect(rows[1]?.tSec).toBe(96);
  });

  it('builds WebVTT cues synced to stamp starts', () => {
    const vtt = webVttFromTranscript({
      transcriptText:
        '[0:18] Homeowner: Do not replace the cabinets.\n[1:36] Contractor: We will remount the mirror today.',
      durationSeconds: 120,
    });
    expect(vtt).toContain('WEBVTT');
    expect(vtt).toContain('00:00:18.000 -->');
    expect(vtt).toContain('00:01:36.000 -->');
    expect(vtt).toMatch(/Do not replace the cabinets/);
  });

  it('returns null when there is no transcript — no fake empty track', () => {
    expect(webVttFromTranscript({ transcriptText: null })).toBeNull();
    expect(webVttFromTranscript({ transcriptText: '   ' })).toBeNull();
    expect(captionCuesFromTranscript({ transcriptText: '' })).toEqual([]);
    expect(buildWebVtt([])).toBeNull();
  });

  it('prefers structured segments when present', () => {
    const cues = captionCuesFromTranscript({
      segments: [
        { tSec: 8, text: 'Camera finds the north slope', speakerLabel: null },
        { tSec: 18, text: 'Tarp pulled', speakerLabel: 'Crew' },
      ],
      transcriptText: '[0:00] ignored when segments exist',
      durationSeconds: 40,
    });
    expect(cues[0]?.startSec).toBe(8);
    expect(cues[1]?.text).toMatch(/^Crew:/);
  });

  it('splits a long coarse segment into short cues timed across its window', () => {
    const text =
      'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty';
    const cues = captionCuesFromTranscript({
      segments: [{ tSec: 0, text, speakerLabel: null }],
      durationSeconds: 20,
    });
    expect(text.length).toBeGreaterThan(CAPTION_MAX_CHARS);
    expect(cues.length).toBeGreaterThan(1);
    expect(cues.every((cue) => cue.text.length <= CAPTION_MAX_CHARS)).toBe(true);
    expect(cues[0]?.startSec).toBe(0);
    expect(cues[0]?.text.startsWith('one')).toBe(true);
    expect(cues[1]!.startSec).toBeGreaterThan(0);
    expect(cues[cues.length - 1]?.endSec).toBe(20);
    expect(activeCaptionAt(cues, 0.05)?.text).toBe(cues[0]?.text);
    expect(activeCaptionAt(cues, cues[1]!.startSec)?.text).toBe(cues[1]?.text);
    expect(activeCaptionAt(cues, 20)?.text).toBe(cues[cues.length - 1]?.text);
  });

  it('ends a long last stamped turn when the speech ends, not when the clip ends', () => {
    const last =
      'the homeowner said the cabinets stay and the crew will only remount the mirror after the drywall patch cures overnight';
    const cues = captionCuesFromTranscript({
      segments: [
        { tSec: 18, text: 'Do not replace the cabinets.', speakerLabel: null },
        { tSec: 96, text: last, speakerLabel: null },
      ],
      durationSeconds: 50 * 60,
    });
    expect(last.length).toBeGreaterThan(CAPTION_MAX_CHARS);
    const tail = cues.filter((cue) => cue.startSec >= 96);
    expect(tail.length).toBeGreaterThan(1);
    expect(tail.every((cue) => cue.text.length <= CAPTION_MAX_CHARS)).toBe(true);
    expect(tail[0]?.startSec).toBe(96);
    expect(tail[tail.length - 1]?.endSec).toBe(104.4);
    expect(activeCaptionAt(cues, 200)).toBeNull();
  });

  it('splits an unstamped transcript across the clip instead of one overlay', () => {
    const text =
      'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty';
    const cues = captionCuesFromTranscript({
      transcriptText: text,
      durationSeconds: 40,
    });
    expect(text.length).toBeGreaterThan(CAPTION_MAX_CHARS);
    expect(cues.length).toBeGreaterThan(1);
    expect(cues.every((cue) => cue.text.length <= CAPTION_MAX_CHARS)).toBe(true);
    expect(cues[0]?.startSec).toBe(0);
    expect(cues[0]?.text.startsWith('one')).toBe(true);
    expect(cues[1]!.startSec).toBeGreaterThan(0);
    expect(cues[cues.length - 1]?.endSec).toBe(40);
  });

  it('reveals words as they are spoken and holds later words back', () => {
    const words: CaptionWord[] = [
      { text: 'by', startSec: 0, endSec: 0.3 },
      { text: 'bad', startSec: 0.35, endSec: 0.6 },
      { text: 'actors', startSec: 0.7, endSec: 1.1 },
    ];
    expect(rollingCaptionAt(words, -0.1)).toBeNull();
    expect(rollingCaptionAt(words, 0.1)).toEqual(['by']);
    expect(rollingCaptionAt(words, 0.5)).toEqual(['by bad']);
    expect(rollingCaptionAt(words, 0.9)).toEqual(['by bad actors']);
  });

  it('rolls to two lines and drops the oldest line when a third line starts', () => {
    const words: CaptionWord[] = [
      { text: 'alpha', startSec: 0, endSec: 0.4 },
      { text: 'bravo', startSec: 0.5, endSec: 0.9 },
      { text: 'gamma', startSec: 1.0, endSec: 1.4 },
      { text: 'delta', startSec: 1.5, endSec: 1.9 },
    ];
    expect(rollingCaptionAt(words, 0.2, 5)).toEqual(['alpha']);
    expect(rollingCaptionAt(words, 0.6, 5)).toEqual(['alpha', 'bravo']);
    expect(rollingCaptionAt(words, 1.1, 5)).toEqual(['bravo', 'gamma']);
    expect(rollingCaptionAt(words, 1.6, 5)).toEqual(['gamma', 'delta']);
  });

  it('falls back to the proportional split when a clip has no word clock', () => {
    const lines = captionLinesAt({
      transcriptText:
        'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty',
      durationSeconds: 20,
      timeSec: 0.05,
    });
    expect(lines?.length).toBeGreaterThan(0);
    expect(lines!.length).toBeLessThanOrEqual(2);
    expect(lines![0]).toMatch(/^one/);
    expect(rollingCaptionAt([], 1)).toBeNull();
  });
});
