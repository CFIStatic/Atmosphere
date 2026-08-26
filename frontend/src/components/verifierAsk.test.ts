import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../verifier/index.html'),
  'utf8',
);

function bootVerifier() {
  return new JSDOM(verifierHtml, {
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
}

describe('verifier clip Ask tab and live analysis', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('puts Ask next to Details on the evidence sheet', () => {
    const tabs = verifierHtml.match(/<div class="tabs" role="tablist">[\s\S]*?<\/div>/);
    expect(tabs).not.toBeNull();
    expect(tabs![0]).toContain('data-tab="details"');
    expect(tabs![0]).toContain('data-tab="ask"');
    expect(tabs![0].indexOf('data-tab="details"')).toBeLessThan(tabs![0].indexOf('data-tab="ask"'));
    expect(tabs![0]).toMatch(/>Ask</);
  });

  it('shows what the AI saw on the Scope of work tab without requiring playback', () => {
    expect(verifierHtml).toContain('function startLivePlayback');
    expect(verifierHtml).toContain('What the AI saw, in order');
    expect(verifierHtml).toContain('You do not have to watch the clip');
    expect(verifierHtml).toContain('data-full=');
  });

  it('answers clip questions from the reading of that clip', () => {
    expect(verifierHtml).toContain('function answerClipLocally');
    expect(verifierHtml).toContain('Did anything happen');
    expect(verifierHtml).toContain('At any point did the worker go in the bathroom?');
    expect(verifierHtml).toContain('/api/evidence-portal/evidence/');
    expect(verifierHtml).toContain('/ask');
    expect(verifierHtml).toContain('function durSpoken');
  });

  it('opens a demo clip, shows the reading immediately, and answers from it', async () => {
    const dom = bootVerifier();

    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    const { document } = dom.window;
    const row = document.querySelector('tr[data-id="EV-1038-0805-A"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    expect(document.getElementById('detail')?.getAttribute('data-open')).toBe('1');
    expect(document.getElementById('d-saw')).not.toBeNull();
    expect(document.getElementById('d-saw')?.textContent).toMatch(/tarp/i);
    expect(document.getElementById('alog')).not.toBeNull();
    const notes = Array.from(document.querySelectorAll('#alog [data-full]'));
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.some((el) => (el.textContent || '').length > 0)).toBe(true);

    const askTab = document.querySelector('[data-tab="ask"]') as HTMLElement | null;
    expect(askTab).not.toBeNull();
    askTab!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

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
    dom.window.close();
  });

  it('answers a bathroom question from the workday reading with a spoken timestamp', async () => {
    const dom = bootVerifier();

    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    const { document } = dom.window;
    const row = document.querySelector('tr[data-id="EV-1041-0804-W"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    expect(document.getElementById('d-saw')?.textContent).toMatch(/bathroom/i);

    const askTab = document.querySelector('[data-tab="ask"]') as HTMLElement | null;
    askTab!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    const suggest = document.querySelector(
      '[data-ask="At any point did the worker go in the bathroom?"]',
    ) as HTMLElement | null;
    expect(suggest).not.toBeNull();
    suggest!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    await new Promise((resolveWait) => setTimeout(resolveWait, 40));
    const reply = Array.from(document.querySelectorAll('.ask-bubble.assistant'))
      .map((el) => el.textContent || '')
      .join('\n');
    expect(reply).toMatch(/^Yes\./);
    expect(reply).toMatch(/bathroom/i);
    expect(reply).toMatch(/mirror/i);
    expect(reply).toMatch(/1 hour and 52 minutes into the recording/);
    dom.window.close();
  });

  it('extracts homeowner talk from a walkthrough and answers from the mic', async () => {
    const dom = bootVerifier();

    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    const { document } = dom.window;
    const row = document.querySelector('tr[data-id="EV-1041-0804-T"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    expect(document.body.textContent).toMatch(/Heard on the mic/);
    expect(document.body.textContent).toMatch(/insurance/i);
    expect(document.body.textContent).toMatch(/vanity/i);

    const askTab = document.querySelector('[data-tab="ask"]') as HTMLElement | null;
    askTab!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    const suggest = document.querySelector(
      '[data-ask="What did the homeowner say?"]',
    ) as HTMLElement | null;
    expect(suggest).not.toBeNull();
    suggest!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    await new Promise((resolveWait) => setTimeout(resolveWait, 40));
    const reply = Array.from(document.querySelectorAll('.ask-bubble.assistant'))
      .map((el) => el.textContent || '')
      .join('\n');
    expect(reply).toMatch(/^Yes/);
    expect(reply).toMatch(/vanity|insurance|cabinets/i);
    dom.window.close();
  });
});
