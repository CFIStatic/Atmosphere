import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../verifier/index.html'),
  'utf8',
);

type Doc = Record<string, unknown>;
type Search = {
  clipMatchesSearch: (e: Doc, q: string, jobs: Record<string, Doc>) => boolean;
  jobMatchesSearch: (key: string, q: string, jobs: Record<string, Doc>) => boolean;
  parseSearchDate: (q: string) => { y: number | null; m: number; d: number | null } | null;
};

function loadSearch(): Search {
  const s = verifierHtml.indexOf('/* library-search:begin');
  const e = verifierHtml.indexOf('/* library-search:end */');
  if (s < 0 || e < 0) throw new Error('library-search block not found');
  return new Function(
    `${verifierHtml.slice(s, e)}\nreturn { clipMatchesSearch, jobMatchesSearch, parseSearchDate };`,
  )() as Search;
}

const JOB_ID = '7c0e5d1a-2b3c-4d5e-8f90-a1b2c3d4e5f6';
const jobs: Record<string, Doc> = {
  [JOB_ID]: {
    name: 'Project Tiffany & Co.',
    number: 1041,
    address: '1200 Maple Ave, Edina, MN 55435',
    claimNumber: 'CLM-88213',
    company: 'Von Maur Roofing',
    person: 'Dana Whitfield',
    createdAt: '2026-10-01T15:00:00Z',
  },
  'job-cc': { name: 'CC Von Mour', company: 'Cedar Crest', createdAt: '2026-09-20T15:00:00Z' },
};
// 7:30 PM local on Oct 12 (00:30 UTC Oct 13 in Chicago). The list prints
// Oct 12, so search must too, whatever timezone the test runs in.
const clip: Doc = {
  id: '5b1e9c2a-1111-4c8e-9a00-000000000001',
  job: JOB_ID,
  jobId: JOB_ID,
  jobName: 'Project Tiffany & Co.',
  clipId: 'clp_7d3f20',
  hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  title: 'North elevation tear-off',
  aiTitle: 'Shingle removal, north slope',
  fileName: 'IMG_4821.MOV',
  company: 'Von Maur Roofing',
  person: 'Dana Whitfield',
  capturedAt: new Date(2026, 9, 12, 19, 30).toISOString(),
  uploadedAt: new Date(2026, 9, 12, 19, 41).toISOString(),
  labels: ['tear-off'],
};

describe('All videos search (library-search block)', () => {
  const s = loadSearch();
  const hit = (q: string) => s.clipMatchesSearch(clip, q, jobs);

  it('matches job name: partial, any case, with & and punctuation', () => {
    for (const q of ['tif', 'TIFFANY', 'tiffany & co', 'Tiffany & Co.', 'tiffany&co', 'tif co', 'project tiff']) {
      expect(hit(q), q).toBe(true);
    }
    expect(s.jobMatchesSearch(JOB_ID, 'tiffany&co', jobs)).toBe(true);
    expect(s.jobMatchesSearch('job-cc', 'von mour', jobs)).toBe(true);
    expect(s.jobMatchesSearch('job-cc', 'tiffany', jobs)).toBe(false);
  });

  it('matches company and person', () => {
    expect(hit('von maur')).toBe(true);
    expect(hit('maur roof')).toBe(true);
    expect(hit('whitfield')).toBe(true);
    expect(s.jobMatchesSearch('job-cc', 'cedar', jobs)).toBe(true);
  });

  it('matches address, job number and claim', () => {
    expect(hit('maple')).toBe(true);
    expect(hit('1200 maple ave')).toBe(true);
    expect(hit('edina mn')).toBe(true);
    expect(hit('55435')).toBe(true);
    expect(hit('#1041')).toBe(true);
    expect(hit('clm-88213')).toBe(true);
  });

  it('matches the filmed day typed several ways, in the viewer timezone', () => {
    for (const q of ['10/12', '10/12/2026', '10-12-26', 'Oct 12', 'oct. 12', 'October 12, 2026', '12 Oct', 'Oct 12th', '2026-10-12', 'Oct 2026']) {
      expect(hit(q), q).toBe(true);
    }
    for (const q of ['10/13', 'Oct 13', '2026-10-13', 'Oct 12 2025', 'Nov 2026']) {
      expect(hit(q), q).toBe(false);
    }
    expect(s.parseSearchDate('October 12, 2026')).toEqual({ y: 2026, m: 10, d: 12 });
    expect(s.parseSearchDate('tiffany')).toBeNull();
    // A date never matches loose numbers in an address ("1200", "1041").
    expect(s.clipMatchesSearch({ ...clip, capturedAt: '2026-08-01T15:00:00Z', uploadedAt: null }, '10/12', jobs)).toBe(false);
  });

  it('matches clip and job ids by full value or prefix', () => {
    expect(hit(String(clip.id))).toBe(true);
    expect(hit('5b1e')).toBe(true);
    expect(hit('5B1E9C2A-1111')).toBe(true);
    expect(hit('clp_7d3f')).toBe(true);
    expect(hit('clp_7d3f20')).toBe(true);
    expect(hit(JOB_ID)).toBe(true);
    expect(hit('7c0e5d1a')).toBe(true);
    expect(s.jobMatchesSearch(JOB_ID, '7c0e', jobs)).toBe(true);
    expect(hit('9c2a')).toBe(false); // middle of an id is not a prefix
  });

  it('matches the file hash by full value or prefix', () => {
    expect(hit(String(clip.hash))).toBe(true);
    expect(hit('a1b2c3')).toBe(true);
    expect(hit('A1B2')).toBe(true);
    expect(hit('d4e5f6')).toBe(false);
  });

  it('matches clip titles, AI titles and file names', () => {
    expect(hit('north elevation')).toBe(true);
    expect(hit('tear-off')).toBe(true);
    expect(hit('shingle removal')).toBe(true);
    expect(hit('img_4821')).toBe(true);
    expect(hit('IMG_4821.mov')).toBe(true);
    expect(hit('4821')).toBe(true);
  });

  it('misses cleanly', () => {
    expect(hit('gutter')).toBe(false);
    expect(hit('zzz9')).toBe(false);
    expect(hit('')).toBe(true);
  });
});

