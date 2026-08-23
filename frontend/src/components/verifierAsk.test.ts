import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../verifier/index.html'),
  'utf8',
);

describe('verifier clip Ask tab and live analysis', () => {
  it('puts Ask next to Details on the evidence sheet', () => {
    const tabs = verifierHtml.match(/<div class="tabs" role="tablist">[\s\S]*?<\/div>/);
    expect(tabs).not.toBeNull();
    expect(tabs![0]).toContain('data-tab="details"');
    expect(tabs![0]).toContain('data-tab="ask"');
    expect(tabs![0].indexOf('data-tab="details"')).toBeLessThan(tabs![0].indexOf('data-tab="ask"'));
    expect(tabs![0]).toMatch(/>Ask</);
  });

  it('writes analysis notes as the footage plays rather than dumping the log', () => {
    expect(verifierHtml).toContain('function startLivePlayback');
    expect(verifierHtml).toContain("setAnalysisPill('Writing…')");
    expect(verifierHtml).toContain('Notes land here as the footage plays');
    expect(verifierHtml).toContain('data-full=');
  });

  it('answers clip questions from the reading of that clip', () => {
    expect(verifierHtml).toContain('function answerClipLocally');
    expect(verifierHtml).toContain('Did anything happen');
    expect(verifierHtml).toContain('/api/evidence-portal/evidence/');
    expect(verifierHtml).toContain('/ask');
  });
});
