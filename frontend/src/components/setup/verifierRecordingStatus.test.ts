import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
    jobRecordingStatus: (items: unknown[]) => { cls: string; text: string };
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

  it('labels a job file with no clips In progress so Field Capture work is visible immediately', () => {
    const { jobRecordingStatus } = extractRecordingStatusFns();
    expect(jobRecordingStatus([])).toEqual({ cls: 'yellow', text: 'In progress' });
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
});
