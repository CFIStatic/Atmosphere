import { describe, expect, it } from 'vitest';
import {
  buildOverview,
  jobsNeedingAttention,
  pipelineLine,
  todayLine,
} from './companyOverview';
import type { JobSummary, ProofPulse, SharedJobSummary } from './api';

function job(partial: Partial<JobSummary> & Pick<JobSummary, 'jobId' | 'title'>): JobSummary {
  return {
    jobNumber: 1,
    status: 'in_progress',
    priority: 3,
    workType: 'mitigation',
    ownerId: 'u1',
    claimNumber: null,
    taskCount: 0,
    tasksDone: 0,
    crewSize: 1,
    minutesLogged: 0,
    eventCount: 0,
    lastEvent: null,
    lastEventAt: null,
    contractAmount: null,
    invoicedAmount: 0,
    paidAmount: 0,
    scheduledStart: null,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...partial,
  };
}

function shared(
  partial: Partial<SharedJobSummary> & Pick<SharedJobSummary, 'jobId' | 'title'>,
): SharedJobSummary {
  return {
    jobNumber: 1,
    status: 'in_progress',
    parties: 1,
    currentRevision: 1,
    behind: 0,
    awaiting: 0,
    exclusions: 0,
    ...partial,
  };
}

const NOW = new Date('2026-08-28T18:00:00Z');

describe('jobsNeedingAttention', () => {
  it('surfaces blocked and urgent work, not every open job', () => {
    const rows = jobsNeedingAttention(
      [
        job({ jobId: 'quiet', title: 'East 6th — kitchen, water', status: 'draft' }),
        job({
          jobId: 'live',
          title: 'Meridian Ave — water loss',
          status: 'in_progress',
          priority: 2,
          lastEvent: 'Film uploaded',
          lastEventAt: new Date().toISOString(),
        }),
        job({
          jobId: 'urgent',
          title: 'Cedar Ridge — storm damage',
          status: 'in_progress',
          priority: 1,
          lastEvent: 'Supplement',
          lastEventAt: new Date().toISOString(),
        }),
        job({
          jobId: 'done',
          title: 'Paid rebuild',
          status: 'paid',
          lastEvent: 'Paid',
          lastEventAt: new Date().toISOString(),
        }),
      ],
      new Date(),
    );
    expect(rows.map((row) => row.job.title)).toEqual(['Cedar Ridge — storm damage']);
  });
});

describe('pipelineLine', () => {
  it('says how much film the assistant has read', () => {
    const pulse: ProofPulse = {
      clips: 12,
      read: 9,
      analysing: 2,
      failed: 1,
      unread: 0,
      heard: 4,
      filmedToday: 3,
    };
    expect(pipelineLine(pulse)).toBe('12 clips · 9 read · 2 being read · 1 failed · 4 with mic');
  });
});

