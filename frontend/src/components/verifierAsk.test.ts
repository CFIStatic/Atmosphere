import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../verifier/index.html'),
  'utf8',
);

describe('verifier clip Ask tab and live analysis', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('merges live analysis into one Analysis panel on the evidence sheet', () => {
    const tabs = verifierHtml.match(/<div class="tabs" role="tablist">[\s\S]*?<\/div>/);
    expect(tabs).not.toBeNull();
    expect(tabs![0]).toContain('data-tab="ask"');
    expect(tabs![0]).toContain('data-tab="details"');
    expect(tabs![0]).toContain('data-tab="custody"');
    expect(tabs![0]).not.toContain('data-tab="integrity"');
    expect(tabs![0]).not.toMatch(/>Scope of work</);
    expect(tabs![0]).not.toMatch(/>Ask</);
    expect(tabs![0]).toMatch(/>Analysis</);
  });

  it('writes analysis notes as the footage plays rather than dumping the log', () => {
    expect(verifierHtml).toContain('function startLivePlayback');
    expect(verifierHtml).toContain('<!-- ask-panel 2026-08-23-bar2 -->');
    expect(verifierHtml).toContain('function bindVideoProgress');
    expect(verifierHtml).toContain('id="d-progress"');
    expect(verifierHtml).not.toContain('<video controls');
    expect(verifierHtml).toContain('id="d-livecap"');
    expect(verifierHtml).toContain('function paintLiveCaption');
    expect(verifierHtml).toContain('function startLiveWatch');
    expect(verifierHtml).toContain("setAnalysisPill('Writing…')");
    expect(verifierHtml).toContain('as you watch');
    expect(verifierHtml).toContain('data-full=');
    expect(verifierHtml).not.toContain('Ask this clip');
    expect(verifierHtml).not.toMatch(/>Did anything happen\?</);
  });

  it('watches the file on screen even when official dictation was skipped', () => {
    expect(verifierHtml).toContain('item._remote || item._videoUrl');
    expect(verifierHtml).not.toContain("if (s === 'paired' || s === 'skipped' || s === 'failed')");
    expect(verifierHtml).toContain('/watch');
  });

  it('opens a demo clip and lands notes as frames play, without the Ask this clip block', async () => {
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
    expect(document.getElementById('ask-form')).toBeNull();
    expect(document.getElementById('ask-thread')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Ask this clip/i);
    expect(document.getElementById('d-meta')?.textContent || '').not.toMatch(/EV-1038-0805-A/);
    expect(document.getElementById('d-meta')?.textContent || '').not.toMatch(/\bafter\b/);

    await new Promise((resolveWait) => setTimeout(resolveWait, 900));
    const notes = Array.from(document.querySelectorAll('#alog li:not(.soon) [data-full]'));
    expect(notes.length).toBeGreaterThan(0);
    expect(document.querySelectorAll('#alog li:not(.soon) [data-full]').length).toBeGreaterThan(0);
    dom.window.close();
  });
});
