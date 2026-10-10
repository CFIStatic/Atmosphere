import test from 'node:test';
import assert from 'node:assert/strict';
import { captionTimes, planSegments } from '../src/longform/segmentPlan.js';
import { classifyFrameSignal, parseAstatsRms, parseSignalstats } from '../src/longform/deadTime.js';
import { captionFrames, parseCaptions, type GeminiCall } from '../src/longform/captions.js';
import { buildMinuteTimeline, collapseDeadRanges, timelineCoverage } from '../src/longform/timeline.js';
import { segmentBackoffMs } from '../src/longform/segmentJobs.js';
import { runSegmentWorkerOnce, sweepBaseTimeline } from '../src/longform/segmentWorker.js';

test('segments cover the whole recording with no gaps', () => {
  const segs = planSegments(8 * 3600 + 5, 600);
  assert.equal(segs.length, 49);
  assert.equal(segs[0]!.startSeconds, 0);
  for (let i = 1; i < segs.length; i += 1) assert.equal(segs[i]!.startSeconds, segs[i - 1]!.endSeconds);
  assert.equal(segs.at(-1)!.endSeconds, 8 * 3600 + 5);
  assert.deepEqual(captionTimes({ startSeconds: 600, endSeconds: 660 }, 15), [600, 615, 630, 645]);
  assert.deepEqual(captionTimes({ startSeconds: 0, endSeconds: 4 }, 15), [0]);
});

test('dead-time signals are conservative', () => {
  assert.equal(classifyFrameSignal({ atSeconds: 0, speedMps: 12 }), 'driving');
  assert.equal(classifyFrameSignal({ atSeconds: 0, luma: 5 }), 'pocket');
  assert.equal(classifyFrameSignal({ atSeconds: 0, rmsDb: -70, diff: 0.5 }), 'static');
  assert.equal(classifyFrameSignal({ atSeconds: 0, luma: 120, rmsDb: -20 }), null);
  assert.equal(classifyFrameSignal({ atSeconds: 0 }), null);
  assert.deepEqual(parseSignalstats('lavfi.signalstats.YAVG=12.5\nx\nlavfi.signalstats.YAVG=100'), [12.5, 100]);
  assert.deepEqual(parseAstatsRms('frame:0 pts:0 pts_time:0\nlavfi.astats.Overall.RMS_level=-inf\nframe:1 pts_time:15\nlavfi.astats.Overall.RMS_level=-22.1'), [
    { t: 0, db: -120 },
    { t: 15, db: -22.1 },
  ]);
});

test('caption parsing drops invented frame indexes and unknown activities', () => {
  const frames = [{ atSeconds: 0 }, { atSeconds: 15 }];
  const got = parseCaptions(
    '{"frames":[{"frame":0,"caption":"Cutting drywall","activity":"site_work","room":"kitchen","confidence":0.9},{"frame":5,"caption":"x","activity":"site_work"},{"frame":1,"caption":"Truck dash","activity":"flying","confidence":2}]}',
    frames,
    'm',
  );
  assert.equal(got.size, 2);
  assert.equal(got.get(0)!.room, 'kitchen');
  assert.equal(got.get(1)!.activity, 'other');
  assert.equal(got.get(1)!.confidence, 1);
});

test('every frame gets a row; unsure frames are re-read by the stronger model once', async () => {
  const calls: string[] = [];
  const call: GeminiCall = async ({ model, parts }) => {
    calls.push(model);
    const n = parts.filter((p) => 'inlineData' in p).length;
    const conf = model === 'lite' ? 0.3 : 0.95;
    return {
      model,
      usage: null,
      text: JSON.stringify({ frames: Array.from({ length: n }, (_, i) => ({ frame: i, caption: `${model} ${i}`, activity: 'site_work', confidence: conf })) }),
    };
  };
  const frames = Array.from({ length: 5 }, (_, i) => ({ atSeconds: i * 15, base64: 'x' }));
  const caps = await captionFrames(frames, { model: 'lite', rereadModel: 'flash', rereadBelow: 0.6, batch: 2, call });
  assert.equal(caps.length, 5);
  assert.ok(caps.every((c) => c.status === 'reread' && c.model === 'flash'));
  assert.deepEqual(calls, ['lite', 'lite', 'lite', 'flash', 'flash', 'flash']);

  const failing: GeminiCall = async () => {
    throw new Error('down');
  };
  const none = await captionFrames(frames, { model: 'lite', rereadModel: 'flash', rereadBelow: 0.6, batch: 12, call: failing });
  assert.equal(none.length, 5);
  assert.ok(none.every((c) => c.status === 'unread'));
});

