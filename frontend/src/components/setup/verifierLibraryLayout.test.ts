import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

function read(rel: string) {
  return readFileSync(resolve(repoRoot, rel), 'utf8');
}

const verifierHtml = read('verifier/index.html');
const shell = read('frontend/src/layouts/OperationsShell.tsx');

describe('Dashboard list does not shift the page', () => {
  it('locks document scroll in one place so a list scrollbar cannot move the rail', () => {
    expect(verifierHtml).toMatch(/html, body \{\s*height: 100%;\s*overflow: hidden;/);
    expect(verifierHtml).toContain('.app-frame {');
    expect(verifierHtml).toMatch(/\.app-frame \{[^}]*overflow: hidden;/);
  });

  it('scrolls only the list and reserves the gutter so columns stay put', () => {
    expect(verifierHtml).toMatch(/\.main \{[^}]*overflow-x: hidden;/);
    expect(verifierHtml).toMatch(/\.main \{[^}]*overflow-y: auto;/);
    expect(verifierHtml).toMatch(/\.main \{[^}]*scrollbar-gutter: stable;/);
    expect(verifierHtml).toMatch(/\.screen-dashboard \{[^}]*display: flex;/);
  });

  it('keeps the evidence table from opening a horizontal page scroll', () => {
    expect(verifierHtml).toMatch(/table \{[^}]*table-layout: fixed;/);
    expect(verifierHtml).toMatch(/table \{[^}]*border-collapse: separate;/);
    expect(verifierHtml).not.toMatch(/table \{[^}]*border-collapse: collapse;/);
  });

  it('stops the host page from scrolling under the full-bleed Dashboard', () => {
    expect(shell).toContain("isLibrary");
    expect(shell).toContain("'relative h-screen overflow-hidden bg-paper-100'");
    expect(shell).toContain("'relative min-h-screen overflow-x-hidden bg-paper-100'");
  });
});
