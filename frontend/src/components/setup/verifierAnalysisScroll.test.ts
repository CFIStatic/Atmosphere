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
    expect(verifierHtml).toContain('scrollRowInSide');
    expect(verifierHtml).toMatch(/if\s*\(\s*!analysisFollow\.enabled/);
    // Contained side-panel scroll only — never scrollIntoView (auto-pause).
    expect(verifierHtml).not.toMatch(
      /followActiveAnalysisRow[\s\S]{0,200}scrollIntoView/,
    );
    expect(verifierHtml).toContain("var analysisFollow = { enabled: false");
    expect(verifierHtml).toContain('followOn && isPlayhead');
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
