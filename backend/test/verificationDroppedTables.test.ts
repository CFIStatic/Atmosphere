/**
 * Regression tests for videos stuck on "Needs attention" after #797:
 *  - generate_verified_events / update_project_graph queried the dropped
 *    project_timeline_events table and failed every verification run;
 *  - ffmpeg frames past the stored duration clamped to one timestamp and broke
 *    the verification_frames (video_id, timestamp_seconds) unique key.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createGenerateVerifiedEventsHandler,
  createUpdateProjectGraphHandler,
} from '../src/verification/timeline/graph.js';
import { extractFrames, type CommandRunner } from '../src/verification/frames/extract.js';
import type { PipelineContext } from '../src/verification/pipeline/orchestrator.js';

test('timeline stages never touch the database', async () => {
  const supabase = {
    from(table: string) {
      throw new Error(`unexpected query on ${table}`);
    },
  };
  const ctx = { supabase, orgId: 'o', jobId: 'j', videoId: 'v', processingJobId: 'p' } as unknown as PipelineContext;
  const events = await createGenerateVerifiedEventsHandler()(ctx);
  assert.equal(events.output.timelineEvents, 0);
  const graph = await createUpdateProjectGraphHandler()(ctx);
  assert.equal(graph.output.edges, 0);
});

test('extractFrames drops extra frames that clamp to the same timestamp', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'atm-frames-'));
  // ffmpeg wrote 8 frames for a clip whose stored duration only allows 4.
  const runner: CommandRunner = async () => {
    for (let i = 1; i <= 8; i += 1) {
      await writeFile(join(outDir, `frame_${String(i).padStart(5, '0')}.jpg`), 'x');
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  const frames = await extractFrames({
    filePath: 'in.mp4',
    outDir,
    durationSeconds: 6,
    intervalSeconds: 2,
    maxFrames: 20,
    runner,
  });
  const stamps = frames.map((f) => f.timestampSeconds);
  assert.deepEqual(stamps, [0, 2, 4, 5.9]);
  assert.equal(new Set(stamps).size, stamps.length);
});
