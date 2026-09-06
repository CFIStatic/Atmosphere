import { describe, expect, it } from 'vitest';
import type { JobScopeItem, ProofQuestion, ProofResponse } from './api';
import { jobFileToday, jobFileTodayHasChange } from './jobFileToday';

const now = new Date('2026-09-05T15:00:00-05:00');

const todayClip = {
  id: 'p-today',
  partyId: 'pty-1',
  company: 'Delgado Roofing',
  workDate: '2026-09-05',
  phase: 'after',
  durationSeconds: 40,
  analysisStatus: 'done',
  narrationStatus: 'done',
  transcriptStatus: 'done',
  transcriptError: null,
  aiSummary: 'New flashing on the valley.',
  heardOnMic: null,
  receivedAt: '2026-09-05T14:10:00Z',
};

const proofs: ProofResponse = {
  days: [],
  videos: [
    todayClip,
    {
      ...todayClip,
      id: 'p-old',
      workDate: '2026-08-05',
      receivedAt: '2026-08-05T14:10:00Z',
    },
  ],
  counts: { days: 0, videos: 2, payable: 0, contradicted: 0, awaitingAfter: 0 },
  siteKnown: true,
};

const scope: JobScopeItem[] = [
  {
    id: 'sc-new',
    party_id: null,
    state: 'included',
    title: 'Replace valley flashing',
    detail: null,
    amount: null,
    reason: null,
    revision: 1,
    decided_at: null,
    created_at: '2026-09-05T13:00:00Z',
  },
  {
    id: 'sc-old',
    party_id: null,
    state: 'excluded',
    title: 'Do not remove the skylights',
    detail: null,
    amount: null,
    reason: null,
    revision: 1,
    decided_at: null,
    created_at: '2026-08-04T08:05:00Z',
  },
];

const questions: ProofQuestion[] = [
  {
    id: 'q-open',
    question: 'Did they finish the valley?',
    answer: null,
    grounded_on: [],
    created_at: '2026-09-05T16:00:00Z',
  },
  {
    id: 'q-done',
    question: 'Was the tarp removed?',
    answer: 'Yes.',
    grounded_on: ['2026-08-05:after'],
    created_at: '2026-09-05T12:00:00Z',
  },
];

describe('jobFileToday', () => {
  it('collects new clips, new scope lines, and unanswered Ask items for today', () => {
    const change = jobFileToday({ proofs, scope, questions, now });
    expect(change.clips.map((clip) => clip.id)).toEqual(['p-today']);
    expect(change.scope.map((item) => item.id)).toEqual(['sc-new']);
    expect(change.unansweredAsk.map((item) => item.id)).toEqual(['q-open']);
    expect(jobFileTodayHasChange(change)).toBe(true);
  });

  it('is empty when nothing landed today', () => {
    const change = jobFileToday({
      proofs: { ...proofs, videos: proofs.videos.filter((video) => video.id === 'p-old') },
      scope: scope.filter((item) => item.id === 'sc-old'),
      questions: questions.filter((item) => item.id === 'q-done'),
      now,
    });
    expect(change.clips).toEqual([]);
    expect(change.scope).toEqual([]);
    expect(change.unansweredAsk).toEqual([]);
    expect(jobFileTodayHasChange(change)).toBe(false);
  });
});
