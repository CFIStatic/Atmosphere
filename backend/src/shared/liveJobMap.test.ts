import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildLiveMapJobs,
  classifyActivity,
  liveMapSummary,
  pickCoords,
  type LiveMapInputJob,
} from './liveJobMap.js';

const base = (over: Partial<LiveMapInputJob> = {}): LiveMapInputJob => ({
  jobId: 'job-1',
  jobNumber: 1041,
  title: 'Meridian Ave',
  status: 'scheduled',
  address: '1842 Meridian Ave',
  propertyLat: 30.27,
  propertyLon: -97.74,
  crew: [{ name: 'Ken Ohara' }],
  parties: [],
  latestProof: null,
  uploading: false,
  filmedToday: false,
  openSafetyFlags: [],
  ...over,
});

describe('classifyActivity', () => {
  const now = new Date('2026-09-14T18:00:00Z');

  it('prefers uploading over everything else', () => {
    assert.equal(
      classifyActivity(
        {
          status: 'in_progress',
          lastPartySeenAt: '2026-09-14T17:59:00Z',
          lastProofAt: '2026-09-14T17:58:00Z',
          uploading: true,
        },
        now,
      ),
      'uploading',
    );
  });

  it('marks a recent Field Capture open as on_site', () => {
    assert.equal(
      classifyActivity(
        {
          status: 'scheduled',
          lastPartySeenAt: '2026-09-14T17:50:00Z',
          lastProofAt: null,
          uploading: false,
        },
        now,
      ),
      'on_site',
    );
  });

  it('marks a recent proof as recent_upload', () => {
    assert.equal(
      classifyActivity(
        {
          status: 'scheduled',
          lastPartySeenAt: null,
          lastProofAt: '2026-09-14T17:45:00Z',
          uploading: false,
        },
        now,
      ),
      'recent_upload',
    );
  });

  it('falls back to in_progress then idle', () => {
    assert.equal(
      classifyActivity(
        { status: 'in_progress', lastPartySeenAt: null, lastProofAt: null, uploading: false },
        now,
      ),
      'in_progress',
    );
    assert.equal(
      classifyActivity(
        { status: 'scheduled', lastPartySeenAt: null, lastProofAt: null, uploading: false },
        now,
      ),
      'idle',
    );
  });
});

describe('pickCoords', () => {
  it('prefers proof coordinates over property', () => {
    const coords = pickCoords(
      base({
        latestProof: {
          lat: 30.5,
          lon: -97.6,
          receivedAt: '2026-09-14T17:00:00Z',
          partyName: 'Ken',
        },
      }),
    );
    assert.deepEqual(coords, { lat: 30.5, lon: -97.6, source: 'proof' });
  });

  it('uses property when no proof geo', () => {
    assert.deepEqual(pickCoords(base()), {
      lat: 30.27,
      lon: -97.74,
      source: 'property',
    });
  });

  it('returns null when nothing has coordinates', () => {
    assert.equal(pickCoords(base({ propertyLat: null, propertyLon: null })), null);
  });
});

describe('buildLiveMapJobs', () => {
  const now = new Date('2026-09-14T18:00:00Z');

  it('surfaces critical safety first and dedupes people', () => {
    const jobs = buildLiveMapJobs(
      [
        base({
          jobId: 'quiet',
          title: 'Quiet job',
          status: 'scheduled',
        }),
        base({
          jobId: 'hot',
          title: 'Hot job',
          status: 'in_progress',
          crew: [{ name: 'Ken Ohara' }],
          parties: [{ name: 'Ken Ohara', lastSeenAt: '2026-09-14T17:55:00Z' }],
          openSafetyFlags: [
            {
              id: 'inc-1',
              severity: 'critical',
              category: 'fall_person_down',
              title: 'Person down',
              status: 'open',
              createdAt: '2026-09-14T17:56:00Z',
              source: 'live_sample',
            },
          ],
        }),
      ],
      now,
    );

    assert.equal(jobs[0]?.jobId, 'hot');
    assert.equal(jobs[0]?.activity, 'on_site');
    assert.equal(jobs[0]?.people.length, 1);
    assert.equal(jobs[0]?.openSafetyFlags.length, 1);

    const summary = liveMapSummary(jobs);
    assert.equal(summary.jobs, 2);
    assert.equal(summary.criticalSafety, 1);
    assert.equal(summary.withCoords, 2);
  });
});
