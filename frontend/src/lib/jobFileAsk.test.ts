import { describe, expect, it } from 'vitest';
import {
  buildJobFileDossier,
  jobFileMatches,
  jobFilePath,
  jobFileSuggestions,
  turnsFromQuestions,
} from './jobFileAsk';
import type { ProofResponse, SharedJobRecord } from './api';

const proofs: ProofResponse = {
  days: [
    {
      partyId: 'pty-1',
      company: 'Delgado Roofing',
      workDate: '2026-08-05',
      hasBefore: true,
      hasAfter: true,
      checks: [],
      contradicted: false,
      summary: 'North slope stripped to decking.',
      payable: true,
      payableBecause: 'Both clips on file',
      accepted: false,
      rejected: false,
      aiSummary: 'The tarp is gone and underlayment is down across two thirds of the slope.',
      aiFindings: null,
      proofIds: ['p1', 'p2'],
    },
  ],
  videos: [
    {
      id: 'p2',
      partyId: 'pty-1',
      company: 'Delgado Roofing',
      workDate: '2026-08-05',
      phase: 'after',
      durationSeconds: 143,
      analysisStatus: 'done',
      narrationStatus: 'done',
      transcriptStatus: 'done',
      transcriptError: null,
      aiSummary: 'The tarp is gone and underlayment is down across two thirds of the slope.',
      heardOnMic: 'Homeowner asked us not to touch the skylights.',
    },
  ],
  counts: { days: 1, videos: 1, payable: 1, contradicted: 0, awaitingAfter: 0 },
  siteKnown: true,
};

describe('jobFilePath', () => {
  it('opens My jobs as the job file', () => {
    expect(jobFilePath('job-1038', { title: 'Cedar Ridge' })).toBe(
      '/jobs?job=job-1038&title=Cedar+Ridge',
    );
  });
});

describe('buildJobFileDossier', () => {
  it('reads clips and what people said, not status tiles', () => {
    const messages: SharedJobRecord['messages'] = [
      {
        id: 'm1',
        party_id: null,
        author_label: 'Homeowner',
        body: 'Please leave the oak floors.',
        scope_item_id: null,
        is_decision: false,
        created_at: '2026-08-04T10:00:00Z',
      },
    ];
    const beats = buildJobFileDossier({ proofs, messages });
    expect(beats.some((beat) => beat.kind === 'said' && /oak floors/.test(beat.detail))).toBe(true);
    expect(beats.some((beat) => /skylights/.test(beat.detail))).toBe(true);
    expect(beats.some((beat) => /underlayment/.test(beat.detail))).toBe(true);
    expect(beats.every((beat) => !/payable|crew size|kpi/i.test(beat.title))).toBe(true);
  });
});

describe('jobFileSuggestions', () => {
  it('leads with the forgotten question when the mic has been read', () => {
    expect(jobFileSuggestions({ hasMic: true, hasVideo: true, latestDate: '2026-08-05' })[0]).toBe(
      'What did the homeowner say?',
    );
  });
});

describe('turnsFromQuestions', () => {
  it('replays the file as a conversation, oldest first', () => {
    const turns = turnsFromQuestions([
      {
        id: 'q2',
        question: 'Was the tarp removed?',
        answer: 'Yes. Twelve seconds into the after clip.',
        grounded_on: ['2026-08-05:after'],
        created_at: '2026-08-06T12:00:00Z',
      },
      {
        id: 'q1',
        question: 'What happened?',
        answer: 'The north slope was stripped.',
        grounded_on: ['2026-08-05:after'],
        created_at: '2026-08-06T11:00:00Z',
      },
    ]);
    expect(turns.map((turn) => turn.content)).toEqual([
      'What happened?',
      'The north slope was stripped.',
      'Was the tarp removed?',
      'Yes. Twelve seconds into the after clip.',
    ]);
  });
});

describe('jobFileMatches', () => {
  it('finds a file by name, number, or claim', () => {
    const job = { title: 'Cedar Ridge — storm damage', jobNumber: 1038, claimNumber: 'CLM-9' };
    expect(jobFileMatches(job, 'cedar')).toBe(true);
    expect(jobFileMatches(job, '1038')).toBe(true);
    expect(jobFileMatches(job, 'clm-9')).toBe(true);
    expect(jobFileMatches(job, 'kitchen')).toBe(false);
  });
});
