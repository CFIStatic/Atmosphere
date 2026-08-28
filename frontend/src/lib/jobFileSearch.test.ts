import { describe, expect, it } from 'vitest';
import type { JobSummary } from './api';
import { dateSearchPhrases, jobFileMatchesQuery } from './jobFileSearch';

function job(overrides: Partial<JobSummary> = {}): JobSummary {
  return {
    jobId: 'job-1038',
    jobNumber: 1038,
    title: 'Cedar Ridge — storm damage',
    status: 'in_progress',
    priority: 2,
    workType: 'mitigation',
    ownerId: 'u1',
    claimNumber: 'CLM-88396',
    taskCount: 4,
    tasksDone: 1,
    crewSize: 2,
    minutesLogged: 60,
    eventCount: 4,
    lastEvent: 'After clip read',
    lastEventAt: '2026-08-05T18:00:00Z',
    contractAmount: 18000,
    invoicedAmount: 0,
    paidAmount: 0,
    scheduledStart: '2026-08-01T13:00:00Z',
    createdAt: '2026-07-19T08:30:00Z',
    updatedAt: '2026-08-05T18:00:00Z',
    ...overrides,
  };
}

describe('jobFileMatchesQuery', () => {
  it('matches job name, number, claim, and id', () => {
    const row = job();
    expect(jobFileMatchesQuery(row, '')).toBe(true);
    expect(jobFileMatchesQuery(row, 'cedar ridge')).toBe(true);
    expect(jobFileMatchesQuery(row, '#1038')).toBe(true);
    expect(jobFileMatchesQuery(row, 'CLM-88396')).toBe(true);
    expect(jobFileMatchesQuery(row, 'job-1038')).toBe(true);
    expect(jobFileMatchesQuery(row, 'harbor')).toBe(false);
  });

  it('matches dates the same way the dashboard search does', () => {
    const row = job();
    expect(jobFileMatchesQuery(row, 'aug 5')).toBe(true);
    expect(jobFileMatchesQuery(row, '8/1/2026')).toBe(true);
    expect(dateSearchPhrases('2026-08-05T18:00:00Z')).toContain('aug 5');
  });
});
