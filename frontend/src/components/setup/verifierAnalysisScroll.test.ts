import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../verifier/index.html'),
  'utf8',
);

describe('verifier analysis scroll follow', () => {
  it('only auto-scrolls the active row while follow is enabled', () => {
    expect(verifierHtml).toContain('analysisFollow');
    expect(verifierHtml).toContain('followActiveAnalysisRow');
    expect(verifierHtml).toContain('isNearScrollBottom');
    expect(verifierHtml).toContain('resumeAnalysisFollow');
    expect(verifierHtml).toMatch(/if\s*\(\s*!analysisFollow\.enabled/);
    // Must not unconditionally scrollIntoView on every sync anymore.
    expect(verifierHtml).not.toMatch(
      /var cur = lastSeen >= 0 \? items\[lastSeen\] : null;\s*if \(cur && cur\.scrollIntoView\) cur\.scrollIntoView/,
    );
  });

  it('keeps speaker labels on a separate line from turn / transcript bodies', () => {
    expect(verifierHtml).toContain('alog-speaker');
    expect(verifierHtml).toContain('alog-quote');
    expect(verifierHtml).toContain('id="exact-transcript"');
    expect(verifierHtml).not.toMatch(
      /<span class="pill">' \+ label \+ '<\/span> ' \+ body/,
    );
  });

  it('exposes a Follow playhead control when the user has scrolled away', () => {
    expect(verifierHtml).toContain('id="alog-follow"');
    expect(verifierHtml).toContain('Follow playhead');
  });
});
