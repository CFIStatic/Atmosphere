import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clipContextText,
  ensureClipFrames,
  hasClipReading,
  readingEntries,
  spaceFrames,
  storedClipFrames,
  type ClipVisionProof,
} from '../src/shared/clipVision.js';
import {
  clipRecordFromEvidenceItem,
  clipVisionContent,
  spaceAskFrames,
} from '../src/shared/clipAsk.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const proof: ClipVisionProof = {
  id: 'proof-1',
  org_id: 'org-1',
  job_id: 'job-1',
  party_id: 'party-1',
  phase: 'after',
  work_date: '2026-08-14',
  storage_path: 'org-1/job-1/party-1/2026-08-14-after.mp4',
  duration_seconds: 142,
};

/** A supabase-ish stand-in: frame rows in a table, JPEGs in a bucket. */
function fakeAdmin(rows: Array<{ at_seconds: number; storage_path: string }>) {
  const downloads: string[] = [];
  const signed: string[] = [];
  return {
    downloads,
    signed,
    from() {
      const query: any = {
        select: () => query,
        eq: () => query,
        order: () => Promise.resolve({ data: rows }),
        update: () => query,
      };
      return query;
    },
    storage: {
      from() {
        return {
          download: async (path: string) => {
            downloads.push(path);
            return { data: { arrayBuffer: async () => Buffer.from(`jpeg:${path}`) } };
          },
          createSignedUrl: async (path: string) => {
            signed.push(path);
            return { data: { signedUrl: `https://storage.test/${path}` }, error: null };
          },
        };
      },
    },
  };
}

test('hasClipReading is about what is on the row, not which pipeline wrote it', () => {
  assert.equal(hasClipReading({ narration_text: null, ai_summary: null }), false);
  assert.equal(hasClipReading({ narration_text: '   ', ai_summary: '' }), false);
  assert.equal(hasClipReading({ narration_text: 'Tarp is off the north slope.' }), true);
  assert.equal(hasClipReading({ ai_summary: 'Underlayment down.' }), true);
});

test('spaceFrames keeps both ends of a long clip inside the budget', () => {
  const frames = Array.from({ length: 40 }, (_, i) => i);
  const kept = spaceFrames(frames, 5);
  assert.equal(kept.length, 5);
  assert.equal(kept[0], 0);
  assert.equal(kept[kept.length - 1], 39);
  assert.deepEqual(spaceFrames([1, 2], 8), [1, 2]);
});

test('the clip context carries job, crew and scope — and never an amount', () => {
  const text = clipContextText({
    proof,
    jobName: 'Cedar Ridge',
    company: 'Delgado Roofing',
    scopeTitles: ['Remove temporary tarp', 'Lay synthetic underlayment'],
  });
  assert.match(text, /Cedar Ridge/);
  assert.match(text, /Delgado Roofing/);
  assert.match(text, /2026-08-14/);
  assert.match(text, /Remove temporary tarp/);
  assert.doesNotMatch(text, /\$|invoice|amount|cost/i);
});

test('every action becomes one timestamped beat, in playhead order', () => {
  const entries = readingEntries([
    { atSeconds: 63, action: 'fasten', description: 'Underlayment fastened mid-slope.' },
    { atSeconds: 11, action: 'remove', description: 'Tarp pulled off the north slope.' },
    { atSeconds: 20, action: 'other', description: '   ' },
  ] as any);
  assert.deepEqual(
    entries.map((e) => [e.atSeconds, e.note]),
    [
      [11, 'Tarp pulled off the north slope.'],
      [63, 'Underlayment fastened mid-slope.'],
    ],
  );
  assert.ok(entries.every((e) => e.stageIndex === -1));
});

test('frames already on file are used rather than re-extracted from the video', async () => {
  const admin = fakeAdmin([
    { at_seconds: 4, storage_path: 'frames/a.jpg' },
    { at_seconds: 40, storage_path: 'frames/b.jpg' },
    { at_seconds: 90, storage_path: 'frames/c.jpg' },
  ]);
  const frames = await ensureClipFrames(admin as any, proof, 24);
  assert.equal(frames.length, 3);
  assert.deepEqual(
    frames.map((f) => f.atSeconds),
    [4, 40, 90],
  );
  assert.ok(frames[0]!.jpeg instanceof Buffer);
  // No signed URL means ffmpeg was never asked to open the video.
  assert.equal(admin.signed.length, 0);
});

test('storedClipFrames honours the frame budget', async () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({
    at_seconds: i * 10,
    storage_path: `frames/${i}.jpg`,
  }));
  const admin = fakeAdmin(rows);
  const frames = await storedClipFrames(admin as any, proof.id, 6);
  assert.equal(frames.length, 6);
  assert.equal(frames[0]!.atSeconds, 0);
  assert.equal(frames[frames.length - 1]!.atSeconds, 290);
});

test('a question carries the stills in order, each labelled with its timestamp', () => {
  const content = clipVisionContent({
    question: 'Is there a ladder against the north wall?',
    reading: 'Dictation: the crew works the north slope.',
    frames: [
      { atSeconds: 11, base64: 'AAA' },
      { atSeconds: 63, base64: 'BBB' },
    ],
  });
  const blocks = content as any[];
  assert.deepEqual(
    blocks.map((block) => block.type),
    ['text', 'text', 'image', 'text', 'image', 'text'],
  );
  assert.match(String(blocks[1].text), /0:11/);
  assert.match(String(blocks[3].text), /1:03/);
  assert.match(String(blocks[blocks.length - 1].text), /ladder against the north wall/);
  assert.equal(blocks[2].source.data, 'AAA');
  assert.equal(blocks[2].source.media_type, 'image/jpeg');
});

test('a long clip still hands the model both ends of the footage', () => {
  const frames = Array.from({ length: 50 }, (_, i) => ({ atSeconds: i * 30, base64: `f${i}` }));
  const picked = spaceAskFrames(frames, 12);
  assert.equal(picked.length, 12);
  assert.equal(picked[0]!.atSeconds, 0);
  assert.equal(picked[picked.length - 1]!.atSeconds, 1470);
});

test("a before clip answers from its own reading, not from the day's silence", () => {
  const record = clipRecordFromEvidenceItem({
    workDate: '2026-08-14',
    phase: 'before',
    company: 'Delgado Roofing',
    durationSeconds: 96,
    // The day comparison lives on the after clip, so this is null by design.
    analysisState: 'paired',
    analysis: null,
    clipReading: {
      dictation: 'The clip opens on a tarped north slope with debris staged in the driveway.',
      summary: 'Tarped slope, nothing started yet.',
      entries: [{ atSeconds: 8, text: 'Tarp still covering the north slope.' }] as any,
      actions: [{ atSeconds: 8, action: 'inspect', description: 'Camera pans the tarped slope.' }] as any,
      status: 'done',
    },
  });
  assert.equal(record.analysisState, 'done');
  assert.match(String(record.dictation), /tarped north slope/);
  assert.equal(record.dictationEntries?.length, 1);
  assert.equal(record.actions?.length, 1);
});
