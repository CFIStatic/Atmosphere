import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const verifierHtml = readFileSync(resolve(here, '../../../../verifier/index.html'), 'utf8');

describe('Dashboard player summary states', () => {
  it('says "Summary still processing" instead of showing a stale summary', () => {
    expect(verifierHtml).toContain("var processing = summaryState === 'updating' || summaryState === 'quarantined';");
    expect(verifierHtml).toContain("var withheld = processing || summaryState === 'failed';");
    expect(verifierHtml).toContain('<strong>Summary still processing.</strong> The transcript below is current.');
    expect(verifierHtml).toContain('id="summary-processing" role="status"');
    // The stale brief is not dimmed and shown any more — it is withheld.
    expect(verifierHtml).not.toContain('summary-stale');
    expect(verifierHtml).toContain("var brief = withheld ? null : (a.conversationExecutiveSummary || summary);");
  });

  it('withholds everything derived from the summary while it is rebuilt', () => {
    expect(verifierHtml).toContain("var moments = withheld ? [] : (a.conversationKeyMoments || []);");
    expect(verifierHtml).toContain("html += factRows('Money', withheld ? [] : (a.conversationMoneyTalk || []));");
  });

  it('never presupposes the homeowner in the clip Ask presets', () => {
    expect(verifierHtml).not.toContain('What did the homeowner say?');
    expect(verifierHtml).toContain('data-ask="What was said in this clip?"');
  });
});
