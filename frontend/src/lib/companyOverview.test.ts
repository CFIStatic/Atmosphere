import { describe, expect, it } from 'vitest';
import { jobsNeedingAttention, pipelineLine } from './companyOverview';
import type { JobSummary, ProofPulse } from './api';

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
