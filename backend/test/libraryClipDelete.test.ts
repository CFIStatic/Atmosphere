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

test('clip delete does not open a browser confirm dialog', () => {
  assert.equal(verifierHtml.includes('The chain of custody keeps the record of its life either way.'), false);
  assert.match(verifierHtml, /if \(act === 'delete'\)[\s\S]*deleteLibraryClip\(item\)/);
  assert.doesNotMatch(verifierHtml, /window\.confirm\(\s*'Delete '/);
});

test('deleteEvidence is Global Admin only and queues a 30-day purge', () => {
  const fn = deleteEvidenceSrc.slice(deleteEvidenceSrc.indexOf('export async function deleteEvidence'));
  const end = fn.indexOf('export async function restoreEvidence');
  const body = end > 0 ? fn.slice(0, end) : fn;
  assert.match(body, /assertGlobalAdminCanDeleteVideo\(role\)/);
  assert.match(body, /scheduled_purge_at:\s*purgeAt/);
  assert.match(body, /const writer = writerForJob\(\{ orgId, jobId: req\.params\.jobId \}, supabase\)\.raw/);
  assert.equal(body.includes("await supabase\n      .from('job_proofs')"), false);
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

test('verifier hides delete for non–Global Admins and offers restore while pending', () => {
  assert.match(verifierHtml, /function isSessionGlobalAdmin/);
  assert.match(verifierHtml, /function restoreLibraryClip/);
  assert.match(verifierHtml, /Queued for permanent deletion in 30 days/);
  assert.match(verifierHtml, /delBtn\.hidden = !admin \|\| pending/);
});

test('job file delete is Global Admin only and queues proof purges', () => {
  const shared = readFileSync(join(here, '../src/routes/sharedJobs.ts'), 'utf8');
  const start = shared.indexOf("sharedJobsRouter.delete('/shared/:jobId'");
  assert.ok(start > 0);
  const fn = shared.slice(start, start + 2500);
  assert.match(fn, /requireGlobalAdmin\(req\)/);
  assert.match(shared, /scheduled_purge_at:\s*purgeAt/);
  assert.match(shared, /evidence\/:proofId\/restore', restoreEvidence/);
});
