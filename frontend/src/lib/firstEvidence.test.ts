import { describe, expect, it } from 'vitest';
import { firstClipPreview, SAMPLE_EVIDENCE } from './firstEvidence';
import type { ProofVideoRecord } from './api';

const clip = (over: Partial<ProofVideoRecord>): ProofVideoRecord =>
  ({
    id: 'c8d6e77f-6d86-4eee-8312-076038c15bac',
    durationSeconds: 44.24,
    analysisStatus: 'done',
    transcriptStatus: 'done',
    narrationStatus: 'done',
    receivedAt: '2026-09-21T23:15:34.828Z',
    transcriptSegments: [
      { tSec: 0, text: 'her entire life.' },
      { tSec: 11, text: 'You know I love that girl.' },
    ],
    aiSummary: 'A short handheld interior walkthrough.',
    ...over,
  }) as ProofVideoRecord;

describe('firstClipPreview', () => {
  it('is null until a clip reaches the office', () => {
    expect(firstClipPreview({ videos: [] }, [])).toBeNull();
  });

  it("uses the Dashboard's title and poster, the transcript lines with timestamps, and the summary", () => {
    const p = firstClipPreview({ videos: [clip({})] }, [
      { id: 'c8d6e77f-6d86-4eee-8312-076038c15bac', title: 'Handheld Phone Video Shot Sideways Inside a Home,', posterUrl: 'p.jpg' },
    ])!;
    expect(p.title).toBe('Handheld Phone Video Shot Sideways Inside a Home,');
    expect(p.posterUrl).toBe('p.jpg');
    expect(p.lines).toEqual([
      { at: '0:00', text: 'her entire life.' },
      { at: '0:11', text: 'You know I love that girl.' },
    ]);
    expect(p.summary).toBe('A short handheld interior walkthrough.');
  });

  it('withholds the summary while processing', () => {
    const p = firstClipPreview({ videos: [clip({ analysisStatus: 'running' })] }, [])!;
    expect(p.processing).toBe(true);
    expect(p.summary).toBeNull();
  });

  it('the sample never names a speaker role', () => {
    expect(SAMPLE_EVIDENCE.ask.answer).toMatch(/Speaker not identified/);
    expect(JSON.stringify(SAMPLE_EVIDENCE)).not.toMatch(/homeowner/i);
  });
});
