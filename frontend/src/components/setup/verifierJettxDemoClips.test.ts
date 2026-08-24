import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../verifier/index.html'),
  'utf8',
);

function jsonOk(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
}

function jsonStatus(status: number, body: unknown = {}) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

const LIVE_CLIP = {
  id: 'live-cursor-1',
  jobId: 'job-live-1',
  jobName: 'Cursor 1',
  jobNumber: 12,
  company: 'Field Capture',
  person: 'Product Testing',
  phase: 'before',
  workDate: '2026-08-24',
  capturedAt: '2026-08-24T16:00:00Z',
  uploadedAt: '2026-08-24T16:01:00Z',
  durationSeconds: 60,
  byteSize: 1_200_000,
};

function matchMediaStub(window: Window) {
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
}

function bootSignedIn(orgName: string, libraryItems: unknown[] = [LIVE_CLIP]) {
  return new JSDOM(verifierHtml, {
    url: 'https://atmosphere.test/verifier/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      matchMediaStub(window);
      window.fetch = ((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/org/me')) {
          return jsonOk({ membership: { org: { id: 'org-1', name: orgName } } });
        }
        if (url.includes('/api/evidence-portal/library')) {
          return jsonOk({
            items: libraryItems,
            jobs: libraryItems.length
              ? [
                  {
                    jobId: LIVE_CLIP.jobId,
                    jobName: LIVE_CLIP.jobName,
                    jobNumber: LIVE_CLIP.jobNumber,
                  },
                ]
              : [],
            counts: { total: libraryItems.length, flagged: 0, unanalysed: 0, onHold: 0 },
          });
        }
        if (url.includes('/api/auth/me')) {
          return jsonOk({ user: { email: 'jack@jettx.ai' } });
        }
        if (url.includes('/api/profile')) {
          return jsonOk({ profile: { email: 'jack@jettx.ai', fullName: 'Jack Cyganiak' } });
        }
        return jsonStatus(404, { error: 'unmocked' });
      }) as typeof window.fetch;
    },
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 800) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error('timed out waiting for dashboard rows');
}

describe('Jettx LLC dashboard demo clips', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('keeps the drawn product-testing clips for the in-house Jettx LLC account', () => {
    expect(verifierHtml).toContain('function isJettxLlcAccount');
    expect(verifierHtml).toContain('function mergeDemoClipsForJettx');
    expect(verifierHtml).toContain("=== 'jettx llc'");
    expect(verifierHtml).toContain('var DEMO_EVIDENCE = EVIDENCE.slice()');
  });

  it('puts the fake clips on the Jettx LLC dashboard next to live uploads', async () => {
    const dom = bootSignedIn('Jettx LLC');
    await waitFor(() => Boolean(dom.window.document.querySelector('tr[data-id="EV-1038-0805-A"]')));

    const { document } = dom.window;
    expect(document.querySelector('tr[data-id="EV-1038-0805-A"]')).not.toBeNull();
    expect(document.querySelector('tr[data-id="EV-1041-0803-A"]')).not.toBeNull();
    expect(document.querySelector('tr[data-id="EV-1044-0729-A"]')).not.toBeNull();
    expect(document.querySelector('tr[data-id="live-cursor-1"]')).not.toBeNull();
    const rows = document.querySelector('#rows')?.textContent || '';
    expect(rows).toContain('Cedar Ridge');
    expect(rows).toContain('Meridian Ave');
    expect(rows).toContain('Camden Court');
    expect(rows).toContain('Cursor 1');
    expect(document.getElementById('who-sub')?.textContent).toBe('Jettx LLC');
    dom.window.close();
  });

  it('does not leak the fake clips onto another signed-in org', async () => {
    const dom = bootSignedIn('Coastal Restoration');
    await waitFor(() => Boolean(dom.window.document.querySelector('tr[data-id="live-cursor-1"]')));

    const { document } = dom.window;
    expect(document.querySelector('tr[data-id="live-cursor-1"]')).not.toBeNull();
    expect(document.querySelector('tr[data-id="EV-1038-0805-A"]')).toBeNull();
    expect(document.querySelector('tr[data-job="cedar"]')).toBeNull();
    expect(document.querySelector('#rows')?.textContent).toContain('Cursor 1');
    expect(document.querySelector('#rows')?.textContent).not.toContain('Cedar Ridge');
    dom.window.close();
  });
});
