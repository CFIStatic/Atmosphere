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
    expect(verifierHtml).toContain('function parseTimestampedEvents');
    expect(verifierHtml).toContain('function displayEvents');
    expect(verifierHtml).toContain('function watchRemoteReading');
    expect(verifierHtml).toContain('data-full=');
    expect(verifierHtml).not.toContain('<h4>AI analysis</h4>');
    expect(verifierHtml).toContain('function isSceneViewNote');
    expect(verifierHtml).toContain('function jobOverviewParts');
    expect(verifierHtml).toContain('function surfaceClipDisputes');
    expect(verifierHtml).toContain('function disputeCheckTitle');
    expect(verifierHtml).toContain('Show me the dispute');
    expect(verifierHtml).not.toContain('None on this clip');
    expect(verifierHtml).not.toContain('Nothing on this clip conflicts');
    expect(verifierHtml).toContain('atmosphere.clip_custody.v1');
    expect(verifierHtml).not.toContain('ANALYSIS_DISCLAIMER');
    expect(verifierHtml).toContain('analysis-skel');
    expect(verifierHtml).toContain('alog-head');
    expect(verifierHtml).toContain('>Events</h4>');
  });

  it('does not rewrite quoted speech or clip titles in an Ask bubble', () => {
    const start = verifierHtml.indexOf('function sanitizeAskSpeakerProse');
    const end = verifierHtml.indexOf('function renderAskMarkdown');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const sanitize = new Function(
      `${verifierHtml.slice(start, end)}; return sanitizeAskSpeakerProse;`,
    )() as (input: string, protect?: string[]) => string;
    const title = 'Person 1 Walks the Seated Man Through the Kitchen';
    const out = sanitize(
      `Person 1 (Seated said “Ask the seated man about Person 2.” in ${title}.\n- “Ask the seated man about Person 2.” (${title}, 0:04)`,
      [title],
    );
    expect(out).toMatch(/^Speaker 1 said “Ask the seated man about Person 2\.”/);
    expect(out.split('“')[0] ?? '').not.toMatch(/\(|Seated|Person/);
    expect(out.split(title)).toHaveLength(3);
    expect(out).toContain(`(${title}, 0:04)`);
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
    expect(document.getElementById('d-job-summary')).toBeNull();
    expect(document.getElementById('alog')?.textContent).toMatch(/tarp/i);
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

    expect(document.getElementById('d-job-summary')).toBeNull();
    expect(document.getElementById('alog')?.textContent).toMatch(/bathroom/i);

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

  it('does not put AI analysis chrome or scene-viewing notes on the Analysis tab', async () => {
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
    expect(document.getElementById('d-job-summary')).toBeNull();
    expect(document.getElementById('alog')?.textContent).toMatch(/tarp gone/i);
    dom.window.close();
  });

  it('keeps Analysis as a timeline of events — no essay wall', async () => {
    const dom = bootVerifier();

    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    const { document } = dom.window;
    const row = document.querySelector('tr[data-id="EV-1038-0805-A"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    const alog = document.getElementById('alog');
    expect(document.getElementById('d-job-summary')).toBeNull();
    expect(document.getElementById('d-saw')).toBeNull();
    expect(document.getElementById('d-analysis-lead')).toBeNull();
    expect(alog).not.toBeNull();
    expect(alog!.textContent).toMatch(/tarp gone/i);
    expect(document.getElementById('d-panel')?.textContent).not.toMatch(/Against the scope/i);
    expect(document.getElementById('d-panel')?.textContent).not.toMatch(/Heard on the mic/i);
    expect(document.getElementById('dispute-toggle')?.textContent).toMatch(/Show me the dispute/i);
    expect(document.getElementById('dispute-toggle')?.textContent).toMatch(/1 moment/);
    expect(document.getElementById('d-panel')?.textContent).not.toMatch(/None on this clip/i);
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
    expect(document.querySelector('.analysis-skel')).not.toBeNull();
    expect(document.querySelector('.analysis-status')?.getAttribute('data-status')).toBe('pending');
    expect(document.getElementById('d-saw')).toBeNull();
    expect(document.getElementById('d-analysis-lead')).toBeNull();
    expect(document.getElementById('d-job-summary')).toBeNull();
    expect(document.getElementById('dispute-toggle')).toBeNull();
    expect(document.getElementById('d-panel')?.textContent).not.toMatch(/None on this clip/i);
    expect(document.getElementById('d-panel')?.textContent).not.toMatch(/Show me the dispute/i);
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

    expect(document.body.textContent).toMatch(/insurance/i);
    expect(document.body.textContent).toMatch(/vanity/i);
    const notes = Array.from(document.querySelectorAll('#alog [data-at]'));
    const times = notes.map((el) => Number(el.getAttribute('data-at')));
    expect(times).toContain(18);
    expect(times).toContain(96);
    expect(times).toContain(250);
    expect(times).toContain(285);
    expect(times.every((at) => at > 0)).toBe(true);
    expect(document.getElementById('alog')?.textContent).toMatch(/said/i);
    expect(document.getElementById('alog')?.textContent).toMatch(/insurance|cabinets|agreement/i);
    expect(document.getElementById('alog')?.textContent).toMatch(/unless insurance approves it/i);
    expect(document.getElementById('alog')?.textContent).toMatch(/That is not in the claim/i);
    expect(document.getElementById('alog')?.textContent).not.toMatch(/0:00/);

    const askTab = document.querySelector('[data-tab="ask"]') as HTMLElement | null;
    askTab!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    const suggest = document.querySelector(
      '[data-ask="What was said in this clip?"]',
    ) as HTMLElement | null;
    expect(suggest).not.toBeNull();
    suggest!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    await new Promise((resolveWait) => setTimeout(resolveWait, 40));
    const reply = Array.from(document.querySelectorAll('.ask-bubble.assistant'))
      .map((el) => el.textContent || '')
      .join('\n');
    expect(reply).toMatch(/vanity|insurance|cabinets/i);
    expect(reply).toMatch(/Exact words from the recording|Yes —/i);
    expect(reply).not.toMatch(/does not show that/i);
    dom.window.close();
  });

  it('lists event-boundary timestamps on Analysis and hides the At-0-seconds blob', async () => {
    const dom = bootVerifier();

    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    const { document } = dom.window;
    const row = document.querySelector('tr[data-id="EV-1038-0905-O"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    const alog = document.getElementById('alog');
    expect(document.getElementById('d-job-summary')).toBeNull();
    expect(document.getElementById('d-saw')).toBeNull();
    const notes = Array.from(document.querySelectorAll('#alog [data-at]'));
    expect(notes.map((el) => el.getAttribute('data-at'))).toEqual(['8', '18']);
    expect(alog?.textContent).not.toMatch(/0:00/);
    expect(alog?.textContent).toMatch(/0:08/);
    expect(alog?.textContent).toMatch(/0:18/);
    expect(alog?.textContent).toMatch(/spreadsheet/i);
    expect(alog?.textContent).toMatch(/scene|activity/i);
    expect(alog?.textContent).not.toMatch(/said/i);
    expect(
      Array.from(document.querySelectorAll('#d-panel .alog-head h4')).some((el) => el.textContent === 'Events'),
    ).toBe(true);
    expect(document.getElementById('d-panel')?.textContent).not.toMatch(/At 0 seconds, the camera captures/i);

    const second = notes[1] as HTMLElement;
    second.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    expect(second.getAttribute('data-at')).toBe('18');
    dom.window.close();
  });

  it('hides a lone 0-second analysis blob and keeps the job summary', async () => {
    const dom = bootVerifier();

    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    const { document } = dom.window;
    const row = document.querySelector('tr[data-id="EV-1112-0905-Z"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    expect(document.getElementById('d-job-summary')).toBeNull();
    expect(document.getElementById('d-saw')).toBeNull();
    expect(document.getElementById('alog')).toBeNull();
    expect(document.getElementById('alog-empty')?.textContent).toMatch(/No distinct moments/i);
    expect(document.getElementById('d-panel')?.textContent).not.toMatch(/At 0 seconds/i);
    expect(document.getElementById('d-panel')?.textContent).not.toMatch(/0:00/);
    expect(document.getElementById('dispute-toggle')).toBeNull();
    expect(document.getElementById('d-panel')?.textContent).not.toMatch(/None on this clip/i);
    expect(document.getElementById('d-panel')?.textContent).not.toMatch(/Show me the dispute/i);
    dom.window.close();
  });

  it('shows a failed Analysis state as a status, not a broken empty panel', async () => {
    const dom = bootVerifier();

    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    const { document } = dom.window;
    const row = document.querySelector('tr[data-id="EV-1044-0731-F"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    expect(document.querySelector('.analysis-status')?.getAttribute('data-status')).toBe('failed');
    expect(document.querySelector('.analysis-status-title')?.textContent).toMatch(/Reading failed/i);
    expect(document.querySelector('.alog-wait')?.textContent).toMatch(/failed after retries/i);
    expect(document.getElementById('alog')).toBeNull();
    expect(document.getElementById('d-saw')).toBeNull();
    expect(document.getElementById('d-panel')?.textContent).not.toMatch(/At 0 seconds/i);
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

  it('surfaces excluded-scope work on Show me the dispute and seeks the event', async () => {
    const dom = bootVerifier();

    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    const { document } = dom.window;
    const row = document.querySelector('tr[data-id="EV-1038-0808-X"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    const toggle = document.getElementById('dispute-toggle') as HTMLButtonElement | null;
    expect(toggle).not.toBeNull();
    expect(toggle!.textContent).toMatch(/Show me the dispute/i);
    expect(document.getElementById('dispute-panel')?.hasAttribute('hidden')).toBe(true);
    toggle!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('dispute-panel')?.hasAttribute('hidden')).toBe(false);
    const list = document.getElementById('dispute-list');
    expect(list?.textContent).toMatch(/skylight/i);
    const skylightRows = Array.from(document.querySelectorAll('#dispute-list li')).filter((el) =>
      /skylight/i.test(el.textContent || ''),
    );
    expect(skylightRows.length).toBe(1);
    const seekRow = document.querySelector('#dispute-list [data-at="41"]') as HTMLElement | null;
    expect(seekRow).not.toBeNull();
    seekRow!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    expect(seekRow!.getAttribute('data-at')).toBe('41');
    expect(document.getElementById('d-job-summary')).toBeNull();
    dom.window.close();
  });

  it('renders Web results on the clip screen from webSources', async () => {
    const dom = new JSDOM(verifierHtml, {
      url: 'https://atmosphere.test/verifier/?share=tok',
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      beforeParse(window) {
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
        const jsonResponse = (body: unknown, status = 200) =>
          Promise.resolve({
            ok: status >= 200 && status < 300,
            status,
            json: () => Promise.resolve(body),
            text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
          });
        window.fetch = ((input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes('/evidence/') && url.endsWith('/video')) {
            return jsonResponse({ url: '', expiresInSeconds: 60 });
          }
          if (url.includes('/evidence/') && !url.endsWith('/ask')) {
            return jsonResponse({
              item: {
                id: 'clip-web',
                workDate: '2026-08-05',
                analysisState: 'done',
                analysis: { summary: 'A roof slope.', dictation: 'Looking at the roof.' },
              },
            });
          }
          if (url.includes('/evidence/') && url.endsWith('/ask')) {
            return jsonResponse({
              answer: 'Plywood is about $40 a sheet.',
              model: null,
              webSources: [
                { title: 'Plywood', url: 'https://example.com/plywood', snippet: 'About $40 a sheet.' },
                { title: 'Bad', url: 'javascript:alert(1)', snippet: 'no' },
              ],
            }, 201);
          }
          if (url.includes('/api/verifier-share/tok') && !url.includes('/evidence/')) {
            return jsonResponse({
              job: { title: 'Shared roof', number: 1, claimNumber: '' },
              share: { label: 'Alex', expiresAt: null },
              items: [
                {
                  id: 'clip-web',
                  workDate: '2026-08-05',
                  uploadedAt: '2026-08-05T12:00:00Z',
                  durationSeconds: 20,
                  byteSize: 1000,
                  phase: 'after',
                  company: 'Crew',
                  analysisState: 'done',
                  analysis: { summary: 'A roof slope.', dictation: 'Looking at the roof.' },
                },
              ],
            });
          }
          return jsonResponse({}, 404);
        }) as typeof window.fetch;
      },
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    const { document } = dom.window;
    const row = document.querySelector('tr[data-id="clip-web"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    const askTab = document.querySelector('[data-tab="ask"]') as HTMLElement | null;
    askTab!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    const input = document.getElementById('ask-input') as HTMLTextAreaElement | null;
    expect(input).not.toBeNull();
    input!.value = 'search the web for plywood prices';
    document.getElementById('ask-form')?.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    document.querySelector('[data-tab="ask"]')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    const results = document.querySelector('[data-ask-web-results="1"]');
    expect(results).not.toBeNull();
    expect(results?.querySelector('a')?.getAttribute('href')).toBe('https://example.com/plywood');
    expect(results?.textContent).toContain('About $40 a sheet.');
    expect(results?.textContent).not.toContain('javascript:');
    dom.window.close();
  });

  it('asks with the job’s attached documents from the server, not this tab’s uploads', () => {
    const start = verifierHtml.indexOf('function attachedJobDocumentIds');
    const end = verifierHtml.indexOf('function loadAttachedJobDocuments');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const { attachedJobDocumentIds, jobDocumentsUrl } = new Function(
      `${verifierHtml.slice(start, end)}; return { attachedJobDocumentIds, jobDocumentsUrl };`,
    )() as {
      attachedJobDocumentIds: (rows: Array<Record<string, unknown>>, jobId: string) => string[];
      jobDocumentsUrl: (jobId: string, orgMode: boolean, shareToken: string) => string;
    };
    const job = '11111111-1111-4111-8111-111111111111';
    const attached = '22222222-2222-4222-8222-222222222222';
    const loose = '33333333-3333-4333-8333-333333333333';
    const ids = attachedJobDocumentIds(
      [
        { id: loose, attached: false, jobId: null, relevance: 'not_related' },
        { id: attached, attached: true, jobId: job, relevance: 'related' },
        { id: '44444444-4444-4444-8444-444444444444', attached: true, jobId: '99999999-9999-4999-8999-999999999999', relevance: 'related' },
        { id: '55555555-5555-4555-8555-555555555555', attached: true, jobId: job, relevance: 'pending_confirm' },
      ],
      job,
    );
    expect(ids).toEqual([attached]);
    expect(jobDocumentsUrl(job, true, '')).toBe(`/api/operations/shared/${job}/documents`);
    expect(jobDocumentsUrl(job, false, 'share-token')).toBe('/api/verifier-share/share-token/documents');
    const askStart = verifierHtml.indexOf('function askClip');
    const askEnd = verifierHtml.indexOf('function safeAskWebUrl');
    const ask = verifierHtml.slice(askStart, askEnd);
    expect(ask).toContain('loadAttachedJobDocuments');
    expect(ask).toContain('attachedJobDocumentIds(rows, jobId)');
    expect(ask).not.toContain('_chatDocs');
    expect(ask).not.toContain('/api/operations/documents/ask');
  });

  it('renders a file chip instead of the document card', () => {
    expect(verifierHtml).not.toContain('ask-document-card');
    expect(verifierHtml).not.toContain('Related to this job');
    expect(verifierHtml).not.toContain('Confirm before attaching');
    expect(verifierHtml).not.toContain('>Not related<');
    expect(verifierHtml).toContain('data-testid="ask-attachment-chip"');
    expect(verifierHtml).toContain("'/api/operations/documents/ask'");
    const escFn = verifierHtml.slice(
      verifierHtml.indexOf('function esc(s)'),
      verifierHtml.indexOf('function frames('),
    );
    const start = verifierHtml.indexOf('var ASK_FILE_ICON');
    const end = verifierHtml.indexOf('function renderAsk(item)');
    const { askChipsHtml, sessionAskDocumentIds, threadAlreadyQuiet } = new Function(
      `${escFn}\n${verifierHtml.slice(start, end)}\nreturn { askChipsHtml, sessionAskDocumentIds, threadAlreadyQuiet };`,
    )() as {
      askChipsHtml: (docs: Array<Record<string, unknown>>, opts?: { remove?: boolean; message?: boolean }) => string;
      sessionAskDocumentIds: (item: { _chatDocs?: Array<{ id?: string }> }) => string[];
      threadAlreadyQuiet: (thread: Array<{ text?: string }>) => boolean;
    };
    const doc = {
      id: '33333333-3333-4333-8333-333333333333',
      filename: 'The Future.docx',
      kindLabel: 'Document',
      summary: 'A vision note that must not preview here.',
      relevance: 'not_related',
      relevanceReason: 'Not related',
    };
    const composer = askChipsHtml([doc], { remove: true });
    expect(composer).toContain('data-testid="ask-composer-attachments"');
    expect(composer).toContain('data-testid="ask-attachment-chip"');
    expect(composer).toContain('data-filename="The Future.docx"');
    expect(composer).toContain('aria-label="Remove The Future.docx"');
    expect(composer).toContain('data-remove-doc="33333333-3333-4333-8333-333333333333"');
    expect(composer).not.toContain('ask-chip-type');
    expect(composer).not.toContain('A vision note');
    expect(composer).not.toContain('Not related');
    expect(composer).not.toContain('ask-document-card');
    const message = askChipsHtml([doc], { message: true });
    expect(message).toContain('data-testid="ask-message-attachments"');
    expect(message).toContain('DOCX');
    expect(message).not.toContain('data-remove-doc');
    expect(message).not.toContain('A vision note');
    const generic = askChipsHtml([{ id: 'b', filename: 'notes', kindLabel: 'Document' }], { message: true });
    expect(generic).not.toContain('ask-chip-type');
    expect(sessionAskDocumentIds({ _chatDocs: [doc, doc, { id: 'not-a-uuid', filename: 'x' }] })).toEqual([doc.id]);
    expect(threadAlreadyQuiet([{ text: "This document doesn't appear to be about this job." }])).toBe(true);
    expect(threadAlreadyQuiet([{ text: 'Jack Cyganiak wrote it.' }])).toBe(false);
    const render = verifierHtml.slice(
      verifierHtml.indexOf('function renderAsk(item)'),
      verifierHtml.indexOf('function bindAsk(item)'),
    );
    expect(render).toContain('m.attachments');
    expect(render).toContain('_pendingDocs');
    expect(render).not.toContain('_chatDocs');
    expect(render).not.toContain('summary');
    const send = verifierHtml.slice(
      verifierHtml.indexOf('function bindAsk(item)'),
      verifierHtml.indexOf('function renderViewingHistory(item)'),
    );
    expect(send).toContain('/api/operations/documents/ask');
    expect(send).toContain('quietNote: !threadAlreadyQuiet(history)');
    expect(send).toContain('item._pendingDocs = []');
    expect(send).toContain('rememberSessionDocs(item, pendingDocs)');
  });

  it('shows the file chip and answers an upload through the documents API', async () => {
    const jobId = '11111111-1111-4111-8111-111111111111';
    const clipId = '22222222-2222-4222-8222-222222222222';
    const docId = '33333333-3333-4333-8333-333333333333';
    const clip = {
      id: clipId,
      jobId,
      jobName: 'Cedar Ridge Roof',
      title: 'Morning walkthrough',
      phase: 'Tear-out',
      uploadedAt: '2026-08-05T15:00:00.000Z',
      capturedAt: '2026-08-05T14:00:00.000Z',
      durationSeconds: 90,
      analysisState: 'done',
      analysis: { summary: 'Crew removed the tarp.', dictation: 'Crew removed the tarp.' },
    };
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const dom = new JSDOM(verifierHtml, {
      url: 'https://atmosphere.test/verifier/',
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      beforeParse(window) {
        window.alert = () => {};
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
        const jsonResponse = (body: unknown, status = 200) =>
          Promise.resolve({
            ok: status >= 200 && status < 300,
            status,
            json: () => Promise.resolve(body),
          });
        window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          const method = String(init?.method || 'GET').toUpperCase();
          if (url.includes('/api/evidence-portal/library')) {
            return jsonResponse({
              jobs: [{ jobId, jobName: 'Cedar Ridge Roof' }],
              items: [clip],
            });
          }
          if (url.includes('/evidence/') && url.endsWith('/video')) return jsonResponse({}, 404);
          if (method === 'GET' && url.includes(`/api/evidence-portal/evidence/${clipId}`)) {
            return jsonResponse({ item: clip, custody: [], frames: [] });
          }
          if (method === 'POST' && url.includes('/api/operations/documents/ask')) {
            const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
            calls.push({ url, body });
            const question = String(body.question || '');
            if (/france/i.test(question)) return jsonResponse({ answer: null });
            return jsonResponse({
              answer: 'This is a 2023 vision note by Jack Cyganiak about his companies: Jettx and Blox Group.',
            });
          }
          if (method === 'POST' && url.includes('/api/operations/documents')) {
            return jsonResponse({
              document: {
                id: docId,
                filename: 'The Future.docx',
                kindLabel: 'Document',
                summary: 'Do not show this summary.',
                relevance: 'not_related',
                relevanceReason: 'Not related',
              },
            }, 201);
          }
          if (method === 'POST' && url.includes('/ask')) {
            const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
            calls.push({ url, body });
            return jsonResponse({ answer: 'Clip fallback.' });
          }
          return jsonResponse({}, 404);
        }) as typeof window.fetch;
      },
    });

    await new Promise((resolveWait) => setTimeout(resolveWait, 120));
    const { document } = dom.window;
    const row = document.querySelector(`tr[data-id="${clipId}"]`) as HTMLElement | null;
    expect(row).not.toBeNull();
    row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    document.querySelector('[data-tab="ask"]')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    const file = new dom.window.File(['The Future by Jack Cyganiak'], 'The Future.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const input = document.getElementById('ask-file') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: { 0: file, length: 1, item: () => file },
    });
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await new Promise((resolveWait) => setTimeout(resolveWait, 80));

    const composer = document.querySelector('[data-testid="ask-composer-attachments"]');
    expect(composer?.textContent).toContain('The Future.docx');
    expect(composer?.querySelector('[aria-label="Remove The Future.docx"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="ask-document-card"]')).toBeNull();
    expect(document.body.textContent).not.toContain('Do not show this summary');
    expect(document.body.textContent).not.toContain('Not related');
    expect(document.body.textContent).not.toContain('Related to this job');

    const askInput = document.getElementById('ask-input') as HTMLTextAreaElement;
    askInput.value = 'What is this document about?';
    document.getElementById('ask-form')?.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolveWait) => setTimeout(resolveWait, 80));

    const messageChip = document.querySelector('[data-testid="ask-message-attachments"]');
    expect(messageChip?.textContent).toContain('The Future.docx');
    expect(messageChip?.textContent).toContain('DOCX');
    expect(messageChip?.querySelector('[data-remove-doc]')).toBeNull();
    expect(document.querySelector('[data-testid="ask-composer-attachments"]')).toBeNull();
    expect(document.body.textContent).toContain('Jettx');
    const docAsk = calls.filter((call) => call.url.includes('/documents/ask'));
    expect(docAsk).toHaveLength(1);
    expect(docAsk[0]?.body.documentIds).toEqual([docId]);
    expect(docAsk[0]?.body.jobId).toBe(jobId);
    expect(docAsk[0]?.body.quietNote).toBe(true);
    expect(calls.some((call) => call.url.includes(`/evidence/${clipId}/ask`))).toBe(false);

    const follow = document.getElementById('ask-input') as HTMLTextAreaElement;
    follow.value = 'What is the population of France?';
    document.getElementById('ask-form')?.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    const userBubbles = Array.from(document.querySelectorAll('.ask-bubble.user'));
    expect(userBubbles).toHaveLength(2);
    expect(userBubbles[1]?.querySelector('[data-testid="ask-attachment-chip"]')).toBeNull();
    expect(document.body.textContent).toContain('Clip fallback.');
    const clipAsk = calls.find((call) => call.url.includes(`/evidence/${clipId}/ask`));
    expect(clipAsk?.body.documentIds).toEqual([]);
    expect(JSON.stringify(clipAsk?.body)).not.toContain(docId);
    dom.window.close();
  });

  it('exports clip custody as versioned JSON with filmedBy, time, job, device, integrity', () => {
    expect(verifierHtml).toContain("schema: 'atmosphere.clip_custody.v1'");
    expect(verifierHtml).toContain('filmedBy');
    expect(verifierHtml).toContain("algorithm: 'sha256'");
    expect(verifierHtml).toContain('contentHash');
    expect(verifierHtml).toContain('chainOfCustody');
    expect(verifierHtml).toContain("a.download = 'custody-' + item.id + '.json'");
  });
});
