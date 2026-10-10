import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { liveGrantRows } from '../src/shared/jobProgressGrants.js';

const row = (over: Record<string, unknown> = {}) => ({
  org_id: 'org-a',
  job_id: 'job-1',
  share_id: 'share-1',
  recipient_email: 'home@example.com',
  revoked_at: null as string | null,
  ...over,
});
const share = (over: Record<string, unknown> = {}) => ({
  id: 'share-1',
  job_id: 'job-1',
  revoked_at: null as string | null,
  recipient_email: 'Home@Example.com',
  ...over,
});

test('liveGrantRows — a live invite to my email opens the job', () => {
  assert.equal(liveGrantRows([row()], [share()], 'home@example.com').length, 1);
});

test('liveGrantRows — revoked grant, revoked or missing invite, or readdressed invite opens nothing', () => {
  assert.equal(liveGrantRows([row({ revoked_at: '2026-10-10' })], [share()]).length, 0);
  assert.equal(liveGrantRows([row()], [share({ revoked_at: '2026-10-10' })]).length, 0);
  assert.equal(liveGrantRows([row()], []).length, 0);
  assert.equal(liveGrantRows([row({ share_id: null })], [share()]).length, 0);
  assert.equal(liveGrantRows([row()], [share({ recipient_email: 'other@example.com' })]).length, 0);
  assert.equal(liveGrantRows([row()], [share({ job_id: 'job-2' })]).length, 0);
});

test('liveGrantRows — signed in as a different email opens nothing', () => {
  assert.equal(liveGrantRows([row()], [share()], 'someone@else.com').length, 0);
});

test('library — accounts without an org fall back to the invited-jobs dashboard, never org data', () => {
  const src = readFileSync(new URL('../src/routes/evidencePortal.ts', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export async function viewerLibraryPayload'), src.indexOf("evidencePortalRouter.get('/library'"));
  assert.match(fn, /listJobProgressGrants\(admin, userId, userEmail\)/);
  assert.match(fn, /\.in\('job_id', jobIds\)/);
  assert.match(fn, /\.in\('id', jobIds\)/);
  assert.match(fn, /\.is\('deleted_at', null\)/);
  assert.match(fn, /proofFindingsHavePrivacyRedactions/);
});
