import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../verifier/index.html'),
  'utf8',
);

function extractRecordingStatusFns() {
  const start = verifierHtml.indexOf('function clipInstant(e, keys)');
  const end = verifierHtml.indexOf('function recordJobId(key)');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('Could not find Dashboard recording-status helpers in verifier/index.html');
  }
  return new Function(
    `${verifierHtml.slice(start, end)}; return { clipInstant, isActiveRecording, jobRecordingStatus, clipStatus };`,
  )() as {
    isActiveRecording: (e: unknown) => boolean;
    jobRecordingStatus: (
      items: unknown[],
      job?: { captureStatus?: string },
    ) => { cls: string; text: string };
    clipStatus: (e: unknown) => { cls: string; text: string };
  };
}

describe('verifier dashboard recording status', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('labels uploaded clips Recorded in green and never Failed', () => {
    const { clipStatus, jobRecordingStatus } = extractRecordingStatusFns();
    const uploaded = {
      analysis: { state: 'done' },
      uploadedAt: '2026-08-01T12:00:00Z',
      capturedAt: '2026-08-01T11:50:00Z',
      checks: [{ verdict: 'fail', what: 'Filmed on site', detail: 'off site' }],
    };

    expect(clipStatus(uploaded)).toEqual({ cls: 'green', text: 'Recorded' });
    expect(jobRecordingStatus([uploaded])).toEqual({ cls: 'green', text: 'Recorded' });
    expect(verifierHtml).not.toMatch(/function clipStatus[\s\S]*?text: 'Failed'/);
    expect(verifierHtml).not.toContain("text: 'Active recording'");
    expect(verifierHtml).not.toContain("text: 'Verified'");
  });

  it('labels an in-flight capture Recording in yellow', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-23T12:00:00Z'));
    const { clipStatus, jobRecordingStatus, isActiveRecording } = extractRecordingStatusFns();
    const filming = {
      analysis: { state: 'none' },
      uploadedAt: '2026-08-23T11:50:00Z',
      capturedAt: '2026-08-23T11:50:00Z',
    };

    expect(isActiveRecording(filming)).toBe(true);
    expect(clipStatus(filming)).toEqual({ cls: 'yellow', text: 'Recording' });
    expect(jobRecordingStatus([filming])).toEqual({ cls: 'yellow', text: 'Recording' });
  });

  it('labels a job file with no clips Waiting for first clip, not a dead No recording state', () => {
    const { jobRecordingStatus } = extractRecordingStatusFns();
    expect(jobRecordingStatus([])).toEqual({ cls: 'yellow', text: 'Waiting for first clip' });
    expect(jobRecordingStatus([], { captureStatus: 'in_progress' })).toEqual({
      cls: 'yellow',
      text: 'Waiting for first clip',
    });
    expect(verifierHtml).toContain("text: job && job.captureStatus === 'recorded' ? 'Recorded' : 'Waiting for first clip'");
    expect(verifierHtml).toContain('Waiting for first clip');
    expect(verifierHtml).toContain('This job is open. The first clip shows up here when Field Capture files it.');
    expect(verifierHtml).not.toContain('No recording');
    expect(verifierHtml).not.toContain("text: 'In progress'");
    expect(verifierHtml).toContain('createdAt: j.createdAt || \'\'');
    expect(verifierHtml).toContain("function startLibraryWatch");
    expect(verifierHtml).toContain("atmosphere === 'reload-library'");
  });

  it('treats a queued analysis as uploaded, not as an active recording', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-23T12:00:00Z'));
    const { clipStatus, isActiveRecording } = extractRecordingStatusFns();
    const queued = {
      analysis: { state: 'queued' },
      uploadedAt: '2026-08-23T11:50:00Z',
      capturedAt: '2026-08-23T11:50:00Z',
    };

    expect(isActiveRecording(queued)).toBe(false);
    expect(clipStatus(queued)).toEqual({ cls: 'green', text: 'Recorded' });
  });

  it('paints an in_progress job folder as Waiting for first clip on All videos', async () => {
    const library = {
      jobs: [
        {
          jobId: 'job-wait',
          jobName: 'Roof tear-off — 14th St',
          createdAt: '2026-09-05T18:00:00Z',
          captureStatus: 'in_progress',
        },
      ],
      items: [],
    };
    const dom = new JSDOM(verifierHtml, {
      url: 'https://atmosphere.test/verifier/',
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      beforeParse(window) {
        window.sessionStorage.setItem('atmosphere.fieldEmbed.accessToken', 'test-token');
        window.fetch = ((input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes('/api/evidence-portal/library')) {
            return Promise.resolve(
              new globalThis.Response(JSON.stringify(library), {
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

    const document = dom.window.document;
    for (let i = 0; i < 40; i += 1) {
      if (document.querySelector('tr.jobrow[data-job="job-wait"]')) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const row = document.querySelector('tr.jobrow[data-job="job-wait"]');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('Roof tear-off — 14th St');
    expect(row?.textContent).toContain('Waiting for first clip');
    expect(row?.textContent).not.toMatch(/No recording/);
    expect(row?.querySelector('.chip.red, .chip.fail')).toBeNull();
    expect(row?.querySelector('.chip.yellow')?.textContent).toMatch(/Waiting for first clip/);
    dom.window.close();
  });
});
