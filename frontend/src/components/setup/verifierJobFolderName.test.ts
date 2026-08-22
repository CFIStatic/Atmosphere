import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../verifier/index.html'),
  'utf8',
);

describe('verifier dashboard job folder names', () => {
  it('never appends #jobNumber next to the folder title', () => {
    expect(verifierHtml).toContain('function displayJobName');
    expect(verifierHtml).toContain('var nameInner = esc(displayJobName(job.name))');
    expect(verifierHtml).not.toMatch(/nameInner = esc\(job\.name\) \+ \(job\.number/);
    expect(verifierHtml).not.toContain("'<span class=\"id\">#'");
  });

  it('strips a leftover hash suffix from stored job titles', () => {
    const match = verifierHtml.match(/function displayJobName\(name\) \{[\s\S]*?\n  \}/);
    expect(match).not.toBeNull();
    const dom = new JSDOM(`<!doctype html><html><body><script>${match![0]}</script></body></html>`, {
      runScripts: 'dangerously',
    });
    const displayJobName = (dom.window as unknown as { displayJobName: (name: string) => string })
      .displayJobName;
    expect(displayJobName('test one #2')).toBe('test one');
    expect(displayJobName('1842 Meridian Ave #1')).toBe('1842 Meridian Ave');
    expect(displayJobName('Cedar Ridge rebuild')).toBe('Cedar Ridge rebuild');
    expect(displayJobName('')).toBe('Job');
  });
});
