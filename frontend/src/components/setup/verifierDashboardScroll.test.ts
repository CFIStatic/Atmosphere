import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../verifier/index.html'),
  'utf8',
);

describe('verifier dashboard scrollbar', () => {
  it('makes the clip list a right-edge scrollport instead of clipping it', () => {
    expect(verifierHtml).toMatch(/\.screen-dashboard\s*\{[\s\S]*?display:\s*flex/);
    expect(verifierHtml).toMatch(/\.main\s*\{[\s\S]*?overflow-y:\s*scroll/);
    expect(verifierHtml).toContain('.main::-webkit-scrollbar');
    expect(verifierHtml).toMatch(/\.main::-webkit-scrollbar\s*\{[\s\S]*?width:\s*14px/);
  });

  it('keeps the video table inside that scrolling main pane', () => {
    const main = verifierHtml.match(/<main class="main">[\s\S]*?<\/main>/);
    expect(main).not.toBeNull();
    expect(main![0]).toContain('id="clip-table"');
    expect(main![0]).toContain('class="tablewrap"');
  });
});