describe('buildOverview', () => {
  it('ranks proof-chain breaks, not inventory counts', () => {
    const pulse: ProofPulse = {
      clips: 4,
      read: 1,
      analysing: 0,
      failed: 2,
      unread: 1,
      heard: 1,
      filmedToday: 1,
      byJob: [
        {
          jobId: 'cedar',
          clips: 3,
          read: 1,
          analysing: 0,
          failed: 2,
          unread: 0,
          heard: 1,
          filmedToday: 0,
        },
        {
          jobId: 'meridian',
          clips: 1,
          read: 0,
          analysing: 0,
          failed: 0,
          unread: 1,
          heard: 0,
          filmedToday: 1,
        },
      ],
    };

    const model = buildOverview(
      [
        job({
          jobId: 'cedar',
          jobNumber: 1038,
          title: 'Cedar Ridge — storm damage',
          priority: 1,
          lastEventAt: NOW.toISOString(),
        }),
        job({
          jobId: 'meridian',
          jobNumber: 1041,
          title: 'Meridian Ave — water loss',
          lastEventAt: NOW.toISOString(),
        }),
        job({
          jobId: 'paid',
          title: 'Paid rebuild',
          status: 'paid',
        }),
      ],
      [
        shared({
          jobId: 'cedar',
          title: 'Cedar Ridge — storm damage',
          behind: 2,
          awaiting: 1,
        }),
        shared({
          jobId: 'meridian',
          title: 'Meridian Ave — water loss',
        }),
        shared({
          jobId: 'east',
          title: 'East 6th — kitchen, water',
          status: 'draft',
          currentRevision: null,
          parties: 0,
        }),
      ],
      pulse,
      NOW,
    );

    expect(model.actions.map((a) => a.kind)).toEqual(['failed_read', 'unread_film', 'no_brief']);
    expect(model.actions[0].title).toBe('Cedar Ridge — storm damage');
    expect(model.actions[0].headline).toBe('2 clips failed');
    expect(model.actions[0].notes).toEqual(['1 question unanswered', '2 parties on an old brief', 'Marked urgent']);
    expect(model.actions[0].href).toBe('/jobs/cedar');
    expect(model.actions[1].href).toBe('/jobs/meridian');
    expect(model.actions[2].href).toBe('/job-progress?job=east');
    expect(model.actions.map((a) => a.title)).not.toContain('Paid rebuild');

    const byStage = Object.fromEntries(model.pipeline.map((b) => [b.stage, b.count]));
    expect(byStage.needs_review).toBe(1);
    expect(byStage.being_read).toBe(1);
    expect(byStage.needs_brief).toBe(1);
    expect(model.openCount).toBe(3);
    expect(todayLine(model)).toBe('1 clip filmed today on 1 job · 1 waiting to be read · 2 failed');
  });

  it('does not call a live job quiet just because it is old', () => {
    const model = buildOverview(
      [
        job({
          jobId: 'live',
          title: 'Meridian Ave — water loss',
          lastEventAt: '2026-08-20T00:00:00Z',
        }),
      ],
      [shared({ jobId: 'live', title: 'Meridian Ave — water loss' })],
      {
        clips: 2,
        read: 1,
        analysing: 0,
        failed: 0,
        unread: 1,
        heard: 0,
        filmedToday: 0,
        byJob: [
          {
            jobId: 'live',
            clips: 2,
            read: 1,
            analysing: 0,
            failed: 0,
            unread: 1,
            heard: 0,
            filmedToday: 0,
          },
        ],
      },
      NOW,
    );
    expect(model.actions.map((a) => a.kind)).toEqual(['unread_film']);
    expect(model.jobs[0].stage).toBe('being_read');
  });

  it('does not call a job quiet while the assistant is still reading its film', () => {
    const model = buildOverview(
      [
        job({
          jobId: 'live',
          title: 'Meridian Ave — water loss',
          lastEventAt: '2026-08-01T12:20:00Z',
        }),
      ],
      [shared({ jobId: 'live', title: 'Meridian Ave — water loss' })],
      {
        clips: 4,
        read: 3,
        analysing: 1,
        failed: 0,
        unread: 0,
        heard: 1,
        filmedToday: 2,
        byJob: [
          {
            jobId: 'live',
            clips: 4,
            read: 3,
            analysing: 1,
            failed: 0,
            unread: 0,
            heard: 1,
            filmedToday: 2,
          },
        ],
      },
      NOW,
    );
    expect(model.actions).toEqual([]);
    expect(model.jobs[0].stage).toBe('being_read');
  });

  it('treats a missing byJob payload as empty, not as a crash', () => {
    const model = buildOverview(
      [job({ jobId: 'live', title: 'Meridian Ave — water loss', lastEventAt: NOW.toISOString() })],
      [],
      {
        clips: 3,
        read: 3,
        analysing: 0,
        failed: 0,
        unread: 0,
        heard: 0,
        filmedToday: 0,
      },
      NOW,
    );
    expect(model.actions).toEqual([]);
    expect(model.jobs[0].stage).toBe('waiting_on_film');
    expect(todayLine(model)).toBe('No film landed today');
  });
});
