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

test('library — a job viewer with a workspace of their own gets the job’s clip names from the job’s org', () => {
  const src = readFileSync(new URL('../src/routes/evidencePortal.ts', import.meta.url), 'utf8');
  const route = src.slice(src.indexOf("evidencePortalRouter.get('/library'"));
  const head = route.slice(0, route.indexOf('requireOrgContext(req)'));
  assert.match(head, /resolveOrgOrViewerAccess\(req, jobId\)/);
  assert.match(head, /access === 'viewer'/);
  assert.match(head, /viewerLibraryPayload\(admin, req\.user!\.id, req\.user!\.email\)/);
  assert.match(head, /item\?\.jobId === jobId/);
});

test('library — the Dashboard of someone with a workspace also lists jobs shared with them, marked read-only', () => {
  const src = readFileSync(new URL('../src/routes/evidencePortal.ts', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export async function viewerLibraryPayload'), src.indexOf("evidencePortalRouter.get('/library'"));
  assert.match(fn, /g\.orgId !== excludeOrgId/);
  assert.match(fn, /v\.orgId !== excludeOrgId/);
  assert.match(fn, /item\.sharedWithMe = true/);
  const route = src.slice(src.indexOf("evidencePortalRouter.get('/library'"));
  assert.match(route, /viewerLibraryPayload\(viewerAdmin, req\.user!\.id, req\.user!\.email, orgId\)/);
  assert.match(route, /kickUnreadLibraryReads\(admin, orgId, items\.filter\(\(item: any\) => !item\.sharedWithMe\)\)/);
});
