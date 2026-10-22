/* eslint-disable @typescript-eslint/no-explicit-any */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  annotateOfficeProofPayload,
  applyHomeownerSharingToProofPayload,
  assertHomeownerMaySeeProof,
  assertNothingPendingForHomeowner,
  computeHomeownerSharing,
  homeownerVisibleAt,
  normalizeDelay,
  type HomeownerReleaseMode,
} from '../src/shared/homeownerSharing.js';
import { HttpError } from '../src/lib/errors.js';

const NOW = Date.parse('2026-10-22T15:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const rows = [
  { id: 'old', received_at: hoursAgo(30) },
  { id: 'new', received_at: hoursAgo(2) },
];

test('delay None (the default) hides nothing: today\'s behavior', () => {
  const s = computeHomeownerSharing(rows, 0, new Map(), NOW);
  assert.equal(s.hiddenProofIds.size, 0);
  assert.equal(normalizeDelay(undefined), 0);
  assert.equal(normalizeDelay(13), 0);
  assert.equal(normalizeDelay(48), 48);
});

test('a 24h delay hides only uploads newer than 24 hours', () => {
  const s = computeHomeownerSharing(rows, 24, new Map(), NOW);
  assert.deepEqual([...s.hiddenProofIds], ['new']);
  assert.equal(s.visibleAt.get('new'), new Date(Date.parse(hoursAgo(2)) + 24 * 3_600_000).toISOString());
});

test('Share now releases early; Hold keeps a clip back indefinitely, even with no delay', () => {
  const o = new Map<string, HomeownerReleaseMode>([['new', 'share_now'], ['old', 'hold']]);
  const s = computeHomeownerSharing(rows, 48, o, NOW);
  assert.deepEqual([...s.hiddenProofIds], ['old']);
  assert.equal(homeownerVisibleAt(hoursAgo(1), 0, 'hold'), null);
  assert.deepEqual([...computeHomeownerSharing(rows, 0, new Map([['old', 'hold' as const]]), NOW).hiddenProofIds], ['old']);
});

test('the homeowner payload drops unshared clips and days left empty', () => {
  const s = computeHomeownerSharing(rows, 24, new Map(), NOW);
  const out: any = applyHomeownerSharingToProofPayload(
    {
      videos: [{ id: 'old' }, { id: 'new', transcriptText: 'secret' }],
      days: [{ id: 'd1', proofIds: ['new'] }, { id: 'd2', proofIds: ['old', 'new'] }],
      counts: { videos: 2, days: 2 },
    },
    s,
  );
  assert.deepEqual(out.videos.map((v: any) => v.id), ['old']);
  assert.deepEqual(out.days, [{ id: 'd2', proofIds: ['old'] }]);
  assert.equal(JSON.stringify(out).includes('secret'), false);
});

test('a homeowner asking for an unshared clip gets 404; Chat/report wait with 403; office unaffected', () => {
  const s = computeHomeownerSharing(rows, 24, new Map(), NOW);
  const homeowner = { access: 'viewer' as const, homeownerSharing: s };
  assert.throws(() => assertHomeownerMaySeeProof(homeowner, 'new'), (e: unknown) => e instanceof HttpError && e.status === 404);
  assert.doesNotThrow(() => assertHomeownerMaySeeProof(homeowner, 'old'));
  assert.throws(() => assertNothingPendingForHomeowner(homeowner), (e: unknown) => e instanceof HttpError && e.status === 403);
  assert.doesNotThrow(() => assertHomeownerMaySeeProof({ access: 'org' } as any, 'new'));
  assert.doesNotThrow(() => assertNothingPendingForHomeowner({ access: 'org' } as any));
});

test('the office payload tells the GC when each clip reaches the homeowner', () => {
  const s = computeHomeownerSharing(rows, 24, new Map([['old', 'hold' as const]]), NOW);
  const out: any = annotateOfficeProofPayload({ videos: [{ id: 'old' }, { id: 'new' }] }, s);
  assert.equal(out.homeownerShareDelayHours, 24);
  assert.equal(out.videos[0].homeownerVisibleAt, null);
  assert.equal(out.videos[0].homeownerRelease, 'hold');
  assert.ok(out.videos[1].homeownerVisibleAt);
  const none: any = annotateOfficeProofPayload({ videos: [{ id: 'x' }] }, computeHomeownerSharing([], 0, new Map(), NOW));
  assert.equal(none.videos[0].homeownerVisibleAt, undefined);
});

test('every homeowner clip route checks the sharing delay on the server, and RLS does too', () => {
  const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
  const proof = src('routes/proofOfWork.ts');
  assert.match(proof, /assertHomeownerMaySeeProof\(viewer, req\.params\.proofId\)/);
  assert.equal((proof.match(/assertNothingPendingForHomeowner\(viewer\)/g) ?? []).length, 4);
  assert.match(proof, /applyHomeownerSharingToProofPayload\(/);
  const portal = src('routes/evidencePortal.ts');
  assert.equal((portal.match(/assertHomeownerMaySeeProof\(resolved, req\.params\.proofId\)/g) ?? []).length, 3);
  assert.match(portal, /hiddenForHomeowner\.has\(p\.id as string\)/);
  const shared = src('routes/sharedJobs.ts');
  assert.match(shared, /'\/shared\/:jobId\/proofs\/:proofId\/homeowner-release'/);
  assert.match(shared, /\(proof as any\)\.job_id !== jobId \|\| \(proof as any\)\.org_id !== orgId/);
  const sql = readFileSync(new URL('../../supabase/migrations/20261022150000_job_homeowner_permissions.sql', import.meta.url), 'utf8');
  assert.match(sql, /share_delay_hours\s+integer not null default 0 check \(share_delay_hours in \(0, 24, 48, 72\)\)/);
  assert.match(sql, /private\.homeowner_may_read_proof_row\(job_id, id, received_at\)/);
  assert.match(sql, /revoke insert, update, delete, truncate on public\.job_homeowner_releases from anon, authenticated/);
});
