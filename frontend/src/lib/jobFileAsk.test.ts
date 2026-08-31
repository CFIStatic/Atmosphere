import { describe, expect, it } from 'vitest';
import {
  buildJobFileDossier,
  buildJobFileSearchHaystack,
  fileKnowsCopy,
  filePulse,
  jobFileMatches,
  jobFilePath,
  jobFileSuggestions,
  sharedJobsRedirectTo,
  turnsFromQuestions,
} from './jobFileAsk';
import type { JobSummary, ProofResponse, SharedJobRecord } from './api';

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
  it('opens the job file (briefs, proofs, invites), not the PM profile', () => {
    expect(jobFilePath('job-1038', { title: 'Cedar Ridge' })).toBe(
      '/job-progress?job=job-1038&title=Cedar+Ridge',
    );
  });
});

describe('sharedJobsRedirectTo', () => {
  it('sends /shared?job= to the job file and bare /shared to the library', () => {
    expect(sharedJobsRedirectTo('job=job-1038&title=Cedar+Ridge')).toBe(
      '/job-progress?job=job-1038&title=Cedar+Ridge',
    );
    expect(sharedJobsRedirectTo('')).toBe('/verifier-library');
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

  it('puts brief facts and do-nots on the file so Ask can point at them', () => {
    const beats = buildJobFileDossier({
      proofs: null,
      messages: [],
      facts: { 'Gate / access': 'Lockbox on the side gate — 4412' },
      scope: [{ state: 'excluded', title: 'Do not remove the skylights', reason: 'Carrier declined.' }],
    });
    expect(beats.some((beat) => beat.title === 'Gate / access' && /4412/.test(beat.detail))).toBe(true);
    expect(beats.some((beat) => beat.title === 'Do not' && /skylights/.test(beat.detail))).toBe(true);
  });
});

describe('filePulse', () => {
  it('counts clips, readings, and mic — not tasks', () => {
    expect(filePulse(proofs)).toEqual({
      clips: 1,
      read: 1,
      heard: 1,
      lastDate: '2026-08-05',
    });
    expect(filePulse(null)).toEqual({ clips: 0, read: 0, heard: 0, lastDate: null });
  });
});

describe('jobFileSuggestions', () => {
  it('leads with the forgotten question when the mic has been read', () => {
    expect(jobFileSuggestions({ hasMic: true, hasVideo: true, latestDate: '2026-08-05' })[0]).toBe(
      'What did the homeowner say?',
    );
  });

  it('asks about what is already in the clips, not a restoration menu', () => {
    const beats = buildJobFileDossier({
      proofs,
      messages: [
        {
          id: 'm1',
          party_id: null,
          author_label: 'Homeowner',
          body: 'Please do not touch the skylights.',
          scope_item_id: null,
          is_decision: false,
          created_at: '2026-08-04T10:00:00Z',
        },
      ],
    });
    const prompts = jobFileSuggestions({
      hasMic: true,
      hasVideo: true,
      latestDate: '2026-08-05',
      beats,
    });
    expect(prompts[0]).toBe('What did the homeowner say about the skylights?');
    expect(prompts[1]).toBe('What happened with the tarp?');
    expect(prompts.some((prompt) => /crew do on/.test(prompt))).toBe(true);
    expect(prompts).toContain('Is anything still unfinished?');
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

describe('fileKnowsCopy', () => {
  it('sounds like the file is already read, not like a dashboard', () => {
    expect(fileKnowsCopy({ clipCount: 2, hasMic: true, hasNotes: true })).toBe(
      "I've already read 2 clips and what was said on the mic. Ask what you forgot.",
    );
    expect(fileKnowsCopy({ clipCount: 0, hasMic: false, hasNotes: false })).toMatch(/ask what you forgot/i);
  });
});

describe('jobFileMatches', () => {
  const job: JobSummary = {
    jobId: 'job-1038',
    jobNumber: 1038,
    title: 'Cedar Ridge — storm damage, roof tarp + rebuild',
    status: 'in_progress',
    priority: 1,
    workType: 'construction',
    ownerId: 'u-priya',
    claimNumber: 'CLM-88396',
    taskCount: 0,
    tasksDone: 0,
    crewSize: 2,
    minutesLogged: 0,
    eventCount: 0,
    lastEvent: null,
    lastEventAt: '2026-08-01T10:05:00Z',
    contractAmount: null,
    invoicedAmount: 0,
    paidAmount: 0,
    scheduledStart: '2026-08-01T15:30:00Z',
    createdAt: '2026-07-19T08:30:00Z',
    updatedAt: '2026-08-05T18:00:00Z',
  };

  const extra = buildJobFileSearchHaystack({
    job,
    record: {
      job: {
        id: 'job-1038',
        jobNumber: 1038,
        title: job.title,
        status: 'in_progress',
        claimNumber: 'CLM-88396',
      },
      brief: {
        id: 'b1',
        revision: 1,
        facts: { 'Site address': '2214 Cedar Ridge Dr, Round Rock TX' },
        note: null,
      },
      revisions: [],
      currentRevision: 1,
      parties: [
        {
          id: 'pty-2',
          company: 'Delgado Roofing',
          trade: 'roofing',
          contactName: 'Hector Delgado',
          email: 'hector@delgadoroofing.example',
          phone: null,
          role: 'subcontractor',
          invited_at: null,
          last_seen_at: null,
          revoked_at: null,
          acknowledgedRevision: 3,
          clear: false,
          because: '',
        },
      ],
      scope: [],
      money: { approved: 0, pending: 0, unpricedApprovals: 0 },
      messages: [],
      risks: [],
    },
    proofs,
    evidence: [
      {
        id: 'pf-1',
        company: 'Delgado Roofing',
        contentHash: '4f2a9c1d8b73e5460af1c92d7e3b8054916cfa2d7b04e8135ca6dfe27093b118',
        workDate: '2026-08-05',
      },
    ],
    shares: [{ id: 'vs-1', path: '/verifier/shared/demo-rhodes' }],
  });

  it('finds a file by name, number, or claim', () => {
    const slim = { title: 'Cedar Ridge — storm damage', jobNumber: 1038, claimNumber: 'CLM-9' };
    expect(jobFileMatches(slim, 'cedar')).toBe(true);
    expect(jobFileMatches(slim, '1038')).toBe(true);
    expect(jobFileMatches(slim, 'clm-9')).toBe(true);
    expect(jobFileMatches(slim, 'kitchen')).toBe(false);
  });

  it('matches job title, company, date, address, ID, and hash', () => {
    expect(jobFileMatches(job, 'cedar ridge', extra)).toBe(true);
    expect(jobFileMatches(job, 'Delgado', extra)).toBe(true);
    expect(jobFileMatches(job, 'hector', extra)).toBe(true);
    expect(jobFileMatches(job, 'aug 5', extra)).toBe(true);
    expect(jobFileMatches(job, '2026-08-05', extra)).toBe(true);
    expect(jobFileMatches(job, '2214 Cedar Ridge', extra)).toBe(true);
    expect(jobFileMatches(job, '1038', extra)).toBe(true);
    expect(jobFileMatches(job, 'job-1038', extra)).toBe(true);
    expect(jobFileMatches(job, 'CLM-88396', extra)).toBe(true);
    expect(jobFileMatches(job, '4f2a9c1d', extra)).toBe(true);
    expect(jobFileMatches(job, 'pf-1', extra)).toBe(true);
    expect(jobFileMatches(job, 'demo-rhodes', extra)).toBe(true);
    expect(jobFileMatches(job, 'kitchen', extra)).toBe(false);
    expect(jobFileMatches(job, '')).toBe(true);
  });
});
