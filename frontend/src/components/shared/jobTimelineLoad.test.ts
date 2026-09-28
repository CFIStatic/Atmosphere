import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TIFFANY_JOB_ID } from './tiffanyJobFixture';

const getMemory = vi.hoisted(() => vi.fn());
const jobProofs = vi.hoisted(() => vi.fn());
const jobCustodyExport = vi.hoisted(() => vi.fn());
const evidenceShares = vi.hoisted(() => vi.fn());
const jobAccessRoster = vi.hoisted(() => vi.fn());
const scopeDocument = vi.hoisted(() => vi.fn());
const jobLiveSessions = vi.hoisted(() => vi.fn());
const evidenceLibrary = vi.hoisted(() => vi.fn());
const getJobMentionMembers = vi.hoisted(() => vi.fn());
const getMembers = vi.hoisted(() => vi.fn());

vi.mock('../../lib/api', () => ({
  api: {
    getMemory,
    jobProofs,
    jobCustodyExport,
    evidenceShares,
    jobAccessRoster,
    scopeDocument,
    jobLiveSessions,
    evidenceLibrary,
    getJobMentionMembers,
    getMembers,
  },
}));

import { isJobUuid, loadJobTimelineSource } from './jobTimelineLoad';

const emptyProof = {
  days: [],
  videos: [],
  counts: { days: 0, videos: 0, payable: 0, contradicted: 0, awaitingAfter: 0 },
  siteKnown: false,
};

describe('loadJobTimelineSource', () => {
  beforeEach(() => {
    getMemory.mockReset();
    jobProofs.mockReset();
    jobCustodyExport.mockReset();
    evidenceShares.mockReset();
    jobAccessRoster.mockReset();
    scopeDocument.mockReset();
    jobLiveSessions.mockReset();
    evidenceLibrary.mockReset();
    getJobMentionMembers.mockReset();
    getMembers.mockReset();
    jobProofs.mockResolvedValue(emptyProof);
    jobCustodyExport.mockResolvedValue(null);
    evidenceShares.mockResolvedValue({ shares: [] });
    jobAccessRoster.mockResolvedValue({ people: [] });
    scopeDocument.mockResolvedValue({ doc: null });
    jobLiveSessions.mockResolvedValue({ sessions: [] });
    evidenceLibrary.mockResolvedValue({ items: [] });
    getJobMentionMembers.mockResolvedValue({ members: [] });
    getMembers.mockResolvedValue({ members: [] });
    getMemory.mockResolvedValue({ events: [], nextCursor: null });
  });

  it('skips memory when the job id is not a uuid', async () => {
    expect(isJobUuid('job-1038')).toBe(false);
    expect(isJobUuid(TIFFANY_JOB_ID)).toBe(true);
    const source = await loadJobTimelineSource({
      jobId: 'job-1038',
      record: null,
      office: true,
    });
    expect(getMemory).not.toHaveBeenCalled();
    expect(source.memory).toEqual([]);
    expect(jobCustodyExport).toHaveBeenCalledWith('job-1038');
  });

  it('does not call org endpoints for a viewer', async () => {
    await loadJobTimelineSource({
      jobId: TIFFANY_JOB_ID,
      record: null,
      office: false,
    });
    expect(jobProofs).toHaveBeenCalledWith(TIFFANY_JOB_ID);
    expect(getMemory).not.toHaveBeenCalled();
    expect(jobCustodyExport).not.toHaveBeenCalled();
    expect(evidenceLibrary).not.toHaveBeenCalled();
    expect(jobLiveSessions).not.toHaveBeenCalled();
  });

  it('keeps library posters for this job only and pages memory', async () => {
    getMemory
      .mockResolvedValueOnce({
        events: [
          {
            id: 'm1',
            seq: 20,
            actorId: null,
            actorEmail: null,
            actorRole: null,
            eventType: 'job.created',
            entityType: 'job',
            entityId: TIFFANY_JOB_ID,
            jobId: TIFFANY_JOB_ID,
            summary: 'opened the job',
            changes: {},
            snapshot: null,
            source: 'trigger',
            occurredAt: '2026-09-17T16:37:28.774Z',
          },
          {
            id: 'm-other',
            seq: 19,
            actorId: null,
            actorEmail: null,
            actorRole: null,
            eventType: 'job.created',
            entityType: 'job',
            entityId: 'other',
            jobId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            summary: 'opened a different job',
            changes: {},
            snapshot: null,
            source: 'trigger',
            occurredAt: '2026-09-17T16:00:00.000Z',
          },
        ],
        nextCursor: 19,
      })
      .mockResolvedValueOnce({ events: [], nextCursor: null });
    evidenceLibrary.mockResolvedValue({
      items: [
        { id: 'clip-a', jobId: TIFFANY_JOB_ID, posterUrl: 'https://signed.test/a.jpg' },
        { id: 'clip-b', jobId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', posterUrl: 'https://signed.test/b.jpg' },
      ],
    });

    const source = await loadJobTimelineSource({
      jobId: TIFFANY_JOB_ID,
      record: null,
      office: true,
    });

    expect(evidenceLibrary).toHaveBeenCalledWith(TIFFANY_JOB_ID);
    expect(getMemory).toHaveBeenCalledTimes(2);
    expect(getMemory).toHaveBeenNthCalledWith(2, { jobId: TIFFANY_JOB_ID, limit: 200, before: 19 });
    expect(source.memory.map((event) => event.id)).toEqual(['m1']);
    expect(source.posters).toEqual([
      {
        id: 'clip-a',
        jobId: TIFFANY_JOB_ID,
        posterUrl: 'https://signed.test/a.jpg',
        title: null,
      },
    ]);
  });
});
