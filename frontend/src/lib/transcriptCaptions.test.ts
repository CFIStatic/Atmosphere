import { describe, expect, it } from 'vitest';
import {
  buildWebVtt,
  captionCuesFromTranscript,
  parseTimestampedTranscript,
  webVttFromTranscript,
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
});
