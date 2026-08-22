import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../verifier/index.html'),
  'utf8',
);

type RecordingClip = {
  uploadedAt?: string | null;
  capturedAt?: string | null;
  recording?: boolean;
  live?: boolean;
  analysis?: { state?: string };
};

type StatusChip = { cls: string; text: string };

function loadRecordingStatus() {
  const src = verifierHtml.match(
    /function clipInstant\(e, keys\) \{[\s\S]*?function jobRecordingStatus\(items\) \{[\s\S]*?\n  \}/,
  );
  if (!src) throw new Error('Could not find recording status helpers in verifier/index.html');

  const dom = new JSDOM(
    `<!doctype html><html><body><script>
      ${src[0]}
      window.__clipInstant = clipInstant;
      window.__isActiveRecording = isActiveRecording;
      window.__jobRecordingStatus = jobRecordingStatus;
    </script></body></html>`,
    { runScripts: 'dangerously' },
  );

  const win = dom.window as unknown as {
    __isActiveRecording: (e: RecordingClip) => boolean;
    __jobRecordingStatus: (items: RecordingClip[]) => StatusChip;
  };
  return {
    isActiveRecording: win.__isActiveRecording,
    jobRecordingStatus: win.__jobRecordingStatus,
  };
}

describe('dashboard recording status chip', () => {
  const { isActiveRecording, jobRecordingStatus } = loadRecordingStatus();
  const recent = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const old = '2026-08-05T20:51:00';

  it('treats queued analysis of a filed clip as recorded, not live', () => {
    expect(
      isActiveRecording({
        uploadedAt: old,
        capturedAt: old,
        analysis: { state: 'queued' },
      }),
    ).toBe(false);
  });

  it('does not treat a recent upload as an active recording', () => {
    expect(
      isActiveRecording({
        uploadedAt: recent,
        capturedAt: recent,
        analysis: { state: 'none' },
      }),
    ).toBe(false);
  });

  it('is live only while a camera is still rolling', () => {
    expect(isActiveRecording({ capturedAt: recent, analysis: { state: 'none' } })).toBe(true);
    expect(isActiveRecording({ recording: true })).toBe(true);
    expect(isActiveRecording({ uploadedAt: old, recording: true })).toBe(false);
  });

  it('shows green Recording once footage exists, and yellow only while recording', () => {
    expect(jobRecordingStatus([])).toEqual({ cls: 'red', text: 'No recording' });
    expect(
      jobRecordingStatus([
        { uploadedAt: old, capturedAt: old, analysis: { state: 'queued' } },
      ]),
    ).toEqual({ cls: 'green', text: 'Recording' });
    expect(
      jobRecordingStatus([
        { uploadedAt: old, analysis: { state: 'done' } },
        { capturedAt: recent },
      ]),
    ).toEqual({ cls: 'yellow', text: 'Active recording' });
  });
});
