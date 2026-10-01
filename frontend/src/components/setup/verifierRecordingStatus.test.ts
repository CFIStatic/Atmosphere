import { readFileSync } from 'node:fs';
import { clipProcessing } from '../../lib/clipProcessing';
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
    `${verifierHtml.slice(start, end)}; return { clipInstant, isActiveRecording, jobRecordingStatus, clipStatus, clipProcessingOf };`,
  )() as {
    isActiveRecording: (e: unknown) => boolean;
    jobRecordingStatus: (
      items: unknown[],
      job?: { captureStatus?: string },
    ) => { cls: string; text: string };
    clipStatus: (e: unknown) => { cls: string; text: string };
    clipProcessingOf: (e: unknown) => { state: string; label: string; tone: string };
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

    expect(clipStatus(uploaded)).toEqual({ cls: 'green', text: 'Analyzed' });
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
    // A landed file is Recorded on the clip row. The job folder can still say
    // Recording while that recent file has not been queued.
    expect(clipStatus(filming)).toEqual({ cls: 'green', text: 'Recorded' });
    expect(clipStatus({ ...filming, recording: true })).toEqual({ cls: 'yellow', text: 'Recording' });
    expect(jobRecordingStatus([filming])).toEqual({ cls: 'yellow', text: 'Recording' });
  });

  it('labels a job file with no clips Waiting for first clip, not a dead No recording state', () => {
    const { jobRecordingStatus } = extractRecordingStatusFns();
    expect(jobRecordingStatus([])).toEqual({ cls: 'yellow', text: 'Waiting for first clip' });
    expect(jobRecordingStatus([], { captureStatus: 'in_progress' })).toEqual({
      cls: 'yellow',
      text: 'Waiting for first clip',
    });
    // Zero clips is never Recorded, whatever captureStatus says.
    expect(jobRecordingStatus([], { captureStatus: 'recorded' })).toEqual({
      cls: 'yellow',
      text: 'Waiting for first clip',
    });
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
    expect(clipStatus(queued)).toEqual({ cls: 'yellow', text: 'Analyzing' });
    expect(
      clipStatus({
        analysis: { state: 'done', summaryState: 'updating' },
        uploadedAt: '2026-08-01T12:00:00Z',
      }),
    ).toEqual({ cls: 'yellow', text: 'Summary still processing' });
    // The live library sends the shared status. A stored summary is Analyzed.
    expect(
      clipStatus({
        analysis: { state: 'done', summaryState: 'updating' },
        hasSummary: true,
        processing: { state: 'ready', label: 'Analyzed', tone: 'good' },
      }),
    ).toEqual({ cls: 'green', text: 'Analyzed' });
  });

  it('uses the same labels as clipProcessing for the library mismatch cases', () => {
    const { clipProcessingOf } = extractRecordingStatusFns();
    const cases: Array<Record<string, unknown>> = [
      { proofState: 'uploaded' },
      { transcriptStatus: 'running' },
      { analysisStatus: 'queued', narrationStatus: 'running' },
      { proofState: 'checked' },
      {
        proofState: 'checked',
        analysisStatus: 'running',
        analysisActive: false,
        narrationStatus: 'queued',
        narrationActive: false,
      },
      { proofState: 'checked', analysisStatus: 'running', analysisActive: true },
      {
        proofState: 'checked',
        analysisStatus: 'done',
        narrationStatus: 'done',
        transcriptStatus: 'done',
        summaryState: 'fresh',
        hasSummary: true,
        summaryActive: false,
      },
      { proofState: 'analysed', analysisStatus: 'done', summaryState: 'updating' },
      {
        proofState: 'analysed',
        analysisStatus: 'done',
        summaryState: 'updating',
        hasSummary: true,
        summaryActive: true,
      },
      {
        proofState: 'analysed',
        analysisStatus: 'done',
        summaryState: 'quarantined',
        hasSummary: true,
      },
      {
        analysisStatus: 'done',
        transcriptStatus: 'running',
        transcriptActive: false,
        hasSummary: true,
        summaryState: 'updating',
        summaryActive: false,
      },
      {
        proofState: 'uploaded',
        analysisStatus: 'queued',
        analysisActive: false,
        transcriptStatus: 'queued',
        transcriptActive: false,
      },
      {
        proofState: 'checked',
        analysisStatus: 'queued',
        analysisActive: false,
        narrationStatus: 'running',
        narrationActive: false,
      },
      { proofState: 'checked', analysisStatus: 'running', analysisActive: false },
      { proofState: 'checked', analysisStatus: 'queued', analysisActive: true },
      { transcriptStatus: 'skipped', noSpeech: true, proofState: 'uploaded' },
      { transcriptStatus: 'skipped', noSpeech: true, analysisStatus: 'done', hasSummary: true },
      { analysisStatus: 'failed' },
      { analysisStatus: 'running', analysisActive: true, retrying: true },
      { uploading: true, analysisStatus: 'done' },
      { budgetHold: true, analysisStatus: 'queued', proofState: 'uploaded' },
      { summaryState: 'failed', analysisStatus: 'done' },
      {},
    ];
    for (const input of cases) {
      const expected = clipProcessing(input);
      expect(clipProcessingOf(input).label, JSON.stringify(input)).toBe(expected.label);
      expect(clipProcessingOf(input).state).toBe(expected.state);
    }
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

function bootWithLibrary(library: unknown) {
  return new JSDOM(verifierHtml, {
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
}

async function waitForRow(document: Document, selector: string) {
  for (let i = 0; i < 40; i += 1) {
    if (document.querySelector(selector)) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return document.querySelector(selector);
}

describe('verifier dashboard job status and Recorded date', () => {
  // Job #13 as stored: created 2026-09-28 04:30:30Z (11:30 PM Sep 27 CT), zero clips.
  const JOB_13 = {
    jobId: 'e754a03e-c2fa-4609-aa8e-72f56295bc10',
    jobName: 'Jack Cyganiak',
    jobNumber: 13,
    createdAt: '2026-09-28T04:30:30.856894+00:00',
  };

  it.each(['in_progress', 'recorded', ''])(
    'a zero-clip job is Waiting for first clip with no Recorded date (captureStatus %j)',
    async (captureStatus) => {
      const dom = bootWithLibrary({ jobs: [{ ...JOB_13, captureStatus }], items: [] });
      const row = await waitForRow(dom.window.document, `tr.jobrow[data-job="${JOB_13.jobId}"]`);
      expect(row).not.toBeNull();
      const status = row!.querySelector('td.job-status')?.textContent ?? '';
      expect(status).toBe('Waiting for first clip');
      expect(row!.textContent).not.toMatch(/\bRecorded\b/);
      // The job's creation time is not a recording date.
      const when = row!.querySelector('td.job-when');
      expect(when?.querySelector('time')?.textContent).toBe('—');
      expect(when?.querySelector('small')).toBeNull();
      expect(row!.textContent).not.toMatch(/Sep 2[78], 2026/);
      expect(row!.textContent).not.toMatch(/\d{1,2}:\d{2} [AP]M/);
      expect(row!.querySelector('.job-card-meta')?.textContent).toBe('Waiting for first clip');
      dom.window.close();
    },
  );

  it('a job with a clip is Recorded, dated from the clip capture time (not job creation)', async () => {
    const capturedAt = '2026-09-28T04:45:00Z';
    const dom = bootWithLibrary({
      jobs: [{ ...JOB_13, captureStatus: 'recorded' }],
      items: [
        {
          id: 'clip-1',
          jobId: JOB_13.jobId,
          jobName: JOB_13.jobName,
          jobNumber: 13,
          workDate: '2026-09-28',
          capturedAt,
          uploadedAt: '2026-09-28T04:47:00Z',
          analysisState: 'done',
          person: 'El Presidente',
        },
      ],
    });
    const row = await waitForRow(dom.window.document, `tr.jobrow[data-job="${JOB_13.jobId}"]`);
    expect(row).not.toBeNull();
    expect(row!.querySelector('td.job-status')?.textContent).toBe('Recorded');
    const when = row!.querySelector('td.job-when');
    const at = new Date(capturedAt);
    // Day and clock both come from the capture instant in the viewer's zone.
    expect(when?.querySelector('time')?.textContent).toBe(
      at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    );
    expect(when?.querySelector('small')?.textContent).toBe(
      at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    );
    expect(when?.querySelector('time')?.getAttribute('datetime')).toBe(capturedAt);
    dom.window.close();
  });
});
