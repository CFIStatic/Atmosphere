import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDayReport,
  parseWindowReading,
  scopeSightings,
  segmentFrames,
} from '../src/shared/longAnalyst.js';
import { parseScopeExtraction } from '../src/verifier/scopeReader.js';

/**
 * The workday rules. What earns a test is anything that would let seven
 * hours of footage flatter itself: a verdict stronger than its sightings, an
 * invented scope citation surviving the parser, coverage asserted instead of
 * counted.
 */

/* ---- segmentation ---- */

test('frames group into windows by count, in time order', () => {
  const frames = Array.from({ length: 30 }, (_, i) => ({ atSeconds: i * 60 }));
  const windows = segmentFrames(frames, { maxFrames: 12, maxSeconds: 100_000 });
  assert.equal(windows.length, 3);
  assert.deepEqual(windows.map((w) => w.frameIdxs.length), [12, 12, 6]);
  assert.equal(windows[0].startSeconds, 0);
  assert.equal(windows[0].endSeconds, 11 * 60);
  assert.equal(windows[2].idx, 2);
});

test('a sparse recording still closes windows by elapsed time', () => {
  // Three frames an hour apart with a 20-minute window cap: three windows.
  const frames = [{ atSeconds: 0 }, { atSeconds: 3600 }, { atSeconds: 7200 }];
  const windows = segmentFrames(frames, { maxFrames: 12, maxSeconds: 1200 });
  assert.equal(windows.length, 3);
});

test('unsorted frames are read in time order, not upload order', () => {
  const frames = [{ atSeconds: 500 }, { atSeconds: 10 }, { atSeconds: 250 }];
  const windows = segmentFrames(frames, { maxFrames: 12, maxSeconds: 10_000 });
  assert.equal(windows.length, 1);
  assert.deepEqual(windows[0].frameIdxs, [1, 2, 0]);
  assert.equal(windows[0].startSeconds, 10);
  assert.equal(windows[0].endSeconds, 500);
});

test('a seven-hour day at one frame per ten seconds stays a bounded read', () => {
  const frames = Array.from({ length: 2520 }, (_, i) => ({ atSeconds: i * 10 }));
  const windows = segmentFrames(frames, { maxFrames: 12, maxSeconds: 1200 });
  // 2520 frames / 12 per window = 210 cheap calls, one synthesis. Arithmetic,
  // not hope: the cost ceiling is set here.
  assert.equal(windows.length, 210);
  assert.ok(windows.every((w) => w.frameIdxs.length <= 12));
});

/* ---- window reading ---- */

test('an invented scope index does not survive the window parser', () => {
  const reading = parseWindowReading(
    '{"summary": "Crew stripping the slope.", "scopeTouched": [0, 7, -1, 2], "activity": ["tear-off"], "couldNotTell": []}',
    3,
  );
  assert.ok(reading);
  assert.deepEqual(reading!.scopeTouched, [0, 2]);
});

test('a window that cannot tell is a valid reading, not a failure', () => {
  const reading = parseWindowReading(
    '{"summary": "Frames are dark; interior not visible.", "scopeTouched": [], "activity": [], "couldNotTell": ["Lighting too low to identify work"]}',
    3,
  );
  assert.ok(reading);
  assert.equal(reading!.scopeTouched.length, 0);
  assert.equal(reading!.couldNotTell.length, 1);
});

/* ---- sightings and the verdict cap ---- */

const READINGS = [
  { idx: 0, reading: { summary: 'a', scopeTouched: [0], activity: [], couldNotTell: [] } },
  { idx: 1, reading: { summary: 'b', scopeTouched: [0, 1], activity: [], couldNotTell: [] } },
  { idx: 2, reading: null },
  { idx: 3, reading: { summary: 'c', scopeTouched: [0], activity: [], couldNotTell: [] } },
];

test('sightings are counted per line from the stored readings', () => {
  const sightings = scopeSightings(READINGS, 3);
  assert.deepEqual(sightings, [[0, 1, 3], [1], []]);
});

test('a verdict can never be stronger than its sightings', () => {
  const raw = JSON.stringify({
    verdicts: [
      { line: 0, verdict: 'appears_complete', because: 'Seen across the day.' },
      // The model claims completion on one sighting: capped to in_progress.
      { line: 1, verdict: 'appears_complete', because: 'Looked done to me.' },
      // The model claims completion on ZERO sightings: forced to not_visible.
      { line: 2, verdict: 'appears_complete', because: 'Surely they did it.' },
    ],
    narrative: 'The day in order.',
    couldNotTell: [],
  });
  const report = parseDayReport(raw, ['strip slope', 'new decking', 'skylight flashing'], scopeSightings(READINGS, 3), 'model-x');
  assert.ok(report);
  assert.equal(report!.verdicts[0].verdict, 'appears_complete');
  assert.equal(report!.verdicts[1].verdict, 'in_progress');
  assert.equal(report!.verdicts[2].verdict, 'not_visible');
  assert.ok(report!.verdicts[2].because.length > 0, 'the downgrade explains itself');
  assert.deepEqual(report!.verdicts[0].seenInWindows, [0, 1, 3]);
});

test('a line the model forgot still gets a verdict — not_visible, never silence', () => {
  const raw = JSON.stringify({
    verdicts: [{ line: 0, verdict: 'in_progress', because: 'Underway.' }],
    narrative: 'Short day.',
    couldNotTell: [],
  });
  const report = parseDayReport(raw, ['line a', 'line b'], [[0], []], 'model-x');
  assert.ok(report);
  assert.equal(report!.verdicts.length, 2);
  assert.equal(report!.verdicts[1].verdict, 'not_visible');
});

/* ---- scope extraction ---- */

test('extraction keeps valid lines and drops garbage without repair', () => {
  const raw = JSON.stringify({
    lines: [
      { title: 'Strip north slope to decking', state: 'included', reason: null, amount: 4800, note: 'p.2' },
      { title: 'Skylights', state: 'excluded', reason: 'Carrier declined', amount: null, note: null },
      { title: 'x', state: 'included' }, // too short
      { title: 'Valid title, invalid state', state: 'maybe' },
      { title: 'Negative money', state: 'included', amount: -5 },
    ],
    couldNotRead: ['Page 4 is a photo of a photo.'],
  });
  const extraction = parseScopeExtraction(raw, 'model-x');
  assert.ok(extraction);
  assert.equal(extraction!.lines.length, 3);
  assert.equal(extraction!.lines[0].amount, 4800);
  assert.equal(extraction!.lines[1].state, 'excluded');
  assert.equal(extraction!.lines[1].reason, 'Carrier declined');
  // Negative amount is dropped from the line, not clamped into a claim.
  assert.equal(extraction!.lines[2].amount, null);
  assert.deepEqual(extraction!.couldNotRead, ['Page 4 is a photo of a photo.']);
});

test('an extraction with no usable lines is null, not an empty success', () => {
  assert.equal(parseScopeExtraction('{"lines": [], "couldNotRead": []}', 'm'), null);
  assert.equal(parseScopeExtraction('not json at all', 'm'), null);
});
