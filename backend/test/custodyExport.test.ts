import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLIP_CUSTODY_SCHEMA,
  JOB_CUSTODY_SCHEMA,
  buildClipCustodyExport,
  buildIntegrity,
  buildJobCustodyExport,
  isClipCustodyExport,
  parseDeviceMetadata,
} from '../src/shared/custodyExport.js';

test('clip custody export names who filmed, when, the job, device, and integrity', () => {
  const record = buildClipCustodyExport({
    exportedAt: '2026-09-05T22:00:00.000Z',
    job: { id: 'job-1038', number: 1038, name: 'Cedar Ridge — storm damage' },
    proof: {
      id: 'pf-4',
      phase: 'after',
      workDate: '2026-08-04',
      partyId: 'pty-2',
      company: 'Delgado Roofing',
      person: 'Hector Delgado',
      capturedAt: '2026-08-04T19:30:00Z',
      receivedAt: '2026-08-04T22:40:00Z',
      contentHash: '2e7b90a4c1d85f36027ea9b41c6d3805f71b29ac04e8d517b3a62ce09f4d1836',
      checks: [
        { key: 'on_site', verdict: 'fail', detail: 'Filmed 2.14 miles from the site.' },
        { key: 'not_a_reupload', verdict: 'pass', detail: 'New bytes.' },
      ],
      device: { make: 'Apple', model: 'iPhone 15', os: 'iOS 18.5', appVersion: '2.4', deviceId: 'dev-88' },
      lat: 30.4692,
      lon: -97.755,
      accuracyM: 11,
      durationSeconds: 52,
      byteSize: 61_900_000,
    },
    chainOfCustody: [
      {
        action: 'uploaded',
        actor_label: 'Hector Delgado, Delgado Roofing',
        actor_role: 'subcontractor',
        occurred_at: '2026-08-04T22:40:00Z',
        detail: 'after · 2026-08-04',
      },
    ],
  });

  assert.equal(record.schema, CLIP_CUSTODY_SCHEMA);
  assert.equal(record.job.id, 'job-1038');
  assert.equal(record.job.number, 1038);
  assert.equal(record.clip.filmedBy.person, 'Hector Delgado');
  assert.equal(record.clip.filmedBy.company, 'Delgado Roofing');
  assert.equal(record.clip.filmedAt, '2026-08-04T19:30:00Z');
  assert.equal(record.clip.device?.model, 'iPhone 15');
  assert.equal(record.clip.device?.deviceId, 'dev-88');
  assert.equal(record.clip.integrity.algorithm, 'sha256');
  assert.equal(record.clip.integrity.verdict, 'fail');
  assert.equal(record.clip.integrity.contentHash?.length, 64);
  assert.equal(record.clip.integrity.checks[0]!.what, 'Filmed on site');
  assert.equal(record.clip.location?.lat, 30.4692);
  assert.equal(record.chainOfCustody[0]!.by, 'Hector Delgado, Delgado Roofing');
  assert.equal(isClipCustodyExport(record), true);
});

test('missing device and hash stay null — unknown is not invented', () => {
  const record = buildClipCustodyExport({
    job: { id: 'job-1' },
    proof: {
      id: 'pf-web',
      phase: 'after',
      work_date: '2026-08-01',
      checks: [],
      content_hash: null,
      device_metadata: {},
    },
  });
  assert.equal(record.clip.device, null);
  assert.equal(record.clip.integrity.contentHash, null);
  assert.equal(record.clip.integrity.verdict, 'unknown');
  assert.equal(record.clip.filmedBy.person, null);
  assert.equal(isClipCustodyExport(record), true);
});

test('a demo device string still exports as identity', () => {
  const device = parseDeviceMetadata('iPhone 15 · Atmosphere 2.4 · chest mount');
  assert.equal(device?.label, 'iPhone 15 · Atmosphere 2.4 · chest mount');
  assert.equal(device?.make, null);
});

test('job export wraps every clip under the same schema', () => {
  const clip = buildClipCustodyExport({
    exportedAt: '2026-09-05T22:00:00.000Z',
    job: { id: 'job-1038', number: 1038, name: 'Cedar Ridge' },
    proof: { id: 'a', phase: 'before', workDate: '2026-08-05' },
  });
  const job = buildJobCustodyExport({
    exportedAt: '2026-09-05T22:00:00.000Z',
    job: { id: 'job-1038', number: 1038, name: 'Cedar Ridge' },
    clips: [clip],
  });
  assert.equal(job.schema, JOB_CUSTODY_SCHEMA);
  assert.equal(job.clips.length, 1);
  assert.equal(job.clips[0]!.clip.id, 'a');
});

test('integrity helper uses the worst check, never promotes unknown to pass', () => {
  assert.equal(buildIntegrity({ checks: [] }).verdict, 'unknown');
  assert.equal(
    buildIntegrity({
      contentHash: 'aa',
      checks: [
        { key: 'on_site', verdict: 'pass', detail: 'ok' },
        { key: 'same_day', verdict: 'unknown', detail: 'no clock' },
      ],
    }).verdict,
    'unknown',
  );
});
