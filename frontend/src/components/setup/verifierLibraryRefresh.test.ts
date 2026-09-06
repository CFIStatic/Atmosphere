import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../verifier/index.html'),
  'utf8',
);

const CLIP_A = 'clip-von-mour';
const CLIP_B = 'clip-mobil-test';

function libraryPayload(posterToken: string, extraItems: unknown[] = []) {
  return {
    jobs: [
      {
        jobId: 'job-von',
        jobName: 'Von mour test',
        createdAt: '2026-09-05T21:41:00Z',
        captureStatus: 'recorded',
      },
      {
        jobId: 'job-mobil',
        jobName: 'Mobil test one 1111',
        createdAt: '2026-09-01T18:16:00Z',
        captureStatus: 'recorded',
      },
    ],
    items: [
      {
        id: CLIP_A,
        jobId: 'job-von',
        jobName: 'Von mour test',
        phase: 'after',
        workDate: '2026-09-05',
        capturedAt: '2026-09-05T21:41:00Z',
        uploadedAt: '2026-09-05T21:41:00Z',
        durationSeconds: 33,
        person: 'Jack Cyganiak',
        company: 'Field Capture',
        posterUrl: `https://storage.test/proofs/von-mour.jpg?token=${posterToken}`,
        analysisState: 'done',
      },
      {
        id: CLIP_B,
        jobId: 'job-mobil',
        jobName: 'Mobil test one 1111',
        phase: 'after',
        workDate: '2026-09-01',
        capturedAt: '2026-09-01T18:16:00Z',
        uploadedAt: '2026-09-01T18:16:00Z',
        durationSeconds: 24,
        person: 'Jack Cyganiak',
        company: 'Field Capture',
        posterUrl: `https://storage.test/proofs/mobil.jpg?token=${posterToken}`,
        analysisState: 'done',
      },
      ...extraItems,
    ],
  };
}

