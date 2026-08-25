import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../verifier/index.html'),
  'utf8',
);

describe('verifier dashboard list chrome', () => {
  it('keeps the title outside the scrollport so the column header can sit flush', () => {
    const dash = verifierHtml.match(
      /<div class="screen screen-dashboard" id="screen-dashboard">[\s\S]*?<main class="main">/,
    );
    expect(dash).not.toBeNull();
    expect(dash![0]).toContain('class="list-chrome"');
    expect(dash![0]).toContain('id="viewtitle"');
    expect(dash![0]).toContain('id="resultcount"');
    expect(dash![0]).not.toMatch(/<main class="main">[\s\S]*class="toolbar"/);
  });

  it('sticks the column header at the top of the list with a solid background', () => {
    expect(verifierHtml).toContain('.list-chrome {');
    expect(verifierHtml).toContain('border-collapse: separate');
    expect(verifierHtml).toMatch(/thead th \{[\s\S]*?position: sticky; top: 0;/);
    expect(verifierHtml).toMatch(/thead th \{[\s\S]*?background: var\(--bg\);/);
    expect(verifierHtml).not.toMatch(/thead th \{[\s\S]*?top: 53px/);
    expect(verifierHtml).not.toContain('border-collapse: collapse');
  });
});
