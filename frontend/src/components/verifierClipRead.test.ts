import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../verifier/index.html'),
  'utf8',
);

/**
 * The clip nobody read.
 *
 * A proof lands, the day pipeline never runs on it, and the evidence sheet
 * says "the assistant is reading this clip" beside a spinner that is reading
 * nothing. These tests pin the fix: opening an unread clip asks the backend to
 * read the footage, and the notes that come back land on the panel.
 */

const LIBRARY = {
  jobs: [{ jobId: 'job-1', jobName: 'Cedar Ridge', jobNumber: 41 }],
  items: [
    {
      id: 'EV-LIVE-1',
      jobId: 'job-1',
      jobName: 'Cedar Ridge',
      company: 'Delgado Roofing',
      person: 'Marco Delgado',
      phase: 'after',
      workDate: '2026-08-14',
      capturedAt: '2026-08-14T15:02:00.000Z',
      uploadedAt: '2026-08-14T15:20:00.000Z',
      durationSeconds: 142,
      byteSize: 24_000_000,
      hash: 'ab12cd34',
      tier: 1,
      checks: [],
      // Nothing has ever been read from this clip.
      analysisState: 'none',
      analysis: null,
      clipReading: null,
    },
  ],
};

const READING = {
  item: {
    ...LIBRARY.items[0],
    analysisState: 'done',
    analysis: null,
    clipReading: {
      dictation:
        'The clip opens on the north slope with the tarp already off. Underlayment is rolled out across the middle of the slope and fastened as the camera pans.',
      summary: 'Tarp off, underlayment going down on the north slope.',
      entries: [
        { frame: 0, atSeconds: 11, stageIndex: -1, note: 'Tarp is off; bare decking across the north slope.' },
        { frame: 1, atSeconds: 63, stageIndex: -1, note: 'Underlayment rolled out and fastened mid-slope.' },
      ],
      actions: [
        { atSeconds: 63, action: 'fasten', description: 'Underlayment fastened across mid-slope.' },
      ],
      status: 'done',
      model: 'claude-opus-5',
    },
  },
  reading: { frameCount: 9, model: 'claude-opus-5' },
  alreadyRead: false,
};

