import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const verifierHtml = readFileSync(resolve(here, '../../../../verifier/index.html'), 'utf8');

describe('Dashboard job-file delete', () => {
  it('puts Delete on the kebab menu next to rename and duplicate', () => {
    const menu = verifierHtml.match(/id="jobmenu"[\s\S]*?<\/div>/);
    expect(menu).not.toBeNull();
    expect(menu![0]).toContain('data-job-act="rename"');
    expect(menu![0]).toContain('data-job-act="duplicate"');
    expect(menu![0]).toContain('data-job-act="delete"');
    expect(menu![0]).toMatch(/data-job-act="delete"[\s\S]*Delete/);
    expect(menu![0]).toContain('class="danger"');
  });

  it('asks for the file name and says the delete cannot be undone', () => {
    expect(verifierHtml).toContain("if (tab === 'delete') return 'Delete this job file'");
    expect(verifierHtml).toContain('This cannot be undone.');
    expect(verifierHtml).toContain('Type <span class="jf-name-exact">');
    expect(verifierHtml).toContain('Delete permanently');
    expect(verifierHtml).toContain('function jobFileDeleteNameMatches');
    expect(verifierHtml).toContain("method: 'DELETE'");
    expect(verifierHtml).toContain('function submitJobFileDelete');
    expect(verifierHtml).toContain('function applyDeletedJob');
    expect(verifierHtml).toContain('function notifyLibraryChanged');
    expect(verifierHtml).toContain("atmosphere: 'library-changed'");
    expect(verifierHtml).toContain('!canOpenJobRecord(key) || !ORG_MODE');
  });

  it('does not paint a raw Forbidden on Create copy', () => {
    expect(verifierHtml).toContain('/^forbidden$/i.test');
    expect(verifierHtml).toContain('Could not duplicate that job file. Try again.');
  });

  it('sizes the Dashboard delete sheet like the office job-file dialog', () => {
    expect(verifierHtml).toContain('class="sheet sheet-narrow"');
    expect(verifierHtml).toMatch(/\.sheet\.sheet-narrow\s*\{[^}]*width:\s*min\(28rem,\s*100%\)/);
    expect(verifierHtml).toMatch(/\.sheet\.sheet-narrow\s*\{[^}]*height:\s*auto/);
    const fullBleed = verifierHtml.indexOf('.sheet {\n    position: relative;\n    width: min(1440px, 100%)');
    const compact = verifierHtml.indexOf('.sheet.sheet-narrow {');
    expect(fullBleed).toBeGreaterThan(-1);
    expect(compact).toBeGreaterThan(fullBleed);
    expect(verifierHtml).toContain('class="jf-actions"');
    expect(verifierHtml).toContain('id="jf-delete-cancel"');
  });
});
