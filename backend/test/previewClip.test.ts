import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extractPreviewClip,
  previewClipWindow,
} from '../src/verification/frames/extract.ts';
import { previewObjectPath } from '../src/routes/proofOfWork.ts';
import { ffmpegAvailable, makeSyntheticDayClip } from './helpers/syntheticAv.ts';

test('preview window skips the opening half-second on a real-length clip', () => {
  assert.deepEqual(previewClipWindow(null), { start: 0.5, span: 4 });
  assert.deepEqual(previewClipWindow(0), { start: 0.5, span: 4 });
  assert.deepEqual(previewClipWindow(96), { start: 0.5, span: 4 });
  assert.deepEqual(previewClipWindow(1.2), { start: 0, span: 1.2 });
});

test('preview object path sits next to the original, never a demo name', () => {
  const path = previewObjectPath({
    org_id: 'org-1',
    job_id: 'job-1',
    party_id: 'pty-1',
    work_date: '2026-08-22',
    phase: 'after',
  });
  assert.equal(path, 'org-1/job-1/pty-1/2026-08-22-after-preview.mp4');
  assert.ok(!path.includes('demo'));
  assert.ok(!path.includes('testsrc'));
});

test('extractPreviewClip asks ffmpeg for a short H.264 cut of the input', async () => {
  const calls: Array<{ bin: string; args: string[] }> = [];
  await extractPreviewClip({
    filePath: 'https://storage.example/original.webm',
    outPath: '/tmp/out.mp4',
    startSeconds: 0.5,
    durationSeconds: 4,
    runner: async (bin, args) => {
      calls.push({ bin, args });
      return { stdout: '', stderr: '', code: 0 };
    },
  });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.includes('https://storage.example/original.webm'));
  assert.ok(calls[0].args.includes('/tmp/out.mp4'));
  assert.ok(calls[0].args.includes('libx264'));
  assert.equal(calls[0].args[calls[0].args.indexOf('-ss') + 1], '0.5');
  assert.equal(calls[0].args[calls[0].args.indexOf('-t') + 1], '4');
});

const hasFfmpeg = ffmpegAvailable();

test(
  'extractPreviewClip writes a real MP4 cut from a synthetic recording',
  { skip: !hasFfmpeg },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'atm-preview-'));
    try {
      const source = await makeSyntheticDayClip({
        durationSeconds: 8,
        outDir: dir,
        name: 'source.mp4',
        withAudio: false,
      });
      const outPath = join(dir, 'preview.mp4');
      await extractPreviewClip({
        filePath: source.path,
        outPath,
        startSeconds: 0.5,
        durationSeconds: 4,
      });
      const info = await stat(outPath);
      assert.ok(info.size > 1000, 'preview file should contain encoded frames');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
