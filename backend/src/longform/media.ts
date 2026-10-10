/**
 * ffmpeg reads for one segment of a recording, streamed from a (signed) URL:
 * low-res keyframes every N seconds with their mean luma, and audio RMS.
 * Only reads; writes temp files under os.tmpdir() and removes them.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyFrameSignal, parseAstatsRms, parseSignalstats, type DeadLabel } from './deadTime.js';

function run(args: string[], timeoutMs: number): Promise<{ code: number; stderr: string; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let stdout = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (c) => (stdout += String(c)));
    child.stderr.on('data', (c) => (stderr += String(c)));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stderr, stdout });
    });
  });
}

export type SegmentMedia = {
  frames: Array<{ atSeconds: number; base64: string; luma: number | null }>;
  signals: Array<{ atSeconds: number; dead: DeadLabel }>;
};

export async function readSegmentMedia(input: {
  url: string;
  startSeconds: number;
  endSeconds: number;
  intervalSeconds: number;
  width: number;
}): Promise<SegmentMedia> {
  const len = Math.max(0.1, input.endSeconds - input.startSeconds);
  const dir = await mkdtemp(join(tmpdir(), 'atm-seg-'));
  try {
    const vf = `fps=1/${input.intervalSeconds},scale=${input.width}:-2,signalstats,metadata=print:file=-`;
    const video = await run(
      ['-hide_banner', '-nostdin', '-ss', String(input.startSeconds), '-t', String(len), '-i', input.url,
        '-vf', vf, '-q:v', '6', join(dir, 'f%05d.jpg')],
      Math.max(120_000, len * 1000),
    );
    const lumas = parseSignalstats(video.stdout + video.stderr);
    const files = (await readdir(dir)).filter((f) => f.endsWith('.jpg')).sort();
    const frames = await Promise.all(
      files.map(async (f, i) => ({
        atSeconds: input.startSeconds + i * input.intervalSeconds,
        base64: (await readFile(join(dir, f))).toString('base64'),
        luma: lumas[i] ?? null,
      })),
    );
    const audio = await run(
      ['-hide_banner', '-nostdin', '-ss', String(input.startSeconds), '-t', String(len), '-i', input.url, '-vn',
        '-af', `astats=metadata=1:reset=${Math.max(1, Math.round(input.intervalSeconds))},ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-`,
        '-f', 'null', '-'],
      Math.max(120_000, len * 1000),
    );
    const rms = parseAstatsRms(audio.stdout + audio.stderr);
    const signals = frames.map((f) => {
      const rel = f.atSeconds - input.startSeconds;
      const near = rms.length ? rms.reduce((a, b) => (Math.abs(b.t - rel) < Math.abs(a.t - rel) ? b : a)) : null;
      return { atSeconds: f.atSeconds, dead: classifyFrameSignal({ atSeconds: f.atSeconds, luma: f.luma, rmsDb: near?.db ?? null }) };
    });
    return { frames, signals };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
