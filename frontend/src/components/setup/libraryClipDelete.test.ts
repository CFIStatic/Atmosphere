import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const verifierHtml = readFileSync(resolve(here, '../../../../verifier/index.html'), 'utf8');
const verifierFrame = readFileSync(resolve(here, '../VerifierFrame.tsx'), 'utf8');
const softDeleteRlsSql = readFileSync(
  resolve(here, '../../../../supabase/migrations/20260902010000_job_proofs_soft_delete_rls.sql'),
  'utf8',
);
const deleteEvidenceSrc = readFileSync(
  resolve(here, '../../../../backend/src/routes/proofOfWork.ts'),
  'utf8',
);

describe('Dashboard clip delete', () => {
  it('removes the clip from the live record, not only this view', () => {
    expect(verifierHtml).toContain('function deleteLibraryClip');
    expect(verifierHtml).toContain('function applyDeletedClip');
    expect(verifierHtml).toContain("method: 'DELETE'");
    expect(verifierHtml).toContain("/evidence/' + encodeURIComponent(item.id)");
    expect(verifierHtml).toContain("atmosphere: 'library-changed'");
    expect(verifierHtml).not.toContain('Deletion on the record itself is wired next.');
  });

  it('deletes on the menu click without a browser confirm dialog', () => {
    expect(verifierHtml).not.toContain(
      'The chain of custody keeps the record of its life either way.',
    );
    expect(verifierHtml).not.toMatch(/window\.confirm\(\s*'Delete '/);
    expect(verifierHtml).toMatch(/if \(act === 'delete'\)[\s\S]*deleteLibraryClip\(item\)/);
  });

  it('lets the hide stamp survive job_proofs RLS', () => {
    expect(softDeleteRlsSql).toContain('deleted_at is null or deleted_by = auth.uid()');
    expect(softDeleteRlsSql).toContain('drop policy if exists job_proofs_select');
    expect(deleteEvidenceSrc).toContain('createAdminClient() ?? supabase');
    expect(deleteEvidenceSrc).toMatch(
      /export async function deleteEvidence[\s\S]*const writer = createAdminClient\(\) \?\? supabase/,
    );
  });

  it('tells the office shell so Overview can drop the clip', () => {
    expect(verifierFrame).toContain("data.atmosphere === 'library-changed'");
    expect(verifierFrame).toContain('notifyLibraryChanged');
  });
});
