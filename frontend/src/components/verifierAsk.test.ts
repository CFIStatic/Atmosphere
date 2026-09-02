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

  it('puts Details to the right of Ask on the evidence sheet', () => {
    const tabs = verifierHtml.match(/<div class="tabs" role="tablist">[\s\S]*?<\/div>/);
    expect(tabs).not.toBeNull();
    expect(tabs![0]).toMatch(/>Analysis</);
    expect(tabs![0]).toContain('data-tab="ask"');
    expect(tabs![0]).toContain('data-tab="details"');
    expect(tabs![0].indexOf('data-tab="ask"')).toBeLessThan(tabs![0].indexOf('data-tab="details"'));
    expect(tabs![0]).toMatch(/>Ask</);
    expect(tabs![0]).toMatch(/>Details</);
    expect(tabs![0]).not.toMatch(/Viewing History/i);
    expect(tabs![0]).not.toMatch(/data-tab="custody"/);
    expect(tabs![0]).not.toMatch(/Scope of work/i);
    expect(tabs![0]).not.toMatch(/Chain of custody/i);
    expect(verifierHtml).toContain('Answers come from the Analysis reading');
    expect(verifierHtml).not.toContain('Answers come from the Scope of Work reading');
    expect(verifierHtml).toContain('function renderViewingHistory');
    expect(verifierHtml).toContain('function renderClipDetails');
    expect(verifierHtml.indexOf('renderViewingHistory(item)')).toBeLessThan(
      verifierHtml.indexOf('renderClipDetails(item)'),
    );
  });

  it('shows what the AI saw on the Analysis tab without requiring playback', () => {
    expect(verifierHtml).toContain('function startLivePlayback');
    expect(verifierHtml).toContain('What the AI saw, in order');
    expect(verifierHtml).toContain('You do not have to watch the clip');
    expect(verifierHtml).toContain('function watchRemoteReading');
    expect(verifierHtml).toContain('data-full=');
    expect(verifierHtml).not.toContain('<h4>AI analysis</h4>');
    expect(verifierHtml).toContain('function isSceneViewNote');
  });

  it('answers clip questions from the reading of that clip', () => {
    expect(verifierHtml).toContain('function answerClipLocally');
    expect(verifierHtml).toContain('Did anything happen');
    expect(verifierHtml).toContain('At any point did the worker go in the bathroom?');
    expect(verifierHtml).toContain('/api/evidence-portal/evidence/');
    expect(verifierHtml).toContain('/ask');
    expect(verifierHtml).toContain('function durSpoken');
    expect(verifierHtml).toContain('This clip is still being read');
    expect(verifierHtml).not.toContain('This clip has not been read yet');
    expect(verifierHtml).toContain('This clip could not be read');
    expect(verifierHtml).toContain('function applyRemoteReading');
  });

  it('opens a demo clip, shows the reading immediately, and answers from it', async () => {
    const dom = bootVerifier();

    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    const { document } = dom.window;
    const row = document.querySelector('tr[data-id="EV-1038-0805-A"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    expect(document.getElementById('detail')?.getAttribute('data-open')).toBe('1');
    const tabLabels = Array.from(document.querySelectorAll('.tabs [role="tab"]')).map(
      (el) => (el.textContent || '').trim(),
    );
    expect(tabLabels).toEqual(['Analysis', 'Ask', 'Details']);
    expect(document.getElementById('d-saw')).not.toBeNull();
    expect(document.getElementById('d-saw')?.textContent).toMatch(/tarp/i);
    expect(document.getElementById('alog-pill')).toBeNull();
    expect(document.getElementById('d-panel')?.textContent).not.toMatch(/AI analysis/i);
    expect(document.getElementById('alog')).not.toBeNull();
    const notes = Array.from(document.querySelectorAll('#alog [data-full]'));
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.some((el) => (el.textContent || '').length > 0)).toBe(true);
    expect(document.getElementById('d-panel')?.textContent).not.toMatch(
      /Viewing an office desk setup with multiple active computer screens/i,
    );

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

  it('does not ask for an after clip when you ask what is happening', async () => {
    const dom = bootVerifier();

    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    const { document } = dom.window;
    const row = document.querySelector('tr[data-id="EV-1038-0806-B"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    const askTab = document.querySelector('[data-tab="ask"]') as HTMLElement | null;
    askTab!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    const suggest = document.querySelector(
      '[data-ask="What is happening in this video?"]',
    ) as HTMLElement | null;
    expect(suggest).not.toBeNull();
    suggest!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    await new Promise((resolveWait) => setTimeout(resolveWait, 40));
    const reply = Array.from(document.querySelectorAll('.ask-bubble.assistant'))
      .map((el) => el.textContent || '')
      .join('\n');
    expect(reply).not.toMatch(/after video/i);
    expect(reply).toMatch(/panel|breaker|garage|footage|reading of this clip/i);
    dom.window.close();
  });

  it('does not put AI analysis chrome or scene-viewing notes on the Scope of work tab', async () => {
    const dom = bootVerifier();

    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    const { document } = dom.window;
    const row = document.querySelector('tr[data-id="EV-1038-0805-A"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    const panel = document.getElementById('d-panel')?.textContent || '';
    expect(document.getElementById('alog-pill')).toBeNull();
    expect(panel).not.toMatch(/AI analysis/i);
    expect(panel).not.toMatch(/\bPaused\b/i);
    expect(panel).not.toMatch(
      /Viewing an office desk setup with multiple active computer screens/i,
    );
    expect(document.getElementById('d-saw')?.textContent).toMatch(/tarp/i);
    expect(document.getElementById('alog')?.textContent).toMatch(/tarp gone/i);
    dom.window.close();
  });

  it('shows a wait note only while a clip is actually queued, not after a skip', async () => {
    const dom = bootVerifier();

    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    const { document } = dom.window;
    const row = document.querySelector('tr[data-id="EV-1044-0730-A"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    expect(document.getElementById('alog-pill')).toBeNull();
    expect(document.querySelector('.alog-wait')?.textContent).toMatch(/Queued for analysis/i);
    expect(document.getElementById('d-saw')).toBeNull();
    expect(document.getElementById('d-panel')?.textContent).not.toMatch(/AI analysis|Paused/i);
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

  it('stacks viewing history above clip details on the combined Details tab', async () => {
    const dom = bootVerifier();

    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    const { document } = dom.window;
    const row = document.querySelector('tr[data-id="EV-1038-0805-A"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    const detailsTab = document.querySelector('[data-tab="details"]') as HTMLElement | null;
    expect(detailsTab).not.toBeNull();
    detailsTab!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    const viewing = document.querySelector('[data-section="viewing-history"]') as HTMLElement | null;
    const clip = document.querySelector('[data-section="clip-details"]') as HTMLElement | null;
    expect(viewing).not.toBeNull();
    expect(clip).not.toBeNull();
    expect(viewing!.compareDocumentPosition(clip!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(viewing!.textContent).toMatch(/Viewing history/i);
    expect(viewing!.textContent).toMatch(/viewed/i);
    expect(viewing!.querySelectorAll('.custody li').length).toBeGreaterThan(0);
    expect(clip!.textContent).toMatch(/Clip details/i);
    expect(clip!.textContent).toMatch(/Evidence ID/);
    expect(clip!.textContent).toContain('EV-1038-0805-A');
    expect(document.querySelector('[data-tab="custody"]')).toBeNull();
    expect(document.querySelector('[data-tab="ask"]')?.nextElementSibling).toBe(detailsTab);
    dom.window.close();
  });
});
