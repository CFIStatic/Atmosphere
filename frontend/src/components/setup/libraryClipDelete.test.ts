import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const verifierHtml = readFileSync(resolve(here, '../../../../verifier/index.html'), 'utf8');
const verifierFrame = readFileSync(resolve(here, '../VerifierFrame.tsx'), 'utf8');

describe('Dashboard clip delete', () => {
  it('removes the clip from the live record, not only this view', () => {
    expect(verifierHtml).toContain('function deleteLibraryClip');
    expect(verifierHtml).toContain('function applyDeletedClip');
    expect(verifierHtml).toContain("method: 'DELETE'");
    expect(verifierHtml).toContain("/evidence/' + encodeURIComponent(item.id)");
    expect(verifierHtml).toContain("atmosphere: 'library-changed'");
    expect(verifierHtml).not.toContain('Deletion on the record itself is wired next.');
  });

  it('tells the office shell so Overview can drop the clip', () => {
    expect(verifierFrame).toContain("data.atmosphere === 'library-changed'");
    expect(verifierFrame).toContain('notifyLibraryChanged');
  });
});
