import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clipMatchesSearch,
  fileNameOfStoragePath,
  jobMatchesSearch,
  parseSearchDate,
  searchLocalDay,
  type SearchClip,
  type SearchJob,
} from '../src/verifier/librarySearch.js';

const TZ = 'America/Chicago';
const JOB_ID = '7c0e5d1a-2b3c-4d5e-8f90-a1b2c3d4e5f6';
const job: SearchJob = {
  jobId: JOB_ID,
  jobName: 'Project Tiffany & Co.',
  jobNumber: 1041,
  address: '1200 Maple Ave, Edina, MN 55435',
  claimNumber: 'CLM-88213',
  company: 'Von Maur Roofing',
  person: 'Dana Whitfield',
  createdAt: '2026-10-01T15:00:00Z',
};
// 7:30 PM CT Oct 12 = 00:30 UTC Oct 13.
const clip: SearchClip = {
  id: '5b1e9c2a-1111-4c8e-9a00-000000000001',
  jobId: JOB_ID,
  jobName: 'Project Tiffany & Co.',
  clipId: 'clp_7d3f20',
  hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  title: 'North elevation tear-off',
  aiTitle: 'Shingle removal, north slope',
  fileName: 'IMG_4821.MOV',
  capturedAt: '2026-10-13T00:30:00Z',
  uploadedAt: '2026-10-13T00:41:00Z',
};
const hit = (q: string) => clipMatchesSearch(q, clip, job, TZ);

test('search: job name partial, case-blind, & and punctuation', () => {
  for (const q of ['tif', 'TIFFANY', 'tiffany & co', 'Tiffany & Co.', 'tiffany&co', 'tif co']) assert.equal(hit(q), true, q);
  assert.equal(jobMatchesSearch('tiffany&co', job), true);
  assert.equal(jobMatchesSearch('von mour', { jobId: 'x', jobName: 'CC Von Mour' }), true);
});

test('search: company, person, address, number, claim', () => {
  for (const q of ['von maur', 'whitfield', 'maple', 'edina mn', '#1041', 'clm-88213']) assert.equal(hit(q), true, q);
  assert.equal(hit('gutter'), false);
});

test('search: dates in several formats, in the viewer timezone', () => {
  for (const q of ['10/12', '10/12/2026', 'Oct 12', 'oct. 12', 'October 12, 2026', '12 Oct', '2026-10-12', 'Oct 2026']) {
    assert.equal(hit(q), true, q);
  }
  for (const q of ['10/13', 'Oct 13', '2026-10-13']) assert.equal(hit(q), false, q);
  // Without a timezone the instant reads as UTC (Oct 13).
  assert.equal(clipMatchesSearch('Oct 13', clip, job), true);
  assert.deepEqual(parseSearchDate('Oct 12th'), { y: null, m: 10, d: 12 });
  assert.equal(parseSearchDate('13/45'), null);
  assert.deepEqual(searchLocalDay('2026-10-12'), { y: 2026, m: 10, d: 12 });
  assert.equal(clipMatchesSearch('10/12', { ...clip, capturedAt: '2026-08-01T15:00:00Z', uploadedAt: null }, job, TZ), false);
});

test('search: clip, recording and job id by full value or prefix', () => {
  for (const q of [clip.id, '5b1e', '5B1E9C2A-1111', 'clp_7d3f', JOB_ID, '7c0e5d1a']) assert.equal(hit(q!), true, q!);
  assert.equal(hit('9c2a'), false);
  assert.equal(jobMatchesSearch('7c0e', job), true);
});

test('search: file hash by full value or prefix', () => {
  assert.equal(hit(clip.hash!), true);
  assert.equal(hit('a1b2c3'), true);
  assert.equal(hit('d4e5f6'), false);
});

test('search: clip titles and file names', () => {
  for (const q of ['north elevation', 'tear-off', 'shingle removal', 'img_4821', 'IMG_4821.mov']) assert.equal(hit(q), true, q);
  assert.equal(fileNameOfStoragePath('org/job/2026-10-12/IMG_4821.MOV'), 'IMG_4821.MOV');
  assert.equal(fileNameOfStoragePath(null), null);
});
