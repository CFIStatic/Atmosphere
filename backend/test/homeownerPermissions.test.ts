/* eslint-disable @typescript-eslint/no-explicit-any */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_HOMEOWNER_PERMISSIONS,
  HOMEOWNER_PERMISSION_KEYS,
  applyHomeownerPermissionsToLibraryItem,
  applyHomeownerPermissionsToProofPayload,
  assertHomeownerMay,
  effectiveHomeownerPermissions,
  homeownerPermissionsFromRow,
  homeownerPermissionsToRow,
  loadHomeownerPermissions,
  type HomeownerPermissions,
} from '../src/shared/homeownerPermissions.js';
import { HttpError } from '../src/lib/errors.js';

const all = (over: Partial<HomeownerPermissions> = {}): HomeownerPermissions => ({
  ...DEFAULT_HOMEOWNER_PERMISSIONS,
  ...over,
});
const homeowner = (perms: HomeownerPermissions) => ({ access: 'viewer' as const, homeownerPermissions: perms });

function fakeAdmin(row: Record<string, unknown> | null, error: { message: string } | null = null) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: row, error }),
  };
  return { from: (table: string) => (assert.equal(table, 'job_homeowner_permissions'), chain) } as any;
}

test('defaults keep today\'s behavior: every permission on, and no row means defaults', async () => {
  for (const key of HOMEOWNER_PERMISSION_KEYS) assert.equal(DEFAULT_HOMEOWNER_PERMISSIONS[key], true, key);
  assert.deepEqual(homeownerPermissionsFromRow(null), DEFAULT_HOMEOWNER_PERMISSIONS);
  assert.deepEqual(await loadHomeownerPermissions(fakeAdmin(null), 'job'), DEFAULT_HOMEOWNER_PERMISSIONS);
  // Before the migration is applied the table is missing: still today's behavior.
  assert.deepEqual(
    await loadHomeownerPermissions(fakeAdmin(null, { message: 'relation "public.job_homeowner_permissions" does not exist' }), 'job'),
    DEFAULT_HOMEOWNER_PERMISSIONS,
  );
});

test('an unexpected settings read error fails closed (no silent full access)', async () => {
  await assert.rejects(loadHomeownerPermissions(fakeAdmin(null, { message: 'timeout' }), 'job'), (err: unknown) => {
    return err instanceof HttpError && err.status === 500;
  });
});

test('row round-trips through the snake_case columns', () => {
  const perms = all({ seeTranscripts: false, useChat: false });
  assert.deepEqual(homeownerPermissionsFromRow(homeownerPermissionsToRow(perms)), perms);
});

test('Chat and the Evidence report turn off with any content they are built from; downloads need videos', () => {
  for (const key of ['seeVideos', 'seeTranscripts', 'seeAiSummaries', 'seeScope'] as const) {
    const eff = effectiveHomeownerPermissions(all({ [key]: false }));
    assert.equal(eff.useChat, false, key);
    assert.equal(eff.seeEvidenceReport, false, key);
  }
  assert.equal(effectiveHomeownerPermissions(all({ seeVideos: false })).downloadFiles, false);
  assert.deepEqual(effectiveHomeownerPermissions(all()), all());
});

test('assertHomeownerMay denies a homeowner a turned-off permission with 403, never the office or a sub', () => {
  assert.throws(
    () => assertHomeownerMay(homeowner(all({ useChat: false })), 'useChat'),
    (err: unknown) => err instanceof HttpError && err.status === 403 && err.code === 'homeowner_permission_denied',
  );
  assert.doesNotThrow(() => assertHomeownerMay(homeowner(all()), 'useChat'));
  assert.doesNotThrow(() => assertHomeownerMay({ access: 'org' } as any, 'useChat'));
  assert.doesNotThrow(() => assertHomeownerMay({ access: 'viewer', homeownerPermissions: null }, 'useChat'));
});

const payload = {
  videos: [
    {
      id: 'v1',
      aiSummary: 'Tear-off done',
      transcriptText: 'we pulled the shingles',
      heardOnMic: 'x',
      transcriptSegments: [{ text: 'we' }],
      transcriptWords: [{ text: 'we' }],
      conversation: { summary: 'talked' },
      events: [{ t: 1 }],
      rooms: [{ name: 'Roof', findings: ['a'] }],
    },
  ],
  days: [{ id: 'd1', aiSummary: 'Tear-off done', summary: 'Tear-off done' }],
  rooms: [{ name: 'Roof' }],
  counts: { videos: 1, days: 1 },
};

test('videos off: the homeowner\'s videos payload is empty', () => {
  const out: any = applyHomeownerPermissionsToProofPayload(payload, all({ seeVideos: false }));
  assert.deepEqual(out.videos, []);
  assert.deepEqual(out.days, []);
  assert.equal(out.counts.videos, 0);
});

