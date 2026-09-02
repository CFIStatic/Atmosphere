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

test('clip delete does not open a browser confirm dialog', () => {
  assert.equal(verifierHtml.includes('The chain of custody keeps the record of its life either way.'), false);
  assert.match(verifierHtml, /if \(act === 'delete'\)[\s\S]*deleteLibraryClip\(item\)/);
  assert.doesNotMatch(verifierHtml, /window\.confirm\(\s*'Delete '/);
});

test('deleteEvidence stamps deleted_at with the service-role client', () => {
  const fn = deleteEvidenceSrc.slice(deleteEvidenceSrc.indexOf('export async function deleteEvidence'));
  assert.match(fn, /const writer = createAdminClient\(\) \?\? supabase/);
  assert.match(fn, /\.update\(\{ deleted_at: now, deleted_by: userId \}\)/);
  assert.equal(fn.includes('await supabase\n      .from(\'job_proofs\')'), false);
});

test('job_proofs SELECT policy allows the hide stamp to pass WITH CHECK', () => {
  assert.match(rlsSql, /deleted_at is null or deleted_by = auth\.uid\(\)/);
  assert.match(rlsSql, /drop policy if exists job_proofs_select/);
});