function bootOrgVerifier(fetchImpl: typeof fetch) {
  return new JSDOM(verifierHtml, {
    url: 'https://atmosphere.test/verifier/?embed=1',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.sessionStorage.setItem('atmosphere.fieldEmbed.accessToken', 'test-token');
      window.fetch = fetchImpl;
      window.HTMLMediaElement.prototype.play = function () {
        return Promise.resolve();
      };
      window.HTMLMediaElement.prototype.pause = function () {};
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

async function waitForClip(document: Document, id: string) {
  for (let i = 0; i < 40; i += 1) {
    if (document.querySelector(`tr[data-id="${id}"]`)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`clip row ${id} never rendered`);
}

describe('verifier library refresh does not glitch video previews', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('keeps list stills on a silent poll that only rotated signed poster tokens', () => {
    expect(verifierHtml).toContain('function posterIdentity');
    expect(verifierHtml).toContain('function preferStablePoster');
    expect(verifierHtml).toContain('function librarySignature');
    expect(verifierHtml).toContain('function keepClientMedia');
    expect(verifierHtml).toContain('function refreshVideoUrl');
    expect(verifierHtml).toContain('if (first || !silent || before !== librarySignature()) boot()');
    expect(verifierHtml).toContain(
      "if (item._videoUrl && (!item.poster || String(item.poster).indexOf('data:') === 0))",
    );
  });

  it('does not rebuild thumbnail images when the library poll only remints URLs', async () => {
    let token = 'tok-1';
    const fetchImpl = ((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/evidence-portal/library')) {
        return Promise.resolve(
          new globalThis.Response(JSON.stringify(libraryPayload(token)), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    }) as typeof fetch;

    const dom = bootOrgVerifier(fetchImpl);
    await waitForClip(dom.window.document, CLIP_A);
    await waitForClip(dom.window.document, CLIP_B);

    const firstA = dom.window.document.querySelector(
      `tr[data-id="${CLIP_A}"] img.shot`,
    ) as HTMLImageElement | null;
    const firstB = dom.window.document.querySelector(
      `tr[data-id="${CLIP_B}"] img.shot`,
    ) as HTMLImageElement | null;
    expect(firstA).not.toBeNull();
    expect(firstB).not.toBeNull();
    const srcA = firstA!.getAttribute('src');
    const srcB = firstB!.getAttribute('src');
    expect(srcA).toContain('token=tok-1');
    expect(srcB).toContain('token=tok-1');

    token = 'tok-2';
    dom.window.postMessage({ atmosphere: 'reload-library' }, '*');
    await new Promise((resolve) => setTimeout(resolve, 40));

    const againA = dom.window.document.querySelector(
      `tr[data-id="${CLIP_A}"] img.shot`,
    ) as HTMLImageElement | null;
    const againB = dom.window.document.querySelector(
      `tr[data-id="${CLIP_B}"] img.shot`,
    ) as HTMLImageElement | null;
    expect(againA).toBe(firstA);
    expect(againB).toBe(firstB);
    expect(againA!.getAttribute('src')).toBe(srcA);
    expect(againB!.getAttribute('src')).toBe(srcB);
    expect(againA!.getAttribute('src')).not.toContain('token=tok-2');
    dom.window.close();
  });

  it('still paints a newly filed clip after a silent refresh', async () => {
    let extra: unknown[] = [];
    const fetchImpl = ((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/evidence-portal/library')) {
        return Promise.resolve(
          new globalThis.Response(JSON.stringify(libraryPayload('tok-1', extra)), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    }) as typeof fetch;

    const dom = bootOrgVerifier(fetchImpl);
    await waitForClip(dom.window.document, CLIP_A);
    expect(dom.window.document.querySelector('tr[data-id="clip-new"]')).toBeNull();

    extra = [
      {
        id: 'clip-new',
        jobId: 'job-von',
        jobName: 'Von mour test',
        phase: 'after',
        workDate: '2026-09-06',
        capturedAt: '2026-09-06T12:00:00Z',
        uploadedAt: '2026-09-06T12:00:00Z',
        durationSeconds: 12,
        person: 'Jack Cyganiak',
        company: 'Field Capture',
        posterUrl: 'https://storage.test/proofs/new.jpg?token=tok-1',
        analysisState: 'none',
      },
    ];
    dom.window.postMessage({ atmosphere: 'reload-library' }, '*');
    await waitForClip(dom.window.document, 'clip-new');
    expect(dom.window.document.querySelector(`tr[data-id="${CLIP_A}"]`)).not.toBeNull();
    dom.window.close();
  });

  it('keeps a minted playback URL across a silent library poll', async () => {
    let token = 'tok-1';
    const fetchImpl = ((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/evidence-portal/library')) {
        return Promise.resolve(
          new globalThis.Response(JSON.stringify(libraryPayload(token)), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (url.includes(`/api/evidence-portal/evidence/${CLIP_A}/video`)) {
        return Promise.resolve(
          new globalThis.Response(JSON.stringify({ url: 'https://storage.test/von-mour.webm?sig=live' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (url.includes(`/api/evidence-portal/evidence/${CLIP_A}`)) {
        return Promise.resolve(
          new globalThis.Response(
            JSON.stringify({
              item: libraryPayload(token).items[0],
              frames: [],
              custody: [],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    }) as typeof fetch;

    const dom = bootOrgVerifier(fetchImpl);
    await waitForClip(dom.window.document, CLIP_A);

    const row = dom.window.document.querySelector(`tr[data-id="${CLIP_A}"]`) as HTMLElement;
    row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 60));

    const play = dom.window.document.getElementById('d-yt-play');
    expect(play).not.toBeNull();
    play!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 40));

    const playing = dom.window.document.querySelector('#d-frame video') as HTMLVideoElement | null;
    expect(playing).not.toBeNull();
    expect(playing!.getAttribute('src')).toContain('von-mour.webm');

    token = 'tok-2';
    dom.window.postMessage({ atmosphere: 'reload-library' }, '*');
    await new Promise((resolve) => setTimeout(resolve, 40));

    const still = dom.window.document.querySelector('#d-frame video') as HTMLVideoElement | null;
    expect(still).not.toBeNull();
    expect(still).toBe(playing);
    expect(still!.getAttribute('src')).toContain('sig=live');
    dom.window.close();
  });
});