test('transcripts off strips every transcript field; summaries off strips the AI reading', () => {
  const t: any = applyHomeownerPermissionsToProofPayload(payload, all({ seeTranscripts: false }));
  assert.equal(t.videos[0].transcriptText, null);
  assert.equal(t.videos[0].heardOnMic, null);
  assert.deepEqual(t.videos[0].transcriptSegments, []);
  assert.deepEqual(t.videos[0].transcriptWords, []);
  assert.equal(t.videos[0].aiSummary, 'Tear-off done');

  const s: any = applyHomeownerPermissionsToProofPayload(payload, all({ seeAiSummaries: false }));
  assert.equal(s.videos[0].aiSummary, null);
  assert.equal(s.videos[0].conversation, null);
  assert.deepEqual(s.videos[0].rooms[0].findings, []);
  assert.equal(s.days[0].aiSummary, null);
  assert.deepEqual(s.rooms, []);
  assert.equal(s.videos[0].transcriptText, 'we pulled the shingles');
});

test('defaults leave the payload as the homeowner got it before', () => {
  const out: any = applyHomeownerPermissionsToProofPayload(payload, all());
  assert.deepEqual(out.videos, payload.videos);
  assert.deepEqual(out.days, payload.days);
  assert.equal(applyHomeownerPermissionsToProofPayload(payload, null), payload);
});

test('library/clip panel items drop the AI reading and transcript when either is off', () => {
  const item = {
    id: 'p1',
    title: 'Roof tear-off',
    customTitle: null,
    aiTitle: 'Roof tear-off',
    transcriptWords: [{ text: 'hi' }],
    analysis: { summary: 'x', dictation: 'y' },
  };
  const t: any = applyHomeownerPermissionsToLibraryItem(item, all({ seeTranscripts: false }));
  assert.equal(t.analysis, null);
  assert.deepEqual(t.transcriptWords, []);
  const s: any = applyHomeownerPermissionsToLibraryItem(item, all({ seeAiSummaries: false }));
  assert.equal(s.analysis, null);
  assert.equal(s.title, null);
  assert.equal(s.aiTitle, null);
  assert.deepEqual(applyHomeownerPermissionsToLibraryItem(item, all()), item);
});

test('every homeowner-reachable route checks the contractor\'s setting on the server', () => {
  const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
  const proof = src('routes/proofOfWork.ts');
  const body = (file: string, fn: string) => {
    const i = file.indexOf(`export async function ${fn}(`);
    assert.ok(i >= 0, fn);
    return file.slice(i, file.indexOf('\nexport ', i + 10));
  };
  for (const fn of ['askAboutProofs', 'warmProofAsk', 'proofQuestions', 'listJobAskThreads', 'createJobAskThread', 'renameJobAskThread']) {
    assert.match(body(proof, fn), /assertHomeownerMay\(\w+, 'useChat'\)/, fn);
  }
  assert.match(body(proof, 'proofVideoUrl'), /assertHomeownerMay\(viewer, 'seeVideos'\)/);
  assert.match(body(proof, 'jobProofPackPdf'), /assertHomeownerMay\(viewer, 'seeEvidenceReport'\)/);
  assert.match(body(proof, 'jobProofs'), /applyHomeownerPermissionsToProofPayload\(homeownerProofPayload\(payload\), homeownerLimits\(viewer\)\)/);

  const portal = src('routes/evidencePortal.ts');
  assert.match(portal, /assertHomeownerMay\(resolved, 'seeVideos'\)/);
  assert.match(portal, /assertHomeownerMay\(resolved, 'useChat'\)/);
  assert.match(portal, /assertHomeownerMay\(resolved, 'downloadFiles'\)/);
  assert.match(portal, /permsByJob\.get\(p\.job_id as string\)\?\.seeVideos === false/);

  const shared = src('routes/sharedJobs.ts');
  assert.match(shared, /assertHomeownerMay\(resolved, 'seeAccessList'\)/);
  assert.match(shared, /brief: hideScope \? null/);
  assert.match(shared, /scope: hideScope \? \[\] : scope/);
  // Only the job's own office may read or change the settings.
  assert.match(shared, /\(job as any\)\.org_id !== ctx\.orgId/);
  assert.equal((shared.match(/await requireOfficeJob\(req, jobId\)/g) ?? []).length, 3);

  // Homeowner access always carries the settings for that job.
  const grants = src('shared/jobProgressGrants.ts');
  assert.equal((grants.match(/if \(grant\) return homeownerAccess\(req, grant\.orgId, jobId\);/g) ?? []).length, 2);
});

test('the migration keeps writes server-only and gates direct clip reads on the settings', () => {
  const sql = readFileSync(
    new URL('../../supabase/migrations/20261022150000_job_homeowner_permissions.sql', import.meta.url),
    'utf8',
  );
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke insert, update, delete, truncate on public\.job_homeowner_permissions from anon, authenticated/);
  assert.match(sql, /private\.homeowner_may_read_proof_row\(job_id, id, received_at\)/);
  for (const col of ['see_videos', 'see_transcripts', 'see_ai_summaries', 'see_scope', 'see_evidence_report', 'see_access_list', 'use_chat', 'download_files']) {
    assert.match(sql, new RegExp(`${col}\\s+boolean not null default true`), col);
  }
  const mirror = readFileSync(
    new URL('../supabase/migrations/20261022150000_job_homeowner_permissions.sql', import.meta.url),
    'utf8',
  );
  assert.equal(mirror, sql);
});
