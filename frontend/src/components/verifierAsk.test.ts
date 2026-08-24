import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../verifier/index.html'),
  'utf8',
);

describe('verifier clip Analysis tab', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('puts live notes and Ask on one Analysis tab', () => {
    const tabs = verifierHtml.match(/<div class="tabs" role="tablist">[\s\S]*?<\/div>/);
    expect(tabs).not.toBeNull();
    expect(tabs![0]).toContain('data-tab="analysis"');
    expect(tabs![0]).toMatch(/>Analysis</);
    expect(tabs![0]).toContain('data-tab="custody"');
    expect(tabs![0]).toContain('data-tab="details"');
    expect(tabs![0]).not.toContain('data-tab="ask"');
    expect(tabs![0]).not.toContain('Scope of work');
    expect(tabs![0].indexOf('data-tab="analysis"')).toBeLessThan(tabs![0].indexOf('data-tab="details"'));
  });

  it('writes analysis notes as the footage plays rather than dumping the log', () => {
    expect(verifierHtml).toContain('function startLivePlayback');
    expect(verifierHtml).toContain("setAnalysisPill('Writing…')");
    expect(verifierHtml).toContain('function tickWatch');
    expect(verifierHtml).toContain('/watch');
    expect(verifierHtml).toContain('data-full=');
    expect(verifierHtml).toContain('function renderAnalysisPane');
    expect(verifierHtml).toContain('class="analysis-ask"');
  });

  it('answers clip questions from the reading of that clip', () => {
    expect(verifierHtml).toContain('function answerClipLocally');
    expect(verifierHtml).toContain('Did anything happen');
    expect(verifierHtml).toContain('/api/evidence-portal/evidence/');
    expect(verifierHtml).toContain('/ask');
    expect(verifierHtml).toContain('watchNotes');
  });

  it('opens a demo clip on Analysis, lands notes as frames play, and answers from the reading', async () => {
    const dom = new JSDOM(verifierHtml, {
      url: 'https://atmosphere.test/verifier/?demo=1',
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      beforeParse(window) {
        window.fetch = () => Promise.reject(new Error('offline'));
        window.matchMedia = ((query: string) => ({
          matches: false,
          media: query,
          addEventListener() {},
          removeEventListener() {},
          addListener() {},
          removeListener() {},
          dispatchEvent() {
            return false;
          },
        })) as unknown as typeof window.matchMedia;
      },
    });

    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    const { document } = dom.window;
    const row = document.querySelector('tr[data-id="EV-1038-0805-A"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    expect(document.getElementById('detail')?.getAttribute('data-open')).toBe('1');
    expect(document.getElementById('alog')).not.toBeNull();
    expect(document.getElementById('ask-form')).not.toBeNull();
    expect(document.querySelector('[data-tab="analysis"]')?.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[data-tab="ask"]')).toBeNull();

    await new Promise((resolveWait) => setTimeout(resolveWait, 900));
    const notes = Array.from(document.querySelectorAll('#alog li:not(.soon) [data-full]'));
    expect(notes.length).toBeGreaterThan(0);

    const suggest = document.querySelector(
      '[data-ask="Did anything happen in this clip?"]',
    ) as HTMLElement | null;
    expect(suggest).not.toBeNull();
    suggest!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    await new Promise((resolveWait) => setTimeout(resolveWait, 40));
    const reply = Array.from(document.querySelectorAll('.ask-bubble.assistant'))
      .map((el) => el.textContent || '')
      .join('\n');
    expect(reply).toMatch(/Tarp removed|footage/i);
    expect(document.getElementById('alog')).not.toBeNull();

    const custodyTab = document.querySelector('[data-tab="custody"]') as HTMLElement;
    custodyTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('ask-form')).toBeNull();

    const analysisTab = document.querySelector('[data-tab="analysis"]') as HTMLElement;
    analysisTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('alog')).not.toBeNull();
    expect(document.getElementById('ask-form')).not.toBeNull();
    expect(document.querySelector('.ask-bubble.assistant')?.textContent || '').toMatch(/Tarp removed|footage/i);
    dom.window.close();
  });
});
