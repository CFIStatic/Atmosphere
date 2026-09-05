import { describe, expect, it } from 'vitest';
import type { ProofResponse } from './api';
import {
  analysisEventsFromProofs,
  parseAnswerSeconds,
  seekTargetFromAnswer,
  snapToEventBoundary,
  splitAnswerCites,
} from './askSeek';

const proofs: ProofResponse = {
  days: [],
  videos: [
    {
      id: 'p-after',
      partyId: 'pty-1',
      company: 'Delgado Roofing',
      workDate: '2026-08-05',
      phase: 'after',
      durationSeconds: 143,
      analysisStatus: 'done',
      narrationStatus: 'done',
      transcriptStatus: 'done',
      transcriptError: null,
      aiSummary: 'The tarp came off the north slope.',
      heardOnMic: null,
      events: [
        { atSeconds: 8, text: 'Camera finds the north slope' },
        { atSeconds: 18, text: 'Tarp pulled from the ridge' },
      ],
    },
  ],
  counts: { days: 0, videos: 1, payable: 0, contradicted: 0, awaitingAfter: 0 },
  siteKnown: true,
};

describe('parseAnswerSeconds', () => {
  it('reads clocks and spoken Analysis times', () => {
    expect(parseAnswerSeconds('At 0:18, the tarp came off.')).toEqual([18]);
    expect(parseAnswerSeconds('That happened at 18 seconds into the recording.')).toEqual([18]);
    expect(parseAnswerSeconds('Yes. Twelve seconds into the after clip.')).toEqual([12]);
    expect(parseAnswerSeconds('That was 1 hour and 52 minutes into the recording.')).toEqual([
      6720,
    ]);
  });

  it('does not treat clip length or work duration as a playhead', () => {
    expect(parseAnswerSeconds('The clip is 40 seconds.')).toEqual([]);
    expect(parseAnswerSeconds('2 hours and 15 minutes of work.')).toEqual([]);
  });
});

describe('snapToEventBoundary', () => {
  it('uses the nearest Analysis event-boundary, not a cadence', () => {
    expect(snapToEventBoundary(16, [8, 18])).toBe(18);
    expect(snapToEventBoundary(12, [8, 18])).toBe(8);
    expect(snapToEventBoundary(18, [])).toBe(18);
  });
});

describe('seekTargetFromAnswer', () => {
  it('deep-links a footage answer to the Analysis second', () => {
    const events = analysisEventsFromProofs(proofs);
    const target = seekTargetFromAnswer({
      answer: 'Yes. At 0:18, the tarp came off. That was 18 seconds into the recording.',
      events,
      groundedIds: ['2026-08-05:after'],
      videos: proofs.videos,
    });
    expect(target).toEqual({
      atSeconds: 18,
      proofId: 'p-after',
      workDate: '2026-08-05',
      phase: 'after',
    });
  });

  it('seeks an event mentioned by name when the prose has no clock', () => {
    const events = analysisEventsFromProofs(proofs);
    const target = seekTargetFromAnswer({
      answer: 'The reading shows tarp pulled from the ridge on the after clip.',
      events,
      groundedIds: ['2026-08-05:after'],
      videos: proofs.videos,
    });
    expect(target?.atSeconds).toBe(18);
    expect(target?.proofId).toBe('p-after');
  });

  it('opens the grounded clip that owns the snapped second', () => {
    const both: ProofResponse = {
      ...proofs,
      videos: [
        {
          ...proofs.videos[0]!,
          id: 'p-before',
          phase: 'before',
          events: [
            { atSeconds: 3, text: 'Walks the eaves' },
            { atSeconds: 12, text: 'Looks at the valley' },
          ],
        },
        proofs.videos[0]!,
      ],
    };
    const target = seekTargetFromAnswer({
      answer: 'At 0:18 on the after clip, the tarp came off.',
      events: analysisEventsFromProofs(both),
      groundedIds: ['2026-08-05:after'],
      videos: both.videos,
    });
    expect(target).toEqual({
      atSeconds: 18,
      proofId: 'p-after',
      workDate: '2026-08-05',
      phase: 'after',
    });
  });
});

describe('splitAnswerCites', () => {
  it('turns every mentioned moment into a cite at the event-boundary second', () => {
    const parts = splitAnswerCites(
      'At 0:18, the tarp came off. That was 18 seconds into the recording.',
      [8, 18],
    );
    const cites = parts.filter((part) => part.kind === 'cite');
    expect(cites).toHaveLength(2);
    expect(cites.every((cite) => cite.atSeconds === 18)).toBe(true);
  });

  it('does not turn duration phrases into cites', () => {
    const parts = splitAnswerCites(
      'The clip is 40 seconds. That was 2 hours and 15 minutes of work.',
    );
    expect(parts.filter((part) => part.kind === 'cite')).toHaveLength(0);
  });
});
