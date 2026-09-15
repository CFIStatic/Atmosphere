import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const deleteEvidenceSrc = readFileSync(join(here, '../src/routes/proofOfWork.ts'), 'utf8');
const verifierHtml = readFileSync(join(here, '../../verifier/index.html'), 'utf8');
const rlsSql = readFileSync(
  join(here, '../../supabase/migrations/20260902010000_job_proofs_soft_delete_rls.sql'),
  'utf8',
);
const purgeSql = readFileSync(
  join(here, '../../supabase/migrations/20260911120000_job_proofs_scheduled_purge.sql'),
  'utf8',
);

test('clip overflow menu has no Delete affordance', () => {
  assert.equal(verifierHtml.includes('data-act="delete"'), false);
  assert.equal(verifierHtml.includes('function deleteLibraryClip'), false);
  assert.match(verifierHtml, /data-act="restore"/);
  assert.match(verifierHtml, /data-act="share"/);
  assert.match(verifierHtml, /function restoreLibraryClip/);
});

test('deleteEvidence returns 410 so product clients cannot queue a purge', () => {
  const fn = deleteEvidenceSrc.slice(deleteEvidenceSrc.indexOf('export async function deleteEvidence'));
  const end = fn.indexOf('export async function restoreEvidence');
  const body = end > 0 ? fn.slice(0, end) : fn;
  assert.match(body, /410/);
  assert.match(body, /evidence_delete_removed/);
  assert.doesNotMatch(body, /scheduled_purge_at:\s*purgeAt/);
});

test('restoreEvidence clears the pending purge for Global Admin', () => {
  const fn = deleteEvidenceSrc.slice(deleteEvidenceSrc.indexOf('export async function restoreEvidence'));
  assert.match(fn, /requireGlobalAdmin\(req\)/);
  assert.match(fn, /scheduled_purge_at:\s*null/);
  assert.match(fn, /action:\s*'video\.restored'/);
});

test('job_proofs SELECT policy allows the hide stamp to pass WITH CHECK', () => {
  assert.match(rlsSql, /deleted_at is null or deleted_by = auth\.uid\(\)/);
  assert.match(rlsSql, /drop policy if exists job_proofs_select/);
});

test('scheduled_purge_at migration exists for the 30-day queue', () => {
  assert.match(purgeSql, /scheduled_purge_at/);
  assert.match(purgeSql, /job_proofs_scheduled_purge_idx/);
});

test('verifier keeps restore for pending purge and never shows Delete', () => {
  assert.match(verifierHtml, /function isSessionGlobalAdmin/);
  assert.match(verifierHtml, /function restoreLibraryClip/);
  assert.equal(verifierHtml.includes('rowmenu-delete'), false);
  assert.equal(verifierHtml.includes('Queued for permanent deletion in 30 days'), false);
});

test('job file DELETE API is gone; restore route remains', () => {
  const shared = readFileSync(join(here, '../src/routes/sharedJobs.ts'), 'utf8');
  const start = shared.indexOf("sharedJobsRouter.delete('/shared/:jobId'");
  assert.ok(start > 0);
  const fn = shared.slice(start, start + 800);
  assert.match(fn, /410/);
  assert.match(fn, /job_file_delete_removed/);
  assert.match(shared, /evidence\/:proofId\/restore', restoreEvidence/);
});