function bootWithLibrary(library: unknown, onFetch?: (url: string) => unknown) {
  return new JSDOM(verifierHtml, {
    url: 'https://atmosphere.test/verifier/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.sessionStorage.setItem('atmosphere.fieldEmbed.accessToken', 'test-token');
      window.fetch = ((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/evidence-portal/library')) {
          const body = (onFetch && onFetch(url)) || library;
          return Promise.resolve(
            new globalThis.Response(JSON.stringify(body), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        return Promise.reject(new Error(`unexpected fetch ${url}`));
      }) as typeof fetch;
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

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    if (fn()) return;
    await wait(25);
  }
}

const libItem = (id: string, jobId: string, jobName: string, extra: Record<string, unknown> = {}) => ({
  id,
  jobId,
  jobName,
  title: id,
  capturedAt: '2026-10-05T15:00:00Z',
  uploadedAt: '2026-10-05T15:05:00Z',
  analysisState: 'done',
  analysis: { state: 'done' },
  ...extra,
});

describe('All videos search in the list', () => {
  const library = {
    jobs: [
      { jobId: 'job-tif', jobName: 'Project Tiffany & Co.', createdAt: '2026-10-01T15:00:00Z' },
      { jobId: 'job-vm', jobName: 'Von mour test', createdAt: '2026-10-02T15:00:00Z' },
      { jobId: 'job-cc', jobName: 'CC Von Mour', createdAt: '2026-10-03T15:00:00Z' },
    ],
    items: [
      libItem('clip-a', 'job-tif', 'Project Tiffany & Co.', { title: 'Kitchen demo', fileName: 'IMG_0001.MOV' }),
      libItem('clip-b', 'job-tif', 'Project Tiffany & Co.', { title: 'Gutter check', hash: 'ff00aa11' }),
      libItem('clip-c', 'job-vm', 'Von mour test', { title: 'Walkthrough' }),
    ],
  };

  async function typeSearch(dom: JSDOM, value: string) {
    const input = dom.window.document.getElementById('q') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  }

  it('debounces, expands the parent job on the matching clip, and counts filtered results', async () => {
    const dom = bootWithLibrary(library);
    const doc = dom.window.document;
    await until(() => Boolean(doc.querySelector('tr.jobrow[data-job="job-tif"]')));
    // Folders land collapsed: a search hit inside must still show.
    expect(doc.querySelector('tr.jobrow[data-job="job-tif"]')!.getAttribute('aria-expanded')).toBe('false');
    expect(doc.querySelector('tr[data-id="clip-a"]')).toBeNull();

    await typeSearch(dom, 'img_0001');
    // Not applied on the keystroke.
    expect(doc.querySelectorAll('tr.jobrow').length).toBe(3);
    await wait(250);
    expect([...doc.querySelectorAll('tr.jobrow')].map((r) => r.getAttribute('data-job'))).toEqual(['job-tif']);
    expect(doc.querySelector('tr[data-id="clip-a"]')).not.toBeNull();
    expect(doc.querySelector('tr[data-id="clip-b"]')).toBeNull();
    expect(doc.getElementById('resultcount')?.textContent).toBe('1 of 3 clips · 1 of 3 job files');
    dom.window.close();
  });

  it('shows an empty state naming the query', async () => {
    const dom = bootWithLibrary(library);
    const doc = dom.window.document;
    await until(() => Boolean(doc.querySelector('tr.jobrow')));
    await typeSearch(dom, 'no such thing');
    await wait(250);
    expect(doc.querySelectorAll('tr.jobrow').length).toBe(0);
    expect((doc.getElementById('empty') as HTMLElement).hidden).toBe(false);
    expect(doc.getElementById('empty-title')?.textContent).toContain('No videos match');
    expect(doc.getElementById('empty-title')?.textContent).toContain('no such thing');
    expect(doc.getElementById('resultcount')?.textContent).toBe('0 of 3 clips · 0 of 3 job files');
    dom.window.close();
  });

  it('asks the server when the first page did not hold every job', async () => {
    const truncated = { ...library, truncated: true, totals: { clips: 900, jobs: 260 } };
    const old = {
      jobs: [{ jobId: 'job-old', jobName: 'Old Lakeside Reroof', createdAt: '2025-03-01T15:00:00Z' }],
      items: [libItem('clip-old', 'job-old', 'Old Lakeside Reroof', { title: 'Lakeside day 1' })],
    };
    const urls: string[] = [];
    const dom = bootWithLibrary(truncated, (url) => {
      urls.push(url);
      return url.includes('q=') ? old : null;
    });
    const doc = dom.window.document;
    await until(() => Boolean(doc.querySelector('tr.jobrow')));
    await typeSearch(dom, 'lakeside');
    await until(() => Boolean(doc.querySelector('tr[data-id="clip-old"]')));
    expect(urls.some((u) => /q=lakeside/.test(u))).toBe(true);
    expect(doc.querySelector('tr.jobrow[data-job="job-old"]')).not.toBeNull();
    expect(doc.getElementById('resultcount')?.textContent).toBe('1 of 900 clips · 1 of 260 job files');
    dom.window.close();
  });
});
