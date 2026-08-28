import { describe, expect, it } from 'vitest';
import type { FieldTodayJob, JobSummary } from './api';
import {
  buildCrewBoard,
  mergeWorkerJobs,
  workerFilmHref,
  workerListIsUnassigned,
} from './workerBoard';

function job(partial: Partial<JobSummary> & Pick<JobSummary, 'jobId' | 'title'>): JobSummary {
  return {
    jobNumber: 1041,
    status: 'in_progress',
    priority: 2,
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
    crew: [],
    ...partial,
  };
}

const todayRow: FieldTodayJob = {
  id: 'job-1041',
  number: '#1041',
  name: 'Meridian Ave',
  address: '412 Meridian Ave',
  at: '8:00 AM',
  status: 'in_progress',
  placed: true,
  filmed: false,
  reason: 'in_progress',
  sharePath: '/shared/tok-1',
};

describe('workerFilmHref', () => {
  it('uses the job invite when one exists', () => {
    expect(workerFilmHref('/shared/tok-1')).toBe('/shared/tok-1');
  });

  it('falls back to in-console capture', () => {
    expect(workerFilmHref(null)).toBe('/technician');
    expect(workerFilmHref('')).toBe('/technician');
  });
});

describe('mergeWorkerJobs', () => {
  it('prefers the Field Capture today list and keeps the film link', () => {
    const cards = mergeWorkerJobs(
      [todayRow],
      [
        job({
          jobId: 'job-1041',
          title: 'Meridian Ave — water loss',
          lastEvent: 'Film uploaded',
          crew: [{ userId: 'u-marcus', name: 'Marcus Webb' }],
        }),
      ],
      'u-marcus',
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].address).toBe('412 Meridian Ave');
    expect(cards[0].filmHref).toBe('/shared/tok-1');
    expect(cards[0].assignedToMe).toBe(true);
    expect(cards[0].href).toContain('job-1041');
  });

  it('keeps a successful empty today list instead of showing every open job', () => {
    const cards = mergeWorkerJobs(
      [],
      [
        job({
          jobId: 'done',
          title: 'Done',
          status: 'completed',
          crew: [{ userId: 'u-marcus', name: 'Marcus' }],
        }),
        job({
          jobId: 'theirs',
          title: 'Theirs',
          crew: [{ userId: 'u-jess', name: 'Jess' }],
        }),
      ],
      'u-marcus',
    );
    expect(cards).toEqual([]);
  });

  it('shows every open job when this person is not on a crew', () => {
    const cards = mergeWorkerJobs(
      null,
      [
        job({ jobId: 'a', title: 'A', status: 'draft' }),
        job({ jobId: 'done', title: 'Done', status: 'completed' }),
      ],
      'u-marcus',
    );
    expect(cards.map((c) => c.id)).toEqual(['a']);
    expect(workerListIsUnassigned(cards, 'u-marcus')).toBe(true);
  });
});

describe('buildCrewBoard', () => {
  it('groups open jobs by the people on them', () => {
    const board = buildCrewBoard([
      job({
        jobId: 'job-1',
        title: 'Meridian',
        jobNumber: 1041,
        crew: [
          { userId: 'u-marcus', name: 'Marcus Webb' },
          { userId: 'u-jess', name: 'Jess Ortega' },
        ],
      }),
      job({
        jobId: 'job-2',
        title: 'Closed',
        status: 'completed',
        crew: [{ userId: 'u-marcus', name: 'Marcus Webb' }],
      }),
    ]);
    expect(board.map((row) => row.name)).toEqual(['Jess Ortega', 'Marcus Webb']);
    expect(board.find((row) => row.userId === 'u-marcus')?.jobs).toEqual([
      { jobId: 'job-1', title: 'Meridian', jobNumber: 1041, status: 'in_progress' },
    ]);
  });
});
