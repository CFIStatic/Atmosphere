import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../verifier/index.html'),
  'utf8',
);

describe('verifier clip reading and Ask', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('has no Ask tab — the thread lives under the reading it is about', () => {
    const tabs = verifierHtml.match(/<div class="tabs" role="tablist">[\s\S]*?<\/div>/);
    expect(tabs).not.toBeNull();
    expect(tabs![0]).toContain('data-tab="integrity"');
    expect(tabs![0]).toContain('data-tab="details"');
    expect(tabs![0]).not.toContain('data-tab="ask"');
    expect(verifierHtml).toContain('function renderWorkPanel');
  });

  it('keeps the composer outside the scrolling panel so it sits on the bottom edge', () => {
    // The footer is a sibling of #d-panel, not a child, so a long reading
    // scrolls under the box rather than pushing it off screen.
    expect(verifierHtml).toMatch(/<div id="d-panel"><\/div>\s*(<!--[\s\S]*?-->\s*)?<div class="sidefoot" id="d-foot" hidden><\/div>/);
    expect(verifierHtml).toContain('function askComposerHTML');
    expect(verifierHtml).toContain('foot.innerHTML = askComposerHTML()');
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

  it('prints the recorded reason instead of claiming a clip is being read', () => {
    expect(verifierHtml).toContain('function analysisReasonText');
    // The old page told every unread clip that no after video was on file,
    // including afters. The server's sentence wins now.
    expect(verifierHtml).toContain('reason: raw.analysisReason || null');
    expect(verifierHtml).not.toContain(
      "a.state === 'skipped' ? 'There is no after video on file for this day",
    );
  });

  it('offers to read a clip nothing has been read from, in org mode only', () => {
    expect(verifierHtml).toContain('function canRunAnalysis');
    expect(verifierHtml).toContain('if (!ORG_MODE || !item._remote) return false;');
    expect(verifierHtml).toContain('/analyse');
  });

  it('opens a demo clip, lands notes as frames play, and answers in the same panel', async () => {
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
    // Both halves render together: the reading and the thread about it.
    expect(document.getElementById('alog')).not.toBeNull();
    expect(document.getElementById('ask-block')).not.toBeNull();

    // The composer is in the pinned footer, never inside the scrolling panel.
    const foot = document.getElementById('d-foot') as HTMLElement;
    expect(foot.hidden).toBe(false);
    expect(foot.querySelector('#ask-input')).not.toBeNull();
    expect(document.querySelector('#d-panel #ask-input')).toBeNull();

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
    // Asking must not rewind the reading the answer is about.
    expect(document.querySelectorAll('#alog li:not(.soon) [data-full]').length).toBeGreaterThan(0);
    dom.window.close();
  });

  it('hides the composer on tabs that have nothing to ask about', async () => {
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
    row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    const details = document.querySelector('[data-tab="details"]') as HTMLElement;
    details.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    expect((document.getElementById('d-foot') as HTMLElement).hidden).toBe(true);

    const work = document.querySelector('[data-tab="integrity"]') as HTMLElement;
    work.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    expect((document.getElementById('d-foot') as HTMLElement).hidden).toBe(false);
    dom.window.close();
  });

  /**
   * The clip that started this: a real two-second after clip that the
   * pipeline never read. The panel used to say "the assistant is reading
   * this clip" forever and the Ask tab claimed the day had no after video.
   * It now names the reason and offers to go and read it.
   */
  it('names the reason and offers to read an org clip nothing was read from', async () => {
    const analyseCalls: Array<{ url: string; body: unknown }> = [];
    let read = false;

    const item = (over: Record<string, unknown> = {}) => ({
      id: 'p-905d4f81',
      jobId: 'job-1',
      jobName: 'Cedar Ridge',
      partyId: 'party-1',
      company: 'Field Capture',
      person: 'Jack Cyganiak',
      phase: 'after',
      workDate: '2026-08-22',
      capturedAt: '2026-08-22T14:00:00Z',
      uploadedAt: '2026-08-22T14:01:00Z',
      durationSeconds: null,
      byteSize: 13_000_000,
      hash: 'abc',
      tier: 1,
      integrity: 'unknown',
      checks: [],
      analysisState: 'skipped',
      analysisReason: 'No frames could be read out of the day film.',
      analysis: null,
      ...over,
    });

    const readItem = item({
      analysisState: 'done',
      analysisReason: null,
      durationSeconds: 2,
      analysis: {
        summary: 'A monitor on a desk; no work in frame.',
        dictation: 'The clip opens on a desk with a monitor running a broadcast. Nobody is working.',
        dictationEntries: [{ atSeconds: 0, text: 'Desk, monitor, papers. No work in frame.' }],
        actions: [],
        changes: [],
        scope: [],
        couldNotTell: [],
      },
    });

    const dom = new JSDOM(verifierHtml, {
      url: 'https://atmosphere.test/verifier/',
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      beforeParse(window) {
        window.fetch = ((url: string, init?: { body?: string }) => {
          const json = (body: unknown) =>
            Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
          if (url.startsWith('/api/evidence-portal/library')) {
            return json({ jobs: [{ jobId: 'job-1', jobName: 'Cedar Ridge' }], items: [item()] });
          }
          if (url.endsWith('/analyse')) {
            analyseCalls.push({ url, body: JSON.parse(init?.body ?? '{}') });
            read = true;
            return json({ outcome: 'done', summary: 'A monitor on a desk.' });
          }
          if (url.endsWith('/video')) return json({ url: null });
          if (url.includes('/evidence/')) {
            return json({ item: read ? readItem : item(), custody: [], frames: [] });
          }
          return Promise.reject(new Error('unexpected ' + url));
        }) as unknown as typeof window.fetch;
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

    await new Promise((resolveWait) => setTimeout(resolveWait, 120));
    const { document } = dom.window;
    const row = document.querySelector('tr[data-id="p-905d4f81"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await new Promise((resolveWait) => setTimeout(resolveWait, 120));

    const panel = document.getElementById('d-panel') as HTMLElement;
    // The real reason, not a claim about a missing after video.
    expect(panel.textContent).toContain('No frames could be read out of the day film');
    expect(panel.textContent).not.toContain('no after video');
    expect(panel.textContent).not.toContain('The assistant is reading this clip');

    const readBtn = document.getElementById('read-clip') as HTMLElement | null;
    expect(readBtn).not.toBeNull();
    readBtn!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));

    expect(analyseCalls).toHaveLength(1);
    expect(analyseCalls[0].url).toBe('/api/operations/shared/job-1/proof/2026-08-22/analyse');
    expect(analyseCalls[0].body).toEqual({ partyId: 'party-1' });

    // Having read it, the panel says what happened rather than why it could not.
    const after = document.getElementById('d-panel') as HTMLElement;
    expect(after.textContent).toContain('Desk, monitor, papers');
    expect(after.textContent).not.toContain('No frames could be read');
    dom.window.close();
  });

  it('tells a reviewer why an unread clip carries no notes', async () => {
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
    // A before clip whose day has no after yet — read nothing, and says why.
    const row = document.querySelector('tr[data-id="EV-1038-0806-B"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    const panel = document.getElementById('d-panel') as HTMLElement;
    expect(panel.textContent).toContain('No after video has been filed for this day');
    expect(panel.textContent).not.toContain('The assistant is reading this clip');
    expect(document.getElementById('alog-pill')?.textContent).not.toBe('Writing…');
    dom.window.close();
  });
});
