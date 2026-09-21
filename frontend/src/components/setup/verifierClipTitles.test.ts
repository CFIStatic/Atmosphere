import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const verifierHtml = readFileSync(resolve(here, '../../../../verifier/index.html'), 'utf8');

describe('Videos list clip titles', () => {
  it('defines clipListLabel so nested rows do not repeat the job name', () => {
    expect(verifierHtml).toContain('function clipListLabel(e, underJob)');
    expect(verifierHtml).toContain('Never repeat the job name on nested rows');
    expect(verifierHtml).toContain("if (underJob) return 'Video'");
    expect(verifierHtml).toContain("var clipName = clipListLabel(e, underJob)");
    expect(verifierHtml).toContain('data-clip-title="');
    expect(verifierHtml).toContain("esc(clipName)");
    expect(verifierHtml).toContain('class="clip-title-row"');
  });

  it('maps portal title onto each library item', () => {
    expect(verifierHtml).toContain('title: raw.title || null');
  });


  it('never uses Video · clock time as the sole list fallback', () => {
    expect(verifierHtml).toContain('function shortClipListId(e)');
    expect(verifierHtml).toContain("if (shortId) return 'Video · ' + shortId");
    expect(verifierHtml).not.toContain("if (time) return 'Video · ' + time");
    expect(verifierHtml).toContain('clipId: raw.clipId || null');
  });

  it('keeps nested clip titles visible on phone cards', () => {
    expect(verifierHtml).not.toMatch(
      /tbody tr\.cliprow-nested td\.titlecell \.t \{ display: none; \}/,
    );
  });
});

describe('verifier failed reading retry', () => {
  it('exposes Try reading again for failed Scope of Work readings in org mode', () => {
    expect(verifierHtml).toContain('data-retry-read');
    expect(verifierHtml).toContain('Try reading again');
    expect(verifierHtml).toContain("/retry-read");
    expect(verifierHtml).toContain('function retryClipReading');
  });
});

describe('Videos list manual rename', () => {
  it('offers Rename in the clip ⋯ menu and inline pencil / double-click', () => {
    expect(verifierHtml).toContain('data-act="rename"');
    expect(verifierHtml).toContain('function startClipRename');
    expect(verifierHtml).toContain('function saveClipRename');
    expect(verifierHtml).toContain('data-clip-rename');
    expect(verifierHtml).toContain('data-clip-title');
    expect(verifierHtml).toContain("act === 'rename'");
  });

  it('maps customTitle and aiTitle from the portal library payload', () => {
    expect(verifierHtml).toContain('customTitle: raw.customTitle || null');
    expect(verifierHtml).toContain('aiTitle: raw.aiTitle || null');
  });

  it('PATCHes customTitle and falls back to AI when cleared', () => {
    expect(verifierHtml).toContain("/api/evidence-portal/evidence/");
    expect(verifierHtml).toContain("JSON.stringify({ customTitle: nextTitle || null })");
    expect(verifierHtml).toContain("toast(nextTitle ? 'Video renamed.' : 'Back to AI label.')");
  });

  it('clipListLabel prefers customTitle over the AI title', () => {
    expect(verifierHtml).toContain("var custom = String(e.customTitle || '').trim()");
    expect(verifierHtml).toContain("var stored = String(e.aiTitle || e.title || '').trim()");
  });
});
