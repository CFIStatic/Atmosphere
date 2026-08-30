import { afterEach, describe, expect, it } from 'vitest';
import {
  jobFileActivityMs,
  readJobFileOpenedAt,
  sortJobFilesByLastOpened,
  touchJobFile,
} from './jobFileRecents';

const cedar = {
  jobId: 'job-1038',
  lastEventAt: '2026-08-05T18:00:00Z',
  updatedAt: '2026-08-05T18:00:00Z',
  createdAt: '2026-07-19T08:30:00Z',
};

const harbor = {
  jobId: 'job-1042',
  lastEventAt: '2026-07-31T16:44:00Z',
  updatedAt: '2026-07-31T16:44:00Z',
  createdAt: '2026-07-30T11:15:00Z',
};

const camden = {
  jobId: 'job-4',
  lastEventAt: '2026-07-15T12:00:00Z',
  updatedAt: '2026-07-15T12:00:00Z',
  createdAt: '2026-07-15T12:00:00Z',
};

describe('jobFileRecents', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('ranks by last recorded event until a file is opened', () => {
    const ranked = sortJobFilesByLastOpened([harbor, camden, cedar]);
    expect(ranked.map((job) => job.jobId)).toEqual(['job-1038', 'job-1042', 'job-4']);
  });

  it('puts the last clicked file first', () => {
    touchJobFile('job-4', Date.parse('2026-08-20T10:00:00Z'));
    touchJobFile('job-1042', Date.parse('2026-08-21T10:00:00Z'));
    const ranked = sortJobFilesByLastOpened([harbor, camden, cedar]);
    expect(ranked.map((job) => job.jobId)).toEqual(['job-1042', 'job-4', 'job-1038']);
    expect(jobFileActivityMs(camden, readJobFileOpenedAt())).toBe(Date.parse('2026-08-20T10:00:00Z'));
  });
});