function bootVerifier(handler: (url: string, init?: { method?: string }) => unknown) {
  const calls: Array<{ url: string; method: string }> = [];
  const dom = new JSDOM(verifierHtml, {
    url: 'https://atmosphere.test/verifier/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      (window as unknown as { fetch: unknown }).fetch = (input: string, init?: { method?: string }) => {
        const url = String(input);
        calls.push({ url, method: init?.method ?? 'GET' });
        const body = handler(url, init);
        if (body === null) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
      };
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
  return { dom, calls };
}

describe('verifier reads the footage itself', () => {
  it('wires the clip read to the evidence portal on both doors', () => {
    expect(verifierHtml).toContain("'/analyze'");
    expect(verifierHtml).toContain('/api/evidence-portal/evidence/');
    expect(verifierHtml).toContain('/api/verifier-share/');
    expect(verifierHtml).toContain('function readClip');
    expect(verifierHtml).toContain('function maybeReadClip');
    expect(verifierHtml).toContain('function applyClipReading');
  });

  it('opening an unread clip asks the backend to read the video, then lands the notes', async () => {
    const { dom, calls } = bootVerifier((url, init) => {
      if (url.includes('/api/evidence-portal/library')) return LIBRARY;
      if (url.endsWith('/analyze') && init?.method === 'POST') return READING;
      if (url.endsWith('/video')) return null;
      if (url.includes('/evidence/EV-LIVE-1')) {
        return { item: LIBRARY.items[0], custody: [], frames: [] };
      }
      return null;
    });

    await new Promise((done) => setTimeout(done, 120));
    const { document } = dom.window;
    const row = document.querySelector('tr[data-id="EV-LIVE-1"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    await new Promise((done) => setTimeout(done, 200));

    const analyze = calls.filter((c) => c.url.endsWith('/analyze') && c.method === 'POST');
    expect(analyze.length).toBe(1);
    expect(analyze[0].url).toContain('/api/evidence-portal/evidence/EV-LIVE-1/analyze');

    const notes = Array.from(document.querySelectorAll('#alog [data-full]')).map((n) =>
      n.getAttribute('data-full'),
    );
    expect(notes.join(' ')).toMatch(/Underlayment/);
    expect(document.querySelector('#alog [data-at="11"]')).not.toBeNull();
  });

  it('does not re-read a clip that already carries a reading', async () => {
    const alreadyRead = {
      ...LIBRARY,
      items: [{ ...READING.item }],
    };
    const { dom, calls } = bootVerifier((url) => {
      if (url.includes('/api/evidence-portal/library')) return alreadyRead;
      if (url.endsWith('/video')) return null;
      if (url.includes('/evidence/EV-LIVE-1')) {
        return { item: alreadyRead.items[0], custody: [], frames: [] };
      }
      return null;
    });

    await new Promise((done) => setTimeout(done, 120));
    const { document } = dom.window;
    const row = document.querySelector('tr[data-id="EV-LIVE-1"]') as HTMLElement | null;
    row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await new Promise((done) => setTimeout(done, 200));

    expect(calls.filter((c) => c.url.endsWith('/analyze')).length).toBe(0);
    // The reading it already had is what the panel shows.
    const notes = Array.from(document.querySelectorAll('#alog [data-full]')).map((n) =>
      n.getAttribute('data-full'),
    );
    expect(notes.join(' ')).toMatch(/Tarp is off/);
  });

  it('reads a clip a pipeline left queued and never came back to', async () => {
    // The screen this feature exists to fix: narration_status queued, nothing
    // reading it, and a panel that said "the assistant is reading this clip"
    // forever.
    const stuck = {
      ...LIBRARY,
      items: [
        {
          ...LIBRARY.items[0],
          analysisState: 'queued',
          clipReading: { dictation: null, summary: null, entries: [], actions: [], status: 'queued', model: null },
        },
      ],
    };
    const { dom, calls } = bootVerifier((url, init) => {
      if (url.includes('/api/evidence-portal/library')) return stuck;
      if (url.endsWith('/analyze') && init?.method === 'POST') return READING;
      if (url.endsWith('/video')) return null;
      if (url.includes('/evidence/EV-LIVE-1')) return { item: stuck.items[0], custody: [], frames: [] };
      return null;
    });

    await new Promise((done) => setTimeout(done, 120));
    const { document } = dom.window;
    (document.querySelector('tr[data-id="EV-LIVE-1"]') as HTMLElement).dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true }),
    );
    await new Promise((done) => setTimeout(done, 200));

    expect(calls.filter((c) => c.url.endsWith('/analyze')).length).toBe(1);
    const notes = Array.from(document.querySelectorAll('#alog [data-full]')).map((n) =>
      n.getAttribute('data-full'),
    );
    expect(notes.join(' ')).toMatch(/Underlayment/);
  });

  it('an Ask answer that caused the read fills the analysis panel too', async () => {
    const { dom, calls } = bootVerifier((url, init) => {
      if (url.includes('/api/evidence-portal/library')) return LIBRARY;
      if (url.endsWith('/analyze') && init?.method === 'POST') return { item: LIBRARY.items[0], reading: null, alreadyRead: true };
      if (url.endsWith('/ask') && init?.method === 'POST') {
        return {
          answer: 'At 1:03 the crew is fastening underlayment across mid-slope.',
          model: 'claude-opus-5',
          item: READING.item,
        };
      }
      if (url.endsWith('/video')) return null;
      if (url.includes('/evidence/EV-LIVE-1')) return { item: LIBRARY.items[0], custody: [], frames: [] };
      return null;
    });

    await new Promise((done) => setTimeout(done, 120));
    const { document } = dom.window;
    (document.querySelector('tr[data-id="EV-LIVE-1"]') as HTMLElement).dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true }),
    );
    await new Promise((done) => setTimeout(done, 150));

    (document.querySelector('[data-tab="ask"]') as HTMLElement).dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true }),
    );
    (document.querySelector('[data-ask="What work is visible?"]') as HTMLElement).dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true }),
    );
    await new Promise((done) => setTimeout(done, 200));

    const ask = calls.filter((c) => c.url.endsWith('/ask') && c.method === 'POST');
    expect(ask.length).toBe(1);
    const bubbles = Array.from(document.querySelectorAll('.ask-bubble')).map((b) => b.textContent);
    expect(bubbles.join(' ')).toMatch(/fastening underlayment/);

    // The reading the question caused is on the clip, so the notes are there
    // when the reviewer switches back.
    (document.querySelector('[data-tab="integrity"]') as HTMLElement).dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true }),
    );
    const notes = Array.from(document.querySelectorAll('#alog [data-full]')).map((n) =>
      n.getAttribute('data-full'),
    );
    expect(notes.join(' ')).toMatch(/Tarp is off/);
  });

  it('a failed read says so and offers the button again', async () => {
    const { dom } = bootVerifier((url, init) => {
      if (url.includes('/api/evidence-portal/library')) return LIBRARY;
      if (url.endsWith('/analyze') && init?.method === 'POST') return null;
      if (url.endsWith('/video')) return null;
      if (url.includes('/evidence/EV-LIVE-1')) {
        return { item: LIBRARY.items[0], custody: [], frames: [] };
      }
      return null;
    });

    await new Promise((done) => setTimeout(done, 120));
    const { document } = dom.window;
    const row = document.querySelector('tr[data-id="EV-LIVE-1"]') as HTMLElement | null;
    row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await new Promise((done) => setTimeout(done, 200));

    const panel = document.getElementById('d-panel');
    expect(panel?.textContent ?? '').toMatch(/could not be read/i);
    expect(panel?.textContent ?? '').toMatch(/Failed/);
    expect(document.getElementById('read-clip')).not.toBeNull();
  });
});
