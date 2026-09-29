import { describe, expect, it } from 'vitest';
import { clipClock, clipDisplayTitle, clipMoments, shortClipId, videoRowStatus } from './jobVideoRows';

describe('clipDisplayTitle — same name as the Dashboard', () => {
  const video = { id: 'c8d6e77f-6d86-4eee-8312-076038c15bac' };

  it('prefers the office custom title, then the AI title', () => {
    expect(clipDisplayTitle(video, { id: video.id, customTitle: 'Kitchen walk', aiTitle: 'AI name' })).toBe(
      'Kitchen walk',
    );
    expect(
      clipDisplayTitle(video, {
        id: video.id,
        customTitle: '  ',
        aiTitle: 'Handheld Phone Video Shot Sideways Inside a Home,',
      }),
    ).toBe('Handheld Phone Video Shot Sideways Inside a Home,');
    expect(clipDisplayTitle(video, { id: video.id, title: 'Library title' })).toBe('Library title');
  });

  it('falls back to Video · short id, never a generic date + Field Capture', () => {
    expect(shortClipId(video.id)).toBe('38c15bac');
    expect(clipDisplayTitle(video, null)).toBe('Video · 38c15bac');
    expect(shortClipId('x', 'ABCDEF123456')).toBe('abcdef12');
  });
});

describe('clipClock', () => {
  it('prints the thumbnail badge length', () => {
    expect(clipClock(44.24)).toBe('0:44');
    expect(clipClock(723)).toBe('12:03');
    expect(clipClock(3729)).toBe('1:02:09');
    expect(clipClock(null)).toBe('—');
  });
});

describe('videoRowStatus', () => {
  it('reads processing, analyzed, and failed', () => {
    expect(videoRowStatus({ analysisStatus: 'done', transcriptStatus: 'done', narrationStatus: 'done' })).toEqual({
      label: 'Analyzed',
      tone: 'good',
    });
    expect(videoRowStatus({ analysisStatus: 'done', transcriptStatus: 'running', narrationStatus: null }).label).toBe(
      'Transcribing',
    );
    expect(
      videoRowStatus({
        analysisStatus: 'done',
        transcriptStatus: 'done',
        narrationStatus: 'done',
        conversation: { summaryState: 'updating' },
      }).label,
    ).toBe('Summary still processing');
    expect(videoRowStatus({ analysisStatus: 'failed', transcriptStatus: null, narrationStatus: null }).label).toBe(
      'Needs attention',
    );
    expect(videoRowStatus({ analysisStatus: null, transcriptStatus: null, narrationStatus: null }).label).toBe(
      'Recorded',
    );
  });
});

describe('clipMoments', () => {
  it('uses analysis events, else timestamped transcript lines', () => {
    expect(
      clipMoments({
        events: [
          { atSeconds: 30, text: 'Walks to the kitchen' },
          { atSeconds: 5, text: 'Opens on the living room' },
        ],
        transcriptSegments: [{ tSec: 0, text: 'ignored' }],
      }),
    ).toEqual([
      { atSeconds: 5, text: 'Opens on the living room' },
      { atSeconds: 30, text: 'Walks to the kitchen' },
    ]);
    expect(
      clipMoments({
        events: [],
        transcriptSegments: [
          { tSec: 0, text: 'her entire life.' },
          { tSec: 11, text: 'You know I love that girl.' },
          { tSec: null, text: 'untimed' },
        ],
      }),
    ).toEqual([
      { atSeconds: 0, text: 'her entire life.' },
      { atSeconds: 11, text: 'You know I love that girl.' },
    ]);
  });
});
