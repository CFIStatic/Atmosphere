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
    `${verifierHtml.slice(start, end)}; return { clipInstant, hasLandedFile, isActiveRecording, isOpenRecordingDay, jobRecordingStatus, clipStatus };`,
  )() as {
    hasLandedFile: (e: unknown) => boolean;
    isActiveRecording: (e: unknown) => boolean;
    isOpenRecordingDay: (items: unknown[], day: string) => boolean;
    jobRecordingStatus: (items: unknown[]) => { cls: string; text: string };
    clipStatus: (e: unknown) => { cls: string; text: string };
  };
}

const landed = {
  phase: 'after',
  analysis: { state: 'done' },
  workDate: '2026-08-01',
  capturedAt: '2026-08-01T11:50:00Z',
  uploadedAt: '2026-08-01T12:00:00Z',
  duration: 143,
  bytes: 88_400_000,
  hash: 'abc',
};

describe('verifier dashboard recording status', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('labels a landed clip Recorded in green and never Failed', () => {
    const { clipStatus, jobRecordingStatus } = extractRecordingStatusFns();
    const uploaded = {
      ...landed,
      checks: [{ verdict: 'fail', what: 'Filmed on site', detail: 'off site' }],
    };

    expect(clipStatus(uploaded)).toEqual({ cls: 'green', text: 'Recorded' });
    expect(jobRecordingStatus([uploaded])).toEqual({ cls: 'green', text: 'Recorded' });
    expect(verifierHtml).not.toMatch(/function clipStatus[\s\S]*?text: 'Failed'/);
    expect(verifierHtml).not.toContain("text: 'Active recording'");
    expect(verifierHtml).not.toContain("text: 'Verified'");
  });

  it('stays green on a clip the model has not read yet — recorded is not analysed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-23T12:00:00Z'));
    const { clipStatus, isActiveRecording } = extractRecordingStatusFns();
    const queued = {
      ...landed,
      analysis: { state: 'queued' },
      workDate: '2026-08-23',
      capturedAt: '2026-08-23T11:50:00Z',
      uploadedAt: '2026-08-23T11:52:00Z',
    };

    expect(isActiveRecording(queued)).toBe(false);
    expect(clipStatus(queued)).toEqual({ cls: 'green', text: 'Recorded' });
  });

  it('does not call a just-uploaded clip live — the take is over once the file lands', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-23T12:00:00Z'));
    const { clipStatus, isActiveRecording } = extractRecordingStatusFns();
    const justLanded = {
      ...landed,
      analysis: { state: 'none' },
      workDate: '2026-08-23',
      capturedAt: '2026-08-23T11:58:00Z',
      uploadedAt: '2026-08-23T11:59:00Z',
    };

    expect(isActiveRecording(justLanded)).toBe(false);
    expect(clipStatus(justLanded)).toEqual({ cls: 'green', text: 'Recorded' });
  });

  it('shows yellow Recording when the platform says a camera is rolling', () => {
    const { clipStatus, jobRecordingStatus, isActiveRecording } = extractRecordingStatusFns();
    const rolling = { ...landed, live: true };

    expect(isActiveRecording(rolling)).toBe(true);
    expect(clipStatus(rolling)).toEqual({ cls: 'yellow', text: 'Recording' });
    expect(jobRecordingStatus([rolling])).toEqual({ cls: 'yellow', text: 'Recording' });
  });

  it('shows yellow while a row is filed ahead of its file', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-23T12:00:00Z'));
    const { clipStatus, isActiveRecording } = extractRecordingStatusFns();
    const climbing = {
      phase: 'after',
      analysis: { state: 'none' },
      workDate: '2026-08-23',
      uploadedAt: '2026-08-23T11:55:00Z',
      duration: null,
      bytes: null,
      hash: null,
    };

    expect(isActiveRecording(climbing)).toBe(true);
    expect(clipStatus(climbing)).toEqual({ cls: 'yellow', text: 'Recording' });
  });

  it('holds a job file yellow while today is filmed but not closed out', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-23T12:00:00'));
    const { isOpenRecordingDay, jobRecordingStatus } = extractRecordingStatusFns();
    const before = { ...landed, phase: 'before', workDate: '2026-08-23' };
    const after = { ...landed, phase: 'after', workDate: '2026-08-23' };

    expect(isOpenRecordingDay([before], '2026-08-23')).toBe(true);
    expect(jobRecordingStatus([before])).toEqual({ cls: 'yellow', text: 'Recording' });
    // The after clip closes the day out: filmed and filed is green.
    expect(isOpenRecordingDay([before, after], '2026-08-23')).toBe(false);
    expect(jobRecordingStatus([before, after])).toEqual({ cls: 'green', text: 'Recorded' });
  });

  it('does not hold an old unpaired before yellow forever', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-23T12:00:00'));
    const { isOpenRecordingDay, jobRecordingStatus } = extractRecordingStatusFns();
    const stale = { ...landed, phase: 'before', workDate: '2026-08-14' };

    expect(isOpenRecordingDay([stale], '2026-08-14')).toBe(false);
    expect(jobRecordingStatus([stale])).toEqual({ cls: 'green', text: 'Recorded' });
  });

  it('shows red No recording for an empty job file and for a row with no footage', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-23T12:00:00Z'));
    const { clipStatus, hasLandedFile, jobRecordingStatus } = extractRecordingStatusFns();
    const empty = {
      phase: 'after',
      analysis: { state: 'none' },
      workDate: '2026-07-30',
      uploadedAt: '2026-07-30T12:00:00Z',
      duration: null,
      bytes: null,
      hash: null,
    };

    expect(jobRecordingStatus([])).toEqual({ cls: 'red', text: 'No recording' });
    expect(hasLandedFile(empty)).toBe(false);
    expect(clipStatus(empty)).toEqual({ cls: 'red', text: 'No recording' });
    expect(jobRecordingStatus([empty])).toEqual({ cls: 'red', text: 'No recording' });
  });
});