test('timeline: one entry per minute, dead stretches labelled not skipped, speech wins', () => {
  const cap = (t: number, activity: any, caption: string) => ({ atSeconds: t, caption, activity, room: null, confidence: 0.9, model: 'm', status: 'ok' as const });
  const captions = [
    ...[0, 15, 30, 45].map((t) => cap(t, 'site_work', 'Framing kitchen wall')),
    ...[60, 75, 90, 105, 120, 135, 150, 165].map((t) => cap(t, 'driving', 'Truck dashboard, road ahead')),
    ...[180, 195].map((t) => cap(t, 'pocket_or_dark', 'Black frame')),
  ];
  const transcript = [{ start: 185, end: 190, text: 'Hold that end for me', speaker: 'A' }];
  const entries = buildMinuteTimeline({ durationSeconds: 250, captions, transcript });
  assert.equal(entries.length, 5);
  assert.equal(entries[0]!.dead, null);
  assert.equal(entries[1]!.dead, 'driving');
  assert.equal(entries[2]!.dead, 'driving');
  assert.equal(entries[3]!.dead, null, 'speech in a dark minute is never labelled dead');
  assert.match(entries[3]!.speech!, /Hold that end/);
  assert.deepEqual(entries[4]!.sources, ['none'], 'a minute with nothing captured is a visible gap');
  const ranges = collapseDeadRanges(entries);
  assert.equal(ranges[1]!.range, 'driving 1:00–3:00');
  const cov = timelineCoverage(entries, 250);
  assert.equal(cov.minutes, 5);
  assert.deepEqual(cov.gaps, [4]);
});

test('segment backoff grows and caps', () => {
  assert.deepEqual([1, 2, 3, 4, 9].map(segmentBackoffMs), [60_000, 240_000, 960_000, 3_840_000, 3_840_000]);
});

test('worker and sweep do nothing while the switch is off', async () => {
  delete process.env.VIDEO_BASE_TIMELINE;
  const admin = new Proxy({}, { get: () => { throw new Error('must not touch the database'); } });
  assert.equal(await runSegmentWorkerOnce(admin), false);
  assert.deepEqual(await sweepBaseTimeline(admin), { enqueued: 0, ran: 0 });
});

test('worker: claim, caption, complete, assemble timeline (in-memory db)', async () => {
  process.env.VIDEO_BASE_TIMELINE = 'true';
  const db: Record<string, any[]> = {
    job_proofs: [{ id: 'p1', org_id: 'o1', storage_path: 's/p1.mp4', duration_seconds: 120, transcript_segments: [{ start: 70, end: 75, text: 'Measure twice' }] }],
    video_segment_jobs: [
      { id: 'j1', proof_id: 'p1', org_id: 'o1', seg_index: 0, start_seconds: 0, end_seconds: 120, status: 'queued', attempts: 0, cost_nanos: 0, output: null },
    ],
    video_timelines: [],
  };
  const q = (table: string) => {
    const filters: Array<(r: any) => boolean> = [];
    let patch: any = null;
    const api: any = {
      select: () => api,
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), api),
      order: () => api,
      update: (p: any) => ((patch = p), api),
      upsert: async (row: any) => (db[table]!.push(row), { error: null }),
      maybeSingle: async () => ({ data: db[table]!.find((r) => filters.every((f) => f(r))) ?? null, error: null }),
      then: (res: any) => {
        const rows = db[table]!.filter((r) => filters.every((f) => f(r)));
        if (patch) rows.forEach((r) => Object.assign(r, patch));
        return Promise.resolve({ data: rows, error: null }).then(res);
      },
    };
    return api;
  };
  const admin: any = {
    from: q,
    rpc: async () => {
      const row = db.video_segment_jobs!.find((r) => r.status === 'queued');
      if (!row) return { data: null, error: null };
      Object.assign(row, { status: 'running', lease_owner: 'w', attempts: row.attempts + 1 });
      return { data: row, error: null };
    },
  };
  const deps = {
    signUrl: async () => 'https://signed',
    readMedia: async () => ({
      frames: [0, 15, 30, 45, 60, 75, 90, 105].map((t) => ({ atSeconds: t, base64: 'x', luma: 100 })),
      signals: [],
    }),
    call: (async ({ parts }) => ({
      model: 'gemini-3.5-flash-lite',
      usage: null,
      text: JSON.stringify({ frames: parts.filter((p: any) => 'inlineData' in p).map((_: unknown, i: number) => ({ frame: i, caption: 'Hanging drywall', activity: 'site_work', confidence: 0.9 })) }),
    })) as GeminiCall,
  };
  assert.equal(await runSegmentWorkerOnce(admin, deps, 'w'), true);
  assert.equal(db.video_segment_jobs![0].status, 'done');
  const tl = db.video_timelines![0];
  assert.equal(tl.minutes.length, 2);
  assert.equal(tl.coverage_pct, 100);
  assert.match(tl.minutes[1].speech, /Measure twice/);
  delete process.env.VIDEO_BASE_TIMELINE;
});
