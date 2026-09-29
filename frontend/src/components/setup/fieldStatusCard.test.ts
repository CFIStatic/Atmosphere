import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const coreSrc = readFileSync(resolve(repoRoot, 'fieldcapture/js/capture-core.js'), 'utf8');
const fieldHtml = readFileSync(resolve(repoRoot, 'fieldcapture/index.html'), 'utf8');

type Step = { key: string; label: string; done: boolean; detail: string };
type Model = {
  steps: Step[];
  counts: Record<string, number>;
  audience: string[];
  audienceKnown: boolean;
  next: { action: string; label: string; hint: string };
};
type Core = {
  fieldJobStatus: (input: Record<string, unknown>) => Model;
  loadFieldJobStatusSources: (
    apiBase: string,
    token: string,
    jobId: string,
  ) => Promise<{ videos: unknown[] | null; people: unknown[] | null }>;
};

function loadCore(fetchImpl?: (url: string) => Promise<Response>) {
  const sandbox: Record<string, unknown> = { console, URL, URLSearchParams, fetch: fetchImpl };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(coreSrc, sandbox);
  return sandbox.FieldCaptureCore as Core;
}

const JOB = 'd7fe1a01-4483-42c5-abb8-eaaa4c6988df';
const step = (m: Model, key: string) => m.steps.find((s) => s.key === key)!;

describe('Field status card', () => {
  it('a job with nothing filmed says so and asks for the first clip', () => {
    const m = loadCore().fieldJobStatus({ jobId: JOB, jobName: 'Tiffany & Co.', films: [], videos: [], people: [] });
    expect(step(m, 'captured')).toMatchObject({ done: false, detail: 'Nothing yet' });
    expect(m.next).toMatchObject({ action: 'record', label: 'Record the first clip' });
  });

  it('clips still on this phone are captured but not uploaded; next is keep the app open', () => {
    const m = loadCore().fieldJobStatus({
      jobId: JOB,
      films: [
        { jobId: JOB, status: 'uploading' },
        { jobId: 'other', status: 'queued' },
        { jobId: JOB, status: 'filed' },
      ],
      videos: [],
      online: false,
    });
    expect(m.counts.onPhone).toBe(1);
    expect(step(m, 'captured').done).toBe(true);
    expect(step(m, 'uploaded')).toMatchObject({ done: false, detail: '1 clip uploading now' });
    expect(m.next.action).toBe('wait');
    expect(m.next.hint).toMatch(/No signal/);
  });

  it('filed clips still being analyzed show processing; analyzed clips are done', () => {
    const Core = loadCore();
    const busy = Core.fieldJobStatus({
      jobId: JOB,
      films: [],
      videos: [
        { analysisStatus: 'done', transcriptStatus: 'done' },
        { analysisStatus: 'running', transcriptStatus: 'done' },
      ],
    });
    expect(step(busy, 'uploaded')).toMatchObject({ done: true, detail: '2 clips at the office' });
    expect(step(busy, 'processing')).toMatchObject({ done: false, detail: '1 clip processing' });
    const done = Core.fieldJobStatus({
      jobId: JOB,
      films: [],
      videos: [{ analysisStatus: 'done', transcriptStatus: 'done' }],
    });
    expect(step(done, 'processing')).toMatchObject({ done: true, detail: 'Transcripts and summaries ready' });
    expect(done.next.label).toBe('Record another clip');
  });

  it('lists who can see the job from the roster, homeowner labeled, revoked people left out', () => {
    const m = loadCore().fieldJobStatus({
      jobId: JOB,
      orgName: 'Jettx LLC',
      films: [],
      videos: [],
      people: [
        { kind: 'homeowner', name: 'Pat Doe', state: 'live' },
        { kind: 'field_capture', name: 'Alex', displayLabel: 'Electrician', state: 'claimed' },
        { kind: 'homeowner', name: 'Old', state: 'revoked' },
      ],
    });
    expect(m.audience).toEqual(['Your team at Jettx LLC', 'Pat Doe · Homeowner', 'Alex · Electrician']);
    expect(m.audienceKnown).toBe(true);
  });

  it('an invited crew member without office access still gets a card from what the phone knows', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{"error":"No org"}', { status: 403 })));
    const Core = loadCore(fetchMock);
    const src = await Core.loadFieldJobStatusSources('https://platform.atmosphereteam.com', 't', JOB);
    expect(src).toEqual({ videos: null, people: null });
    const m = Core.fieldJobStatus({ jobId: JOB, films: [], videos: null, people: null });
    expect(m.audienceKnown).toBe(false);
    expect(m.audience).toEqual(['Your office team']);
  });

  it('the phone has a native Status screen and never embeds the dashboard', () => {
    expect(fieldHtml).toContain('id="s-status"');
    expect(fieldHtml).toContain('Who can see this job');
    expect(fieldHtml).not.toContain('verifier-library?embed=field');
  });
});
